// Client view of a published report (components/reports/PublishedReports.tsx):
// provenance badges with confidence, the PDF link, sources and dates — and
// only what the frozen content holds. Stateless views rendered with
// react-dom/server.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReportDetails, ReportSummaryCard } from '@/components/reports/PublishedReports'
import { buildPointAReportContent } from '@/lib/reports/snapshot'
import type { ClientReportSummary } from '@/lib/reports/client-access'
import { F_AI_REVIEWED, HIDDEN_HYPOTHESIS_TITLE, HIDDEN_RECOMMENDATION_TITLE, inputs } from '../reports/fixtures'

const content = buildPointAReportContent(inputs()).content

describe('ReportDetails', () => {
  const html = renderToStaticMarkup(createElement(ReportDetails, { content }))

  it('marks every finding and recommendation with its provenance', () => {
    const badges = [...html.matchAll(/data-provenance="([A-Z_]+)"/g)].map((m) => m[1])
    expect(badges.length).toBe(content.findings.length + content.recommendations.length)
    expect(badges).toEqual(expect.arrayContaining(['CALCULATED', 'AI_HYPOTHESIS', 'RECOMMENDATION']))
    const reviewed = content.findings.find((f) => f.id === F_AI_REVIEWED)!
    expect(html).toContain(reviewed.title)
    expect(html).toContain('Уверенность: 70%')
  })

  it('shows sources and the generation date, nothing that is not in the content', () => {
    expect(html).toContain('Источники данных')
    expect(html).toContain('заполнено шагов: 9 из 12')
    expect(html).toContain('Отчёт сформирован')
    expect(html).not.toContain(HIDDEN_HYPOTHESIS_TITLE)
    expect(html).not.toContain(HIDDEN_RECOMMENDATION_TITLE)
  })

  it('labels a model narrative as an AI hypothesis', () => {
    const withNarrative = renderToStaticMarkup(createElement(ReportDetails, {
      content: { ...content, narrative: { summary: 'Резюме модели', key_points: ['Пункт'], provenance_type: 'AI_HYPOTHESIS', model: 'm', prompt_version: 'p', generated_at: content.generated_at } },
    }))
    expect(withNarrative).toContain('Резюме модели')
    expect(withNarrative.match(/data-provenance="AI_HYPOTHESIS"/g)!.length).toBeGreaterThan(html.match(/data-provenance="AI_HYPOTHESIS"/g)!.length)
  })
})

describe('ReportSummaryCard', () => {
  it('links the PDF of this version', () => {
    const report: ClientReportSummary = {
      id: 'v-1', report_type: 'point_a', version: 3, title: 'Точка А: ТОО Ромашка', confidence: 0.62, data_hash: 'h',
      published_at: '2026-10-06T10:00:00.000Z', created_at: '2026-10-05T20:30:00.000Z', generated_at: content.generated_at, calculated_at: content.calculated_at,
      overall_score: 47, findings: 5, recommendations: 2, has_narrative: false,
    }
    const html = renderToStaticMarkup(createElement(ReportSummaryCard, { report, open: false, onToggle: () => {} }))
    expect(html).toContain('href="/api/v1/reports/v-1/pdf"')
    // Version number and its date in Asia/Almaty (UTC+5): 20:30 UTC on the 5th is the 6th there.
    expect(html).toContain('Версия 3 · 06.10.2026')
    expect(html).toContain('Ссылка на эту версию')
    expect(html).toContain('62%')
    expect(html).toContain('aria-expanded="false"')
  })
})
