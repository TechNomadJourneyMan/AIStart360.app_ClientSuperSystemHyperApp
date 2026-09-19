export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { safeInternalPath } from '@/lib/safe-redirect'
import { normalizeEmail, sendPlatformInvite, type InviteResult } from '@/lib/admin/invites'

/**
 * GET  /api/giga-admin/invites — отправленные приглашения и что с ними стало.
 * POST /api/giga-admin/invites — разослать приглашения (до 25 адресов за раз).
 *
 * Письмо уходит с нашего домена со ссылкой на /auth/verify, поэтому настройки
 * Supabase (Site URL) на приглашения не влияют.
 */

const MAX_EMAILS = 25

const bodySchema = z.object({
  emails: z.array(z.string().max(200)).min(1).max(MAX_EMAILS),
  note: z.string().trim().max(300).optional(),
  next: z.string().max(200).optional(),
})

interface AuditRow {
  id: number
  entity_id: string | null
  actor_email: string | null
  actor_id: string
  created_at: string
  metadata: Record<string, unknown> | null
}

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response

  const sb = createServiceClient()
  const { data, error } = await sb
    .from('admin_audit_log')
    .select('id, entity_id, actor_email, actor_id, created_at, metadata')
    .eq('action', 'user.invited')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить приглашения' }, { status: 500 })

  const rows = (data ?? []) as AuditRow[]
  const emails = Array.from(new Set(rows.map((r) => r.entity_id).filter((v): v is string => !!v)))
  const accepted = new Map<string, { status: string; last_seen_at: string | null; id: string }>()
  if (emails.length) {
    const { data: profiles } = await sb
      .from('profiles')
      .select('id, email, status, last_seen_at')
      .in('email', emails)
    for (const p of (profiles ?? []) as Array<{ id: string; email: string; status: string; last_seen_at: string | null }>) {
      accepted.set(p.email.toLowerCase(), { status: p.status, last_seen_at: p.last_seen_at, id: p.id })
    }
  }

  return NextResponse.json({
    ok: true,
    data: rows.map((r) => {
      const email = (r.entity_id ?? '').toLowerCase()
      const profile = accepted.get(email)
      return {
        id: r.id,
        email: r.entity_id,
        sentAt: r.created_at,
        sentBy: r.actor_email || r.actor_id,
        outcome: (r.metadata?.outcome as string) ?? 'invited',
        note: (r.metadata?.note as string) ?? null,
        // «Принято» = человек уже заходил после приглашения.
        acceptedAt: profile?.last_seen_at ?? null,
        userId: profile?.id ?? null,
        profileStatus: profile?.status ?? null,
      }
    }),
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, 'users.manage')
  if (guard.response) return guard.response
  const actor = guard.actor

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: `Укажите от 1 до ${MAX_EMAILS} адресов` }, { status: 422 })
  }
  const next = parsed.data.next ? safeInternalPath(parsed.data.next, '/auth/reset-password') : undefined
  const note = parsed.data.note || null

  const unique = Array.from(new Set(parsed.data.emails.map((e) => normalizeEmail(e) ?? e.trim().toLowerCase())))
  if (await isRateLimitedKey(actor.id, 'giga-invites', { max: 100, windowMs: 60 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много приглашений за час. Попробуйте позже.' }, { status: 429 })
  }

  const results: InviteResult[] = []
  for (const email of unique) {
    const result = await sendPlatformInvite({
      email,
      next,
      note,
      invitedByLabel: actor.email ?? null,
    })
    results.push(result)
    if (result.outcome !== 'failed') {
      // Кто, кого и когда позвал — в журнале аудита; оттуда же строится список.
      await recordAdminAction(actor, {
        action: 'user.invited',
        entityType: 'invite',
        entityId: result.email,
        metadata: { outcome: result.outcome, note },
      }, req)
    }
  }

  const sent = results.filter((r) => r.outcome !== 'failed').length
  return NextResponse.json({ ok: true, sent, failed: results.length - sent, results })
}
