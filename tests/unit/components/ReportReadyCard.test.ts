// R-025: «Ваш отчёт готов» on /client/home (components/reports/ReportReadyCard.tsx) —
// only a published version makes the card; the card links the report section of
// Point A and the PDF of exactly that version. Rendered with react-dom/server.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { pickPublishedReport, ReportReadyCard, REPORT_SECTION_HREF } from '@/components/reports/ReportReadyCard'
import { reportsListUrl } from '@/components/reports/PublishedReports'

describe('R-025 pickPublishedReport', () => {
  it('no rows / only drafts → null (no card)', () => {
    expect(pickPublishedReport(null)).toBeNull()
    expect(pickPublishedReport([])).toBeNull()
    expect(pickPublishedReport([{ id: 'd', version: 1, title: 'x', status: 'draft', published_at: null }])).toBeNull()
    expect(pickPublishedReport([{ id: 'd', version: 1, title: 'x', status: 'in_review', published_at: '2026-10-01T00:00:00Z' }])).toBeNull()
  })

  it('takes the latest publication', () => {
    const r = pickPublishedReport([
      { id: 'a', version: 1, title: 'T', status: 'published', published_at: '2026-10-01T00:00:00Z', created_at: '2026-09-30T00:00:00Z' },
      { id: 'b', version: 2, title: 'T', status: 'published', published_at: '2026-10-05T00:00:00Z', created_at: '2026-10-04T00:00:00Z' },
    ])
    expect(r).toEqual({ id: 'b', version: 2, title: 'T', published_at: '2026-10-05T00:00:00Z', created_at: '2026-10-04T00:00:00Z' })
  })
})

describe('R-025 ReportReadyCard', () => {
  const html = renderToStaticMarkup(createElement(ReportReadyCard, {
    report: { id: 'v-1', version: 3, title: 'Точка А: ТОО Ромашка', published_at: '2026-10-06T10:00:00.000Z', created_at: '2026-10-05T20:30:00.000Z' },
  }))

  it('says the report is ready, with the version stamp', () => {
    expect(html).toContain('Ваш отчёт готов')
    expect(html).toContain('Версия 3 · 06.10.2026')
  })

  it('links the report on Point A and the PDF of this version', () => {
    expect(REPORT_SECTION_HREF).toBe('/client/point-a#reports')
    expect(html).toContain(`href="${REPORT_SECTION_HREF}"`)
    expect(html).toContain('href="/api/v1/reports/v-1/pdf"')
  })
})

describe('R-025 PublishedReports on Point A v4: the list of the company the page shows', () => {
  it('with the company id → that company, without → the default company', () => {
    expect(reportsListUrl('c0ffee00-0000-4000-8000-000000000001')).toBe('/api/v1/reports?companyId=c0ffee00-0000-4000-8000-000000000001')
    expect(reportsListUrl(null)).toBe('/api/v1/reports')
    expect(reportsListUrl('  ')).toBe('/api/v1/reports')
  })
})
