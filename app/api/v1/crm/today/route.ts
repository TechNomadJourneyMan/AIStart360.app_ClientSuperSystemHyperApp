export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { loadCrmToday } from '@/lib/crm/today'

/**
 * GET /api/v1/crm/today — «Кому звонить сегодня»: the owner's queue, risk list and KPI over their
 * WHOLE base (every client, read page by page), for the Almaty day. The rules live in
 * lib/crm/today.ts (queueBucket), shared with the AI briefing and the morning digest.
 *
 * Shape: { day, stats, todayClients, riskClients, riskClientsTotal, aiBriefing: null }.
 */
export async function GET() {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const res = await loadCrmToday(sb, userData.user.id, Date.now())
  if (!res.ok) {
    // A failed read is an error — never an empty queue that looks like «всё сделано».
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }
  return NextResponse.json(res.data)
}
