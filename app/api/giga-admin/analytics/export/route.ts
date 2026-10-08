export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { csvFilename, csvResponse, toCsv } from '@/lib/admin/csv'
import { clampDays, loadActivitySeries, loadRetentionCohorts } from '@/lib/analytics/load'
import { activityCsv, cohortsCsv, funnelCsv, type CsvTable } from '@/lib/analytics/reports'

/**
 * GET /api/giga-admin/analytics/export?report=funnel|activity|cohorts&days=30
 *
 * CSV (Excel-формат lib/admin/csv) с агрегатами — без персональных данных.
 * Право analytics.view; каждая выгрузка пишется в журнал (analytics.exported).
 */
const REPORTS = ['funnel', 'activity', 'cohorts'] as const
type Report = (typeof REPORTS)[number]

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'analytics.view')
  if (guard.response) return guard.response
  const sp = req.nextUrl.searchParams
  const report = sp.get('report') as Report | null
  if (!report || !REPORTS.includes(report)) {
    return NextResponse.json({ ok: false, error: 'Неизвестный отчёт' }, { status: 400 })
  }
  const days = clampDays(sp.get('days'))
  const weeks = Math.min(26, Math.max(1, Number(sp.get('weeks')) || 8))

  let table: CsvTable
  try {
    if (report === 'activity') {
      table = activityCsv(await loadActivitySeries(days))
    } else if (report === 'cohorts') {
      table = cohortsCsv(await loadRetentionCohorts(weeks))
    } else {
      const { data, error } = await createServiceClient().rpc('admin_overview', { p_days: days })
      if (error) throw new Error(error.message)
      const funnel = ((data as { funnel?: Array<{ key: string; count: number }> } | null)?.funnel ?? [])
      table = funnelCsv(funnel.map((f) => ({ key: String(f.key), count: Number(f.count) || 0 })))
    }
  } catch (e) {
    console.error('[giga-admin/analytics/export] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, error: 'Не удалось выгрузить отчёт' }, { status: 500 })
  }

  await recordAdminAction(guard.actor, {
    action: 'analytics.exported',
    entityType: 'analytics',
    entityId: report,
    metadata: { report, days, weeks, rows: table.rows.length },
  }, req)

  return csvResponse(toCsv(table.headers, table.rows), csvFilename(`aistart360-${report}`))
}
