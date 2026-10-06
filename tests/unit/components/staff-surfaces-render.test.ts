/**
 * Staff / expert surfaces render real data or an honest state — no invented
 * values: portfolio GRI panel (null sections → «нет данных», no «$2M»
 * benchmark), expert «Отчёты» (published versions or «Отчёты появятся после
 * публикации», no sample rows) and /intelligence tiles (no constant '0' /
 * 'Active'). Server components rendered with react-dom/server.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const s = vi.hoisted(() => ({
  viewer: { id: 'expert-1', role: 'expert', email: null } as { id: string; role: string; email: string | null } | null,
  reports: [] as Array<Record<string, unknown>>,
  reportsError: null as { message: string } | null,
  stats: null as unknown,
}))

vi.mock('@/lib/expert-auth', () => ({ requireExpert: async () => s.viewer }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const b = {
        select: () => b,
        eq: () => b,
        order: () => b,
        limit: async () => (s.reportsError ? { data: null, error: s.reportsError } : { data: table === 'report_versions' ? s.reports : [], error: null }),
        in: async () => ({ data: [{ id: 'co-1', name: 'ТОО Ромашка' }], error: null }),
      }
      return b
    },
  }),
}))
vi.mock('@/lib/intelligence/stats', () => ({ getIntelligenceStats: async () => s.stats }))

import { PortfolioGriPanel } from '@/components/dashboard/PortfolioGriPanel'
import ExpertReportsPage from '@/app/(expert)/expert/reports/page'
import IntelligencePage from '@/app/(dashboard)/intelligence/page'

beforeEach(() => {
  s.viewer = { id: 'expert-1', role: 'expert', email: null }
  s.reports = []
  s.reportsError = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const render = (el: ReactElement) => renderToStaticMarkup(el)

describe('PortfolioGriPanel', () => {
  const full = { overall: 6.25, product: 7, trust: 5, bizmodel: 6, cash: 4.5, ops: 8, team: 3, founder: 6.5, reportCount: 3 }

  it('shows the real averages, the number of assessments and no invented benchmark', () => {
    const html = render(createElement(PortfolioGriPanel, { data: full }))
    expect(html).toContain('6.25')
    expect(html).toContain('3 оценки')
    expect(html).toContain('Команда')
    expect(html).toContain('fill="rgba(110,255,192,0.10)"') // complete set → data polygon drawn
    expect(html).not.toContain('$2M')
    expect(html).not.toContain('Эталон')
  })

  it('a section without data says «нет данных», not 0.0', () => {
    const html = render(createElement(PortfolioGriPanel, { data: { ...full, team: null, founder: null } }))
    expect(html.match(/нет данных/g)).toHaveLength(2)
    expect(html).not.toContain('fill="rgba(110,255,192,0.10)"') // no polygon through a missing axis
    expect(html).not.toContain('>0.0<')
  })

  it('empty and failed states are different', () => {
    expect(render(createElement(PortfolioGriPanel, { data: null }))).toContain('Оценок GRI пока нет')
    const failed = render(createElement(PortfolioGriPanel, { data: null, failed: true }))
    expect(failed).toContain('Не удалось загрузить оценки GRI')
    expect(failed).toContain('role="alert"')
  })
})

describe('Expert «Отчёты» page', () => {
  it('no published reports → honest empty state, no sample rows or fake upload', async () => {
    const html = render(await ExpertReportsPage({}))
    expect(html).toContain('Отчёты появятся после публикации')
    expect(html).not.toContain('GRI Full Report')
    expect(html).not.toContain('2.4 MB')
    expect(html).not.toContain('Перетащите файл')
  })

  it('lists published versions with the client and a PDF link through the access-checked route', async () => {
    s.reports = [{ id: 'r1', company_id: 'co-1', report_type: 'point_a', version: 2, status: 'published', title: 'Отчёт Точки А', confidence: 0.8, published_at: '2026-10-01T10:00:00Z' }]
    const html = render(await ExpertReportsPage({}))
    expect(html).toContain('Отчёт Точки А')
    expect(html).toContain('ТОО Ромашка')
    expect(html).toContain('версия 2')
    expect(html).toContain('80%')
    expect(html).toContain('href="/api/v1/reports/r1/pdf"')
  })

  it('a non-expert gets no data; a DB error is shown as an error', async () => {
    s.viewer = null
    expect(render(await ExpertReportsPage({}))).toContain('Нет доступа')
    s.viewer = { id: 'expert-1', role: 'expert', email: null }
    s.reportsError = { message: 'boom' }
    expect(render(await ExpertReportsPage({}))).toContain('Не удалось загрузить отчёты')
  })
})

describe('/intelligence tiles', () => {
  it('render the measured values and failures, no constants', async () => {
    s.stats = {
      auditEvents: { ok: true, value: 41 },
      clients: { ok: false },
      aiInsights: { ok: true, value: { total: 6, awaitingReview: 4 } },
      health: { db: { status: 'degraded', latencyMs: 230 }, missingEnv: 0, allOnline: false },
    }
    const html = render(await IntelligencePage())
    expect(html).toContain('>41<')
    expect(html).toContain('не удалось загрузить')
    expect(html).toContain('>6<')
    expect(html).toContain('ждут проверки: 4')
    expect(html).toContain('Есть сбои')
    expect(html).toContain('БД отвечает медленно (230 мс)')
    expect(html).not.toContain('Active')
  })
})
