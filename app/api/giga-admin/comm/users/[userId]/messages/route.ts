export const dynamic = 'force-dynamic'
// A message goes to up to four channels in parallel (bridge / Resend / Telegram time out on their own).
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordAdminAction } from '@/lib/admin/audit'
import { actorName, commError, guardComm } from '@/lib/comm/admin'
import { sendToUser } from '@/lib/comm/send'
import { CommError } from '@/lib/comm/store'
import { ProfanityError } from '@/lib/comm/moderation'
import { dirtyField } from '@/lib/moderation/profanity'
import { COMM_CHANNELS, MAX_BODY } from '@/lib/comm/types'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { getSetting } from '@/lib/settings/store'

/**
 * POST /api/giga-admin/comm/users/:userId/messages (inbox.manage)
 *   { body, subject?, channels: ['app'|'email'|'telegram'|'whatsapp', …] | 'auto', important? }
 * A personal message from the staff member to the user, sent at once over the
 * chosen channels (lib/comm/send.ts). The conversation is created on first
 * use. A channel that cannot reach the user is recorded as skipped with the
 * reason. Audit: comm.message.sent. At most 30 sends per minute per staff member.
 * A text with profanity is refused (400, the field named: body / subject); a
 * user blocked in communication cannot be written to (409). `important: true`
 * marks the in-app copy «важное / требует ответа» (flags.important): the cabinet
 * shows it as a modal pop-up (lib/popups).
 */

const Body = z.object({
  body: z.string().max(MAX_BODY + 200),
  subject: z.string().trim().max(200).nullable().optional(),
  channels: z.union([z.literal('auto'), z.array(z.enum(COMM_CHANNELS)).min(1).max(COMM_CHANNELS.length)]),
  /** «Важное — показать окном, требует ответа»: flags.important on the in-app message. */
  important: z.boolean().optional(),
})

export async function POST(req: NextRequest, { params }: { params: { userId: string } }) {
  const g = await guardComm(req, 'inbox.manage', params.userId)
  if (g.response) return g.response
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return commError('Неверный запрос: текст и хотя бы один канал')
  const dirty = dirtyField({ body: parsed.data.body, subject: parsed.data.subject ?? null })
  if (dirty) return NextResponse.json({ ok: false, error: new ProfanityError(dirty).message, field: dirty }, { status: 400 })
  if (await isRateLimitedKey(g.actor.id, 'comm-send', { max: 30, windowMs: 60_000 })) {
    return commError('Слишком много сообщений подряд — подождите минуту', 429)
  }

  let defaultMode: 'manual' | 'auto' = 'manual'
  try { defaultMode = (await getSetting('comm_bot_auto_default')) ? 'auto' : 'manual' } catch { /* default */ }

  try {
    const result = await sendToUser({
      userId: params.userId,
      channels: parsed.data.channels,
      body: parsed.data.body,
      subject: parsed.data.subject ?? null,
      authorKind: 'staff',
      authorId: g.actor.id,
      authorName: await actorName(g.sb, g.actor),
      ...(parsed.data.important ? { flags: { important: true } } : {}),
    }, { sb: g.sb, defaultMode })

    await recordAdminAction(g.actor, {
      action: 'comm.message.sent',
      entityType: 'comm_thread', entityId: result.threadId, targetUserId: params.userId,
      newValue: { subject: parsed.data.subject ?? null, body: parsed.data.body.slice(0, 500), ...(parsed.data.important ? { important: true } : {}), channels: result.messages.map((m) => ({ channel: m.channel, status: m.status })) },
      metadata: { groupId: result.groupId, request: parsed.data.channels === 'auto' ? 'auto' : 'explicit' },
    }, req)

    return NextResponse.json({ ok: true, data: result })
  } catch (err) {
    if (err instanceof ProfanityError) return NextResponse.json({ ok: false, error: err.message, field: err.field }, { status: 400 })
    if (err instanceof CommError && err.code !== 'db') return commError(err.message, err.code === 'not_found' ? 404 : err.code === 'blocked' ? 409 : 400)
    console.error('[giga-admin/comm/send]', err instanceof Error ? err.message : err)
    return commError('Не удалось отправить сообщение', 500)
  }
}
