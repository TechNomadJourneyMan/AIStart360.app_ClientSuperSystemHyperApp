// GET /r/v/<token>/pdf — the PDF of exactly the version the signed link names
// (lib/reports/version-link.ts). Opens only a version that was published to
// the client and not withdrawn; a version waiting for the expert never opens.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { type NextRequest } from 'next/server'
import { pdfDisposition } from '@/lib/reports/client-access'
import { versionPdf } from '@/lib/reports/pdf-store'
import { resolveVersionLink } from '@/lib/reports/version-link'

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const link = await resolveVersionLink(params.token)
    if (!link.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'Ссылка недействительна или истекла' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })
    }
    const pdf = await versionPdf(link.version, { stage: 'final' })
    return new Response(new Uint8Array(pdf.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': pdfDisposition(link.version),
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
      },
    })
  } catch (err) {
    console.error('[r/v/:token/pdf]', err instanceof Error ? err.message.split('\n')[0] : err)
    return new Response(JSON.stringify({ ok: false, error: 'Не удалось сформировать PDF' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }
}
