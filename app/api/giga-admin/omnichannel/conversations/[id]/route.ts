export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getGigaActor, isGigaSuperAdmin } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import {
  getDevelopmentAdminConversation,
  shouldUseDevelopmentAdminPostgres,
  updateDevelopmentAdminConversation,
} from '@/lib/omnichannel/development-admin-postgres'
import { createServiceClient } from '@/lib/supabase-service'

const idSchema = z.string().uuid()
const patchSchema = z
  .object({
    status: z.enum(['open', 'needs_human', 'resolved', 'muted']).optional(),
    auto_reply_override: z.boolean().nullable().optional(),
    send_suppressed: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Empty patch')

const conversationColumns =
  'id, channel, account_external_id, external_id, contact_id, status, auto_reply_override, send_suppressed, suppression_reason, suppressed_at, intent, sentiment, lead_score, summary, last_message_at, last_inbound_at, last_outbound_at'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isGigaSuperAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!idSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'Некорректный id диалога' }, { status: 400 })
  }

  if (shouldUseDevelopmentAdminPostgres()) {
    try {
      const detail = await getDevelopmentAdminConversation(params.id)
      if (!detail) return NextResponse.json({ error: 'Диалог не найден' }, { status: 404 })
      return NextResponse.json(detail)
    } catch {
      return NextResponse.json({ error: 'Не удалось загрузить диалог' }, { status: 500 })
    }
  }

  const sb = createServiceClient()
  const { data: conversation, error } = await sb
    .from('omnichannel_conversations')
    .select(conversationColumns)
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Не удалось загрузить диалог' }, { status: 500 })
  if (!conversation) return NextResponse.json({ error: 'Диалог не найден' }, { status: 404 })

  const [contactResult, messagesResult] = await Promise.all([
    sb
      .from('omnichannel_contacts')
      .select('id, external_id, display_name, username, phone')
      .eq('id', conversation.contact_id)
      .maybeSingle(),
    sb
      .from('omnichannel_messages')
      .select(
        'id, direction, text, status, message_type, ai_draft, ai_confidence, ai_reason, ai_generated, occurred_at',
      )
      .eq('conversation_id', params.id)
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  if (contactResult.error || messagesResult.error) {
    return NextResponse.json({ error: 'Не удалось загрузить сообщения' }, { status: 500 })
  }

  return NextResponse.json({
    conversation: {
      ...conversation,
      contact: contactResult.data ?? {
        id: conversation.contact_id,
        external_id: conversation.external_id,
        display_name: null,
        username: null,
        phone: null,
      },
    },
    messages: [...(messagesResult.data ?? [])].reverse(),
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await getGigaActor(req)
  if (!actor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!idSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'Некорректный id диалога' }, { status: 400 })
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Некорректное изменение диалога' }, { status: 400 })
  }

  const update: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.send_suppressed === false) {
    update.suppression_reason = null
    update.suppressed_at = null
  } else if (parsed.data.send_suppressed === true) {
    update.suppression_reason = 'admin_suppressed'
    update.suppressed_at = new Date().toISOString()
  }

  let data: Record<string, unknown> | null
  if (shouldUseDevelopmentAdminPostgres()) {
    try {
      data = await updateDevelopmentAdminConversation(params.id, parsed.data)
    } catch {
      return NextResponse.json({ error: 'Не удалось обновить диалог' }, { status: 500 })
    }
  } else {
    const sb = createServiceClient()
    const result = await sb
      .from('omnichannel_conversations')
      .update(update)
      .eq('id', params.id)
      .select(conversationColumns)
      .maybeSingle()

    if (result.error) {
      return NextResponse.json({ error: 'Не удалось обновить диалог' }, { status: 500 })
    }
    data = result.data as Record<string, unknown> | null
  }
  if (!data) return NextResponse.json({ error: 'Диалог не найден' }, { status: 404 })
  await logAudit({
    entityType: 'system',
    entityId: params.id,
    action: parsed.data.send_suppressed === false
      ? 'omnichannel.reopt_in_confirmed'
      : 'omnichannel.conversation_changed',
    performedBy: actor.id,
    diff: { after: update, actorKind: actor.kind },
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  })
  return NextResponse.json({ conversation: data })
}
