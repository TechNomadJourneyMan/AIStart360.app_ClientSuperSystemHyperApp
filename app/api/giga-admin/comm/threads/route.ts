export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { commError, guardComm, isThreadFilter, listThreads } from '@/lib/comm/admin'

/**
 * GET /api/giga-admin/comm/threads?filter=all|waiting|mine|unassigned|overdue|auto|closed&q=
 * Conversations of GIGA «Сообщения» (inbox.view): newest first, «ждут ответа»
 * and «просрочены» by the reply deadline. `q` searches name, email and company.
 * An expert with «только назначенные» sees only his clients.
 */
export async function GET(req: NextRequest) {
  const g = await guardComm(req, 'inbox.view')
  if (g.response) return g.response
  const sp = req.nextUrl.searchParams
  const filter = sp.get('filter') || 'all'
  if (!isThreadFilter(filter)) return commError('Неверный фильтр')
  try {
    const res = await listThreads(g.sb, g.actor, { filter, q: sp.get('q'), limit: Number(sp.get('limit')) || 100 })
    return NextResponse.json({ ok: true, ...res })
  } catch (err) {
    console.error('[giga-admin/comm/threads]', err instanceof Error ? err.message : err)
    return commError('Не удалось загрузить диалоги', 500)
  }
}
