/**
 * Owner decision (103): the PDF of a report version carries «Версия N · дата»
 * (creation date in Asia/Almaty) on the cover and in the footer of every page,
 * and the watermark «На проверке эксперта» until the version is published.
 * Fails on the old renderer: it printed neither the version nor a watermark.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: { $executeRaw: vi.fn(async () => 1) } }))

const { buildPointAReportContent } = await import('@/lib/reports/snapshot')
const { renderReportVersionPdf, REVIEW_WATERMARK } = await import('@/lib/reports/version-pdf')
const { versionStamp } = await import('@/lib/reports/version-stamp')
const { pdfObjectPath, pdfStageFor, setReportPdfStorage, versionPdf, versionPdfFilename } = await import('@/lib/reports/pdf-store')
const { inputs } = await import('./fixtures')

async function pdfPages(pdf: Buffer): Promise<string[]> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: pdf })
  try {
    const r = await parser.getText()
    return r.pages.map((p: { text: string }) => p.text.replace(/\s+/g, ' '))
  } finally {
    await parser.destroy().catch(() => {})
  }
}

const content = buildPointAReportContent(inputs()).content
// 20:30 UTC on 5 Oct is 01:30 on 6 Oct in Asia/Almaty (UTC+5).
const CREATED = '2026-10-05T20:30:00.000Z'

describe('version stamp and watermark', () => {
  it('formats the stamp in Asia/Almaty', () => {
    expect(versionStamp(3, CREATED)).toBe('Версия 3 · 06.10.2026')
  })

  it('prints «Версия N · дата» on the cover and on every page; the review copy carries the watermark on every page', async () => {
    const pages = await pdfPages(await renderReportVersionPdf(content, { version: { number: 3, createdAt: CREATED }, watermark: REVIEW_WATERMARK }))
    expect(pages.length).toBeGreaterThan(1)
    for (const [i, text] of pages.entries()) {
      expect(text, `page ${i + 1}`).toContain('Версия 3 · 06.10.2026')
      expect(text, `page ${i + 1}`).toContain('На проверке эксперта')
    }
    // Cover: the stamp sits under the generation date as well as in the footer.
    expect(pages[0].match(/Версия 3 · 06\.10\.2026/g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('the published copy has the stamp and no watermark', async () => {
    const pages = await pdfPages(await renderReportVersionPdf(content, { version: { number: 3, createdAt: CREATED } }))
    expect(pages.join(' ')).toContain('Версия 3 · 06.10.2026')
    expect(pages.join(' ')).not.toContain('На проверке эксперта')
  })
})

describe('pdf-store stages', () => {
  const v = { id: '11111111-2222-4333-8444-555555555555', company_id: 'co-1', version: 3, created_at: CREATED, content, pdf_storage_path: null as string | null }

  it('in_review → review stage (watermark), published → final; the path names the stage', () => {
    expect(pdfStageFor({ status: 'in_review', published_at: null })).toBe('review')
    expect(pdfStageFor({ status: 'published', published_at: CREATED })).toBe('final')
    expect(pdfStageFor({ status: 'superseded', published_at: CREATED })).toBe('final')
    expect(pdfObjectPath(v, 'review')).toBe('co-1/11111111-2222-4333-8444-555555555555/review-v3.pdf')
    expect(pdfObjectPath(v, 'final')).toBe('co-1/11111111-2222-4333-8444-555555555555/v3.pdf')
    expect(versionPdfFilename(v, 'review')).toBe('aistart360-point_a-v3-2026-10-06-review.pdf')
  })

  it('renders once and stores; the next read comes from storage; without storage it still serves the PDF', async () => {
    const objects = new Map<string, Buffer>()
    const uploads: string[] = []
    setReportPdfStorage({
      configured: () => true,
      upload: async (path, bytes) => { uploads.push(path); objects.set(path, bytes) },
      download: async (path) => objects.get(path) ?? null,
    })
    try {
      const first = await versionPdf({ ...v, status: 'in_review', published_at: null })
      expect(first).toMatchObject({ stage: 'review', stored: true, path: 'co-1/11111111-2222-4333-8444-555555555555/review-v3.pdf' })
      const again = await versionPdf({ ...v, status: 'in_review', published_at: null, pdf_storage_path: first.path })
      expect(again.bytes.equals(first.bytes)).toBe(true)
      expect(uploads).toHaveLength(1)
      // Published: the stored review copy is not reused — the final copy is rendered once.
      const final = await versionPdf({ ...v, status: 'published', published_at: CREATED, pdf_storage_path: first.path })
      expect(final.stage).toBe('final')
      expect(uploads).toEqual([first.path, 'co-1/11111111-2222-4333-8444-555555555555/v3.pdf'])
      expect((await pdfPages(final.bytes)).join(' ')).not.toContain('На проверке эксперта')
    } finally {
      setReportPdfStorage({ configured: () => false, upload: async () => { throw new Error('off') }, download: async () => null })
    }
    const offline = await versionPdf({ ...v, status: 'published', published_at: CREATED })
    expect(offline).toMatchObject({ stored: false, path: null })
    expect(offline.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    setReportPdfStorage(null)
  })
})
