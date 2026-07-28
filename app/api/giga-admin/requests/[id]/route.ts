export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'

function isSuperAdmin(req: NextRequest): boolean {
  return req.cookies.get('aistart360_role')?.value === 'super_admin'
}

const actionSchema = z.object({
  action: z.enum(['approve', 'reject', 'archive']),
  reason: z.string().trim().min(3).max(500).optional(),
}).superRefine((value, context) => {
  if (value.action === 'reject' && !value.reason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'Укажите причину отклонения',
    })
  }
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = actionSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Некорректное действие' },
      { status: 400 },
    )
  }

  const admin = createServerClient()
  let rollbackState: {
    userId: string
    profile: { role: string; status: string; approved_at: string | null }
    userMetadata: Record<string, unknown>
  } | null = null

  try {
    const { data: approvalRequest, error: requestError } = await admin
      .from('approval_requests')
      .select('id,user_id,status')
      .eq('id', params.id)
      .maybeSingle()

    if (requestError) throw requestError
    if (!approvalRequest) {
      return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
    }

    const targetStatus = {
      approve: 'approved',
      reject: 'rejected',
      archive: 'archived',
    }[parsed.data.action]

    if (approvalRequest.status === targetStatus) {
      return NextResponse.json({ ok: true, status: targetStatus, idempotent: true })
    }

    if (parsed.data.action === 'approve' || parsed.data.action === 'reject') {
      const approved = parsed.data.action === 'approve'
      const { data: originalProfile, error: profileReadError } = await admin
        .from('profiles')
        .select('role,status,approved_at')
        .eq('id', approvalRequest.user_id)
        .single()
      if (profileReadError) throw profileReadError

      const { data: authUser, error: authReadError } =
        await admin.auth.admin.getUserById(approvalRequest.user_id)
      if (authReadError) throw authReadError
      const userMetadata = authUser.user?.user_metadata ?? {}
      rollbackState = {
        userId: approvalRequest.user_id,
        profile: originalProfile,
        userMetadata,
      }

      const profilePatch = approved
        ? { status: 'approved', role: 'owner', approved_at: new Date().toISOString() }
        : { status: 'rejected', approved_at: null }

      const { error: profileError } = await admin
        .from('profiles')
        .update(profilePatch)
        .eq('id', approvalRequest.user_id)

      if (profileError) throw profileError

      const { error: authUpdateError } = await admin.auth.admin.updateUserById(
        approvalRequest.user_id,
        {
          user_metadata: {
            ...userMetadata,
            role: approved ? 'owner' : 'client',
            status: approved ? 'approved' : 'rejected',
          },
        },
      )
      if (authUpdateError) throw authUpdateError
    }

    const { data: updated, error: updateError } = await admin
      .from('approval_requests')
      .update({
        status: targetStatus,
        rejection_reason: parsed.data.action === 'reject' ? parsed.data.reason : null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .select('id,status')
      .single()

    if (updateError) throw updateError

    return NextResponse.json({
      ok: true,
      status: updated.status,
      nextRole: parsed.data.action === 'approve' ? 'owner' : undefined,
    })
  } catch (error) {
    if (rollbackState) {
      const [profileRollback, authRollback] = await Promise.all([
        admin
          .from('profiles')
          .update(rollbackState.profile)
          .eq('id', rollbackState.userId),
        admin.auth.admin.updateUserById(rollbackState.userId, {
          user_metadata: rollbackState.userMetadata,
        }),
      ])
      if (profileRollback.error || authRollback.error) {
        console.error('[giga-admin/requests/:id] rollback error:', {
          profile: profileRollback.error,
          auth: authRollback.error,
        })
      }
    }
    console.error('[giga-admin/requests/:id] PATCH error:', error)
    return NextResponse.json(
      { error: 'Изменение не применено. Данные пользователя сохранены без скрытой частичной обработки.' },
      { status: 500 },
    )
  }
}
