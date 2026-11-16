import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { runJobWatchdog, WATCHDOG_UNDELIVERED_HTTP } from '@/lib/ops/job-watchdog'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/ops-watchdog — сторож задач (R4-A1), раз в 10 минут (lib/cron/schedule.ts).
 *
 * Сверяет журнал исходов public.ops_job_runs (миграция 154) с расписанием кронов и функций Inngest
 * («не запускалась N часов», «падает»), смотрит очередь пересчёта Точки А, проверки мониторинга
 * без ИИ (не зависят от «Агентов 24/7»), демо-аккаунты, сервис агентов и есть ли куда слать тревоги;
 * зовёт Super Admin — об одной проблеме не чаще раза в 6 ч. Удаляет строки журналов старше 30 дней.
 * Логика — lib/ops/job-watchdog.ts.
 *
 * Без миграции 154 остальные проверки работают, в ответе journal = 'not_migrated'.
 * Если хотя бы одну тревогу не удалось отправить, проход доводится до конца (остальные тревоги,
 * чистка), но ответ — 502 «alerts_not_delivered» (NV-4): планировщик запишет исход как ошибку, и
 * ГИГА покажет «тревоги не доставлены», а не «в норме».
 * Auth: только заголовок `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 503 ? 'cron_not_configured' : 'unauthorized' }, { status: auth.status })
  }
  try {
    const report = await runJobWatchdog(new Date())
    if (report.status === 'undelivered') {
      return NextResponse.json({ ok: false, error: 'alerts_not_delivered', ...report }, { status: WATCHDOG_UNDELIVERED_HTTP })
    }
    return NextResponse.json({ ok: true, ...report })
  } catch (e) {
    console.error('[cron/ops-watchdog]', e instanceof Error ? e.message.split('\n')[0].slice(0, 200) : 'error')
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
