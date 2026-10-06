import { NextRequest } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { apiError, dbError, safeErrorMessage } from '@/lib/api-error'
import { pdfDisposition } from '@/lib/reports/client-access'
import { versionPdf } from '@/lib/reports/pdf-store'
import { getReportVersion } from '@/lib/reports/versions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/giga-admin/reports/:id/pdf — staff preview of any version (same
 * renderer, content only): «Версия N · дата», and the watermark «На проверке
 * эксперта» until the version is published. agents.view (report versions) or
 * reports.review (SuperExpert reviewing in its cabinet).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireGiga(req, 'dashboard.view')
  if (g.response) return g.response
  if (!g.actor.permissions.includes('agents.view') && !g.actor.permissions.includes('reports.review')) {
    return apiError('Недостаточно прав', 403)
  }
  if (!UUID.test(params.id)) return apiError('Версия отчёта не найдена', 404)
  let item
  try {
    item = await getReportVersion(params.id)
  } catch (err) {
    return dbError('giga-admin/reports/:id/pdf', err as { message?: string; code?: string }, 'Не удалось загрузить версию отчёта')
  }
  if (!item) return apiError('Версия отчёта не найдена', 404)
  try {
    const pdf = (await versionPdf(item)).bytes
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': pdfDisposition(item).replace(/^attachment/, 'inline'),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    console.error('[giga-admin/reports/:id/pdf]', err)
    return apiError(safeErrorMessage(err, 'Не удалось сформировать PDF'), 500)
  }
}
