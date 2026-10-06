import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { dbError } from '@/lib/api-error'
import { listReportVersions } from '@/lib/reports/versions'
import { REPORT_STATUSES, REPORT_TYPES, type ReportStatus, type ReportType } from '@/lib/reports/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/giga-admin/reports?company=&status=&type=&limit=
 * Report versions (newest first) without their content. Viewing needs
 * agents.view (reports are agent output); publishing is reports.publish.
 */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  const q = req.nextUrl.searchParams
  const status = q.get('status')
  const type = q.get('type')
  try {
    const items = await listReportVersions({
      companyId: q.get('company')?.slice(0, 64) || null,
      status: status && (REPORT_STATUSES as readonly string[]).includes(status) ? (status as ReportStatus) : null,
      reportType: type && (REPORT_TYPES as readonly string[]).includes(type) ? (type as ReportType) : null,
      limit: Number(q.get('limit') ?? 100) || 100,
    })
    return NextResponse.json({
      ok: true,
      items,
      can: { publish: g.actor.permissions.includes('reports.publish'), run: g.actor.permissions.includes('agents.run') },
    })
  } catch (err) {
    return dbError('giga-admin/reports', err as { message?: string; code?: string }, 'Не удалось загрузить версии отчётов')
  }
}
