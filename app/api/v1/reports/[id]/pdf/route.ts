// GET /api/v1/reports/:id/pdf — PDF of one published report version.
//
// Same access rules as GET /api/v1/reports/:id (the caller's session, RLS,
// status 'published', tenancy). The file is exactly that version: rendered
// from report_versions.content only, with «Версия N · дата» on the cover and
// in the footer, stored once in private Storage (lib/reports/pdf-store.ts) and
// served from there; rendered in memory when Storage is unavailable.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiError, dbError, safeErrorMessage } from '@/lib/api-error'
import { pdfDisposition, publishedReportForCaller } from '@/lib/reports/client-access'
import { versionPdf } from '@/lib/reports/pdf-store'
import { getReportVersion } from '@/lib/reports/versions'

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
    // Access is decided above (RLS + tenancy); the storage columns are read server-side.
    const full = await getReportVersion(found.report.id)
    if (!full || full.status !== 'published') return apiError('Отчёт не найден', 404)
    const pdf = await versionPdf(full, { stage: 'final' })
    return new Response(new Uint8Array(pdf.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': pdfDisposition(full),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    console.error('[api/v1/reports/:id/pdf]', err)
    return apiError(safeErrorMessage(err, 'Не удалось сформировать PDF'), 500)
  }
}
