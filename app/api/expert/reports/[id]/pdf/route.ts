import { NextResponse, type NextRequest } from 'next/server'
import { expertBlockResponse, guardExpertReport, resolveExpert } from '@/lib/expert-auth'
import { pdfDisposition } from '@/lib/reports/client-access'
import { versionPdf } from '@/lib/reports/pdf-store'
import { getReportVersion } from '@/lib/reports/versions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/expert/reports/:id/pdf — the PDF of a version for the expert:
 * waiting for review (watermark «На проверке эксперта») or published. An
 * expert reads the reports of their assigned clients only; staff Admin /
 * Super Admin — every company (guardExpertReport, SR-03).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  if (!UUID.test(params.id)) return NextResponse.json({ ok: false, error: 'Версия отчёта не найдена' }, { status: 404 })
  const denied = await guardExpertReport(auth.viewer, params.id)
  if (denied) return denied
  try {
    const v = await getReportVersion(params.id)
    if (!v || !(v.status === 'in_review' || v.status === 'published' || v.published_at)) {
      return NextResponse.json({ ok: false, error: 'Версия отчёта не найдена' }, { status: 404 })
    }
    const pdf = await versionPdf(v)
    return new Response(new Uint8Array(pdf.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': pdfDisposition(v).replace(/^attachment/, 'inline'),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    console.error('[api/expert/reports/:id/pdf]', err instanceof Error ? err.message.split('\n')[0] : err)
    return NextResponse.json({ ok: false, error: 'Не удалось сформировать PDF' }, { status: 500 })
  }
}
