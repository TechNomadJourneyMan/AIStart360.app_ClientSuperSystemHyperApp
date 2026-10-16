export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { recordAdminAction } from '@/lib/admin/audit'
import { guardClientAccess, isUuid } from '@/lib/admin/client-scope'
import { commError, guardComm } from '@/lib/comm/admin'

/**
 * GET /api/giga-admin/comm/messages/:messageId/original (inbox.view)
 * The text of an inbound message as the user wrote it — the feed shows the
 * masked version of a message with profanity («Показать»). Only within the
 * actor's client scope; every read is written to the audit journal.
 */
export async function GET(req: NextRequest, { params }: { params: { messageId: string } }) {
  if (!isUuid(params.messageId)) return commError('invalid id')
  const g = await guardComm(req, 'inbox.view')
  if (g.response) return g.response

  const { data: msg } = await g.sb.from('comm_messages').select('id, thread_id, body, body_masked').eq('id', params.messageId).maybeSingle()
  const m = msg as { id: string; thread_id: string; body: string; body_masked: string | null } | null
  if (!m) return commError('Сообщение не найдено', 404)
  const { data: thread } = await g.sb.from('comm_threads').select('user_id').eq('id', m.thread_id).maybeSingle()
  const userId = (thread as { user_id?: string } | null)?.user_id
  if (!userId) return commError('Сообщение не найдено', 404)
  const denied = await guardClientAccess(g.actor, userId)
  if (denied) return denied

  if (m.body_masked) {
    await recordAdminAction(g.actor, {
      action: 'comm.message.original_viewed',
      entityType: 'comm_message', entityId: m.id, targetUserId: userId,
    }, req)
  }
  return NextResponse.json({ ok: true, data: { id: m.id, body: m.body } })
}
