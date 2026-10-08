import { NextRequest, NextResponse } from 'next/server'
import { rejectUnauthorizedCron } from '@/lib/automation/cron-auth'
import { runReminders } from '@/lib/automation/reminders'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/reminders — ежедневные напоминания клиентам и приветственная
 * серия (F-057, F-058). Расписание — vercel.json (06:00 UTC = 11:00 Алматы).
 *
 * Логика — lib/automation/reminders.ts; отправка — notifyClient с учётом
 * настроек клиента («Напоминания»), выключателя auto_reminders_enabled и
 * потолка auto_touch_weekly_cap. Повторный запуск в тот же день безопасен:
 * каждое касание защищено ключом идемпотентности.
 *
 * Auth: только заголовок `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const denied = rejectUnauthorizedCron(req)
  if (denied) return denied
  try {
    const stats = await runReminders(new Date())
    return NextResponse.json({ ok: true, data: stats })
  } catch (err) {
    console.error('[cron/reminders] failed', err)
    return NextResponse.json({ ok: false, error: 'reminders failed' }, { status: 500 })
  }
}
