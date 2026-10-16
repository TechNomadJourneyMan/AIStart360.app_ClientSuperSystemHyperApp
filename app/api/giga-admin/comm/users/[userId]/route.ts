export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordAdminAction } from '@/lib/admin/audit'
import { staffRoleOfUser } from '@/lib/admin/giga-actor'
import { hasPermission } from '@/lib/admin/rbac'
import { commError, conversationView, guardComm, threadDTO } from '@/lib/comm/admin'
import { loadReplyDeadline, replyDueAt } from '@/lib/comm/deadline'
import { ensureThread, findThreadByUser, updateThread } from '@/lib/comm/store'
import { getSetting } from '@/lib/settings/store'
import type { CommThreadRow } from '@/lib/comm/types'

/**
 * GET   /api/giga-admin/comm/users/:userId — the user's conversation (inbox.view):
 *       thread, messages (oldest first, last 200), who answers, which channels
 *       can reach him right now. No thread yet → `thread: null` (a new conversation).
 * PATCH /api/giga-admin/comm/users/:userId — { action, … }:
 *       read                       — unread counter of staff to 0 (inbox.view)
 *       assign { assigneeId|null } — responsible staff member (inbox.manage)
 *       close / reopen             — (inbox.manage)
 *       mode { manual|auto }       — AI auto-reply of this conversation, phase 5 (inbox.manage)
 *       whatsapp_opt_out { value } — stop / allow WhatsApp for this user (inbox.manage)
 *       block { reason? } / unblock — block in communication (inbox.manage): the
 *                                    user's messages are still stored, staff are
 *                                    not notified, the bot does not answer and
 *                                    nothing is sent to him. The account itself
 *                                    is not touched (that is User 360 → Профиль).
 * Every change except «read» is written to the audit journal.
 */

const Patch = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read') }),
  z.object({ action: z.literal('assign'), assigneeId: z.string().uuid().nullable() }),
  z.object({ action: z.literal('close') }),
  z.object({ action: z.literal('reopen') }),
  z.object({ action: z.literal('mode'), mode: z.enum(['manual', 'auto']) }),
  z.object({ action: z.literal('whatsapp_opt_out'), value: z.boolean() }),
  z.object({ action: z.literal('block'), reason: z.string().trim().max(500).nullable().optional() }),
  z.object({ action: z.literal('unblock') }),
])

export async function GET(req: NextRequest, { params }: { params: { userId: string } }) {
  const g = await guardComm(req, 'inbox.view', params.userId)
  if (g.response) return g.response
  try {
    const view = await conversationView(g.sb, g.actor, params.userId)
    if (!view) return commError('Пользователь не найден', 404)
    return NextResponse.json({ ok: true, data: view })
  } catch (err) {
    console.error('[giga-admin/comm/user]', err instanceof Error ? err.message : err)
    return commError('Не удалось загрузить диалог', 500)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  const g = await guardComm(req, 'inbox.view', params.userId)
  if (g.response) return g.response
  const parsed = Patch.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return commError('Неверный запрос')
  const body = parsed.data
  if (body.action !== 'read' && !hasPermission(g.actor.role, 'inbox.manage')) {
    return NextResponse.json({ ok: false, error: 'Недостаточно прав', missing: ['inbox.manage'] }, { status: 403 })
  }
  const { sb, actor } = g

  try {
    if (body.action === 'read') {
      const t = await findThreadByUser(sb, params.userId)
      if (t && t.unread_staff > 0) await updateThread(sb, t.id, { unread_staff: 0 })
      return NextResponse.json({ ok: true })
    }

    const { data: exists } = await sb.from('profiles').select('id').eq('id', params.userId).maybeSingle()
    if (!exists) return commError('Пользователь не найден', 404)
    if (body.action === 'assign' && body.assigneeId) {
      const who = await staffRoleOfUser(body.assigneeId)
      if (who.status !== 'approved' || !hasPermission(who.staffRole, 'inbox.view')) {
        return commError('Этот сотрудник не может вести диалоги')
      }
    }

    let defaultMode: 'manual' | 'auto' = 'manual'
    try { defaultMode = (await getSetting('comm_bot_auto_default')) ? 'auto' : 'manual' } catch { /* default */ }
    const thread = await ensureThread(sb, params.userId, { defaultMode })

    let patch: Partial<CommThreadRow>
    switch (body.action) {
      case 'assign': patch = { assignee_id: body.assigneeId }; break
      case 'close': patch = { status: 'closed', staff_reply_due_at: null, unread_staff: 0 }; break
      case 'reopen': patch = { status: thread.last_inbound_at && (!thread.last_outbound_at || thread.last_inbound_at > thread.last_outbound_at) ? 'waiting_staff' : 'open' }; break
      case 'mode': patch = { mode: body.mode }; break
      case 'whatsapp_opt_out': patch = { whatsapp_opt_out_at: body.value ? new Date().toISOString() : null }; break
      case 'block': patch = { blocked_at: new Date().toISOString(), blocked_by: actor.id, block_reason: body.reason || null, staff_reply_due_at: null, escalated_at: null }; break
      case 'unblock': patch = { blocked_at: null, blocked_by: null, block_reason: null }; break
    }
    if (body.action === 'reopen' && patch.status === 'waiting_staff') {
      const { minutes, window } = await loadReplyDeadline()
      patch.staff_reply_due_at = replyDueAt(new Date(), minutes, window).toISOString()
      patch.escalated_at = null
    }
    await updateThread(sb, thread.id, patch)

    const oldValue = Object.fromEntries(Object.keys(patch).map((k) => [k, thread[k as keyof CommThreadRow]]))
    await recordAdminAction(actor, {
      action: `comm.thread.${body.action}`,
      entityType: 'comm_thread', entityId: thread.id, targetUserId: params.userId,
      oldValue, newValue: patch,
    }, req)

    return NextResponse.json({ ok: true, data: threadDTO({ ...thread, ...patch } as CommThreadRow) })
  } catch (err) {
    console.error('[giga-admin/comm/user] patch failed', err instanceof Error ? err.message : err)
    return commError('Не удалось сохранить', 500)
  }
}
