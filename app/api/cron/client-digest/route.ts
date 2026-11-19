import { NextRequest, NextResponse } from 'next/server'
import { rejectUnauthorizedCron } from '@/lib/automation/cron-auth'
import { runClientDigest } from '@/lib/automation/client-digest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/client-digest — еженедельный дайджест клиенту + лучший NBA
 * (F-059). Расписание — lib/cron/schedule.ts: понедельник 04:26 UTC = 09:26 Алматы (R-230) и догоняющий
 * прогон в 05:26 UTC — только для клиентов без дайджеста этой недели (ревью волны 1A).
 *
 * Логика — lib/automation/client-digest.ts. Выключается целиком настройкой
 * client_digest_enabled; клиент выключает у себя категорию «Еженедельный
 * дайджест». Ключ client_digest:<user>:<понедельник> — повторный запуск в ту
 * же неделю ничего не пришлёт.
 *
 * Auth: только заголовок `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const denied = rejectUnauthorizedCron(req)
  if (denied) return denied
  try {
    const stats = await runClientDigest(new Date())
    return NextResponse.json({ ok: true, data: stats })
  } catch (err) {
    console.error('[cron/client-digest] failed', err)
    return NextResponse.json({ ok: false, error: 'client digest failed' }, { status: 500 })
  }
}
