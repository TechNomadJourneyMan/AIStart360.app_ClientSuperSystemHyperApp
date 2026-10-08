import { NextRequest, NextResponse } from 'next/server'
import { rejectUnauthorizedCron } from '@/lib/automation/cron-auth'
import { runStaffDigest } from '@/lib/automation/staff-digest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/staff-digest — утренняя сводка персоналу (F-060).
 * Расписание — vercel.json: ежедневно 03:00 UTC = 08:00 Алматы.
 *
 * Админам — заявки дольше request_sla_hours и вчерашние регистрации / анкеты /
 * GRI; каждому исполнителю — его просроченные staff_tasks. Логика —
 * lib/automation/staff-digest.ts. CRM-дайджест владельцев бизнеса остаётся
 * отдельным cron-ом (/api/cron/crm-digest).
 *
 * Auth: только заголовок `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const denied = rejectUnauthorizedCron(req)
  if (denied) return denied
  try {
    const stats = await runStaffDigest(new Date())
    return NextResponse.json({ ok: true, data: stats })
  } catch (err) {
    console.error('[cron/staff-digest] failed', err)
    return NextResponse.json({ ok: false, error: 'staff digest failed' }, { status: 500 })
  }
}
