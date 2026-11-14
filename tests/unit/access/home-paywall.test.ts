/**
 * R2-A: the client home for a Free account (gates on). The paid blocks —
 * the Point A summary and the full GRI — become the one paywall (compact) and
 * their data is not requested; the free parts of the page stay. The server
 * decision reaches the page as `paidLocked` (app/client/home/page.tsx).
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildUserProfileSummary } from '@/lib/user-dashboard/summary'

// Mounting either would request paid data (Point A state / GRI assessment) — a test failure here.
vi.mock('@/components/dashboard/PointADashboardSummary', () => ({ default: () => React.createElement('div', { id: 'point-a-summary' }) }))
vi.mock('@/components/user-dashboard/GriSection', () => ({ default: () => React.createElement('div', { id: 'gri-section' }) }))
// R2-C (M-4): the expert's review is part of Точка А — mounting it would request /api/v1/expert-review.
vi.mock('@/components/client/ExpertMessages', () => ({ default: () => React.createElement('div', { id: 'expert-messages' }) }))

const { default: UserHome } = await import('@/components/user-dashboard/UserHome')

const base = {
  fullName: 'Иван', email: 'ivan@corp.kz', status: 'approved', surveyStartedAt: '2026-11-01', surveyUpdatedAt: null,
  summary: buildUserProfileSummary({}),
  diagnostics: { overallScore: 61, stage: 'growth', calculatedAt: '2026-11-10' },
  gri: null, documentsCount: 2,
  sections: [{ key: 'point_a', title: 'Точка А', description: null, icon: 'my_location', href: '/client/point-a' }],
  materials: [], unavailableSection: null,
}

const render = (paidLocked?: { point_a: boolean; gri_full: boolean }) =>
  renderToStaticMarkup(React.createElement(UserHome, { data: { ...base, paidLocked } }))

describe('client home and the paid sections', () => {
  it('Free (both closed): compact paywalls instead of the Point A summary and the GRI block', () => {
    const out = render({ point_a: true, gri_full: true })
    expect(out).toContain('data-paywall="point_a"')
    expect(out).toContain('data-paywall="gri_full"')
    expect(out).not.toContain('point-a-summary')
    expect(out).not.toContain('gri-section')
    expect(out).not.toContain('expert-messages') // R2-C (M-4)
    expect(out).toContain('подробный разбор — в платном доступе')
    expect(out).toContain('полный GRI — в платном доступе')
    // the free parts stay: the questionnaire and the documents
    expect(out).toContain('Анкета заполнена')
  })

  it('R2-C (review L-1, F1): Free with a published report — ONE Point A paywall on the page, it is the anchor #expert the card and the expert notices lead to', async () => {
    const { ReportReadyCard } = await import('@/components/reports/ReportReadyCard')
    const report = { id: 'v-1', version: 1, title: 'Точка А', published_at: '2026-11-12T10:00:00Z', created_at: '2026-11-12T09:00:00Z' }
    const page = renderToStaticMarkup(React.createElement(React.Fragment, null,
      React.createElement(ReportReadyCard, { report, locked: true }),
      React.createElement(UserHome, { data: { ...base, paidLocked: { point_a: true, gri_full: false } } })))
    expect(page.match(/data-paywall="point_a"/g)).toHaveLength(1)
    expect(page.match(/id="paywall-point_a-title"/g)).toHaveLength(1)
    expect(page).toContain('href="#expert"')
    expect(page.match(/id="expert"/g)).toHaveLength(1)
    expect(page).not.toContain('expert-messages')
  })

  it('R2-C (review F1): the anchor #expert exists for Free even before the first diagnostic (a comment notice never lands nowhere)', () => {
    const out = renderToStaticMarkup(React.createElement(UserHome, { data: { ...base, diagnostics: null, paidLocked: { point_a: true, gri_full: true } } }))
    expect(out).toContain('id="expert"')
    expect(out.match(/data-paywall="point_a"/g)).toHaveLength(1)
  })

  it('paid (or gates off) → the sections as before, no paywall', () => {
    for (const locked of [undefined, { point_a: false, gri_full: false }]) {
      const out = render(locked)
      expect(out).toContain('point-a-summary')
      expect(out).toContain('gri-section')
      expect(out).toContain('expert-messages')
      expect(out).not.toContain('data-paywall')
    }
  })
})
