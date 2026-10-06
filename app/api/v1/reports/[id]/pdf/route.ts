// GET /api/v1/reports/:id/pdf — PDF of one published report version.
//
// Rendered on demand from report_versions.content only (lib/reports/version-pdf.ts
// explains why it is not stored). Same access rules as GET /api/v1/reports/:id.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiError, dbError, safeErrorMessage } from '@/lib/api-error'
import { pdfDisposition, publishedReportForCaller } from '@/lib/reports/client-access'
import { renderReportVersionPdf } from '@/lib/reports/version-pdf'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const found = await publishedReportForCaller(supabase, user?.id ?? null, params.id)
    if (!found.ok) {
      if (found.error === 'db') return dbError('api/v1/reports/:id/pdf', found.dbError, 'Не удалось загрузить отчёт')
      if (found.error === 'unauthenticated') return apiError('Требуется вход в систему', 401)
      return apiError('Отчёт не найден', 404)
    }
    const pdf = await renderReportVersionPdf(found.report.content)
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': pdfDisposition(found.report),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    console.error('[api/v1/reports/:id/pdf]', err)
    return apiError(safeErrorMessage(err, 'Не удалось сформировать PDF'), 500)
  }
}
