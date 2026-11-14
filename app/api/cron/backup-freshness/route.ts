import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { runBackupFreshness } from '@/lib/ops/backup-freshness'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/backup-freshness — сторож бэкапов (R-011), раз в час (lib/cron/schedule.ts).
 *
 * Читает журнал public.ops_backup_runs (миграция 142), который пишет скрипт
 * scripts/backup/railway-db-backup.sh, и зовёт Super Admin, если успешного бэкапа базы
 * нет дольше 10 ч или последний запуск упал. Об одной проблеме — не чаще раза в 6 ч.
 * Логика — lib/ops/backup-freshness.ts, порядок действий — docs/backup/README.md.
 *
 * Auth: только заголовок `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 503 ? 'cron_not_configured' : 'unauthorized' }, { status: auth.status })
  }
  try {
    const report = await runBackupFreshness(new Date())
    if (report.status === 'unavailable') {
      return NextResponse.json({ ok: false, error: 'migration_142_required' }, { status: 503 })
    }
    return NextResponse.json({ ok: true, ...report })
  } catch (e) {
    console.error('[cron/backup-freshness]', e instanceof Error ? e.name : 'error')
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
