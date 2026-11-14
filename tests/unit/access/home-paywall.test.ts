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
vi.mock('@/components/client/ExpertMessages', () => ({ default: () => null }))

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
    expect(out).toContain('подробный разбор — в платном доступе')
    expect(out).toContain('полный GRI — в платном доступе')
    // the free parts stay: the questionnaire and the documents
    expect(out).toContain('Анкета заполнена')
  })

  it('paid (or gates off) → the sections as before, no paywall', () => {
    for (const locked of [undefined, { point_a: false, gri_full: false }]) {
      const out = render(locked)
      expect(out).toContain('point-a-summary')
      expect(out).toContain('gri-section')
      expect(out).not.toContain('data-paywall')
    }
  })
})
