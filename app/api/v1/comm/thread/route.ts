export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { clientFeed } from '@/lib/comm/client'
import { findThreadByUser, listMessages, updateThread } from '@/lib/comm/store'

/**
 * GET /api/v1/comm/thread — the signed-in user's conversation with the
 * platform (cabinet «Сообщения»). The user comes from the session only — no
 * ids in the request. Reading clears the user's unread counter.
 */
export async function GET() {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  try {
    const thread = await findThreadByUser(sb, user.id)
    if (!thread) return NextResponse.json({ ok: true, data: { thread: null, messages: [] } })
    const rows = await listMessages(sb, thread.id)
    if (thread.unread_user > 0) await updateThread(sb, thread.id, { unread_user: 0 })
    return NextResponse.json({
      ok: true,
      data: {
        thread: { id: thread.id, status: thread.status === 'closed' ? 'closed' : 'open' },
        messages: clientFeed(rows),
      },
    })
  } catch (err) {
    console.error('[v1/comm/thread]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить сообщения' }, { status: 500 })
  }
}
