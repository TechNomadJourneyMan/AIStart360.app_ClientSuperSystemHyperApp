/**
 * «Точка А на дашборде» (plan 2026-10-22, W1): the model built from the
 * Point A v4 state and the rendered block (react-dom/server, no DOM).
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/dashboard' }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

import { previewState } from '@/app/dev/point-a-preview/fixture'
import { evaluateGoal, type Goal } from '@/lib/goals/evaluate'
import type { PointAPageState } from '@/hooks/usePointAState'
import {
  attentionItems,
  buildDashboardSummary,
  parseGoalAmount,
  revenueGoalDraft,
  POINT_A_HREF,
  POINT_B_HREF,
} from '@/components/dashboard/point-a-summary-model'
import { DashboardGoals, PointADashboardSummaryView } from '@/components/dashboard/PointADashboardSummary'

const NOW = new Date()

function revenueGoal(period: '12m' | '3y', target: number, current: number | null): PointAPageState['goals'][number] {
  const goal: Goal = {
    id: `g-${period}`, metricId: 'biz.finansy.vyruchka_god', label: period, unit: '₸', targetValue: target, direction: 'higher_is_better',
    periodLabel: period, deadline: null, baselineValue: null, baselinePeriod: null, source: 'survey', note: null, createdAt: NOW.toISOString(),
  }
  return { goal, evaluation: evaluateGoal(goal, { value: current, period: current === null ? null : '2026-10' }, NOW) }
}

/** HONOR after the sync: 780 млн / 3,4 млрд, current revenue 310 млн. */
function honorState(): PointAPageState {
  const s = previewState()
  return { ...s, goals: [revenueGoal('12m', 780_000_000, 310_000_000), revenueGoal('3y', 3_400_000_000, 310_000_000)] }
}

describe('buildDashboardSummary', () => {
  it('score, confidence and completeness come from the v4 snapshot', () => {
    const state = previewState()
    const m = buildDashboardSummary(state)
    expect(m.hasSnapshot).toBe(true)
    expect(m.score).toBe(state.snapshot!.overall)
    expect(m.confidencePct).toBe(Math.round(state.snapshot!.confidence! * 100))
    expect(m.coveragePct).toBe(Math.round(state.snapshot!.coverage! * 100))
    expect(m.keyMetrics.length).toBeGreaterThan(0)
    expect(m.keyMetrics.length).toBeLessThanOrEqual(6)
    expect(m.headline).toMatch(/Общий балл/)
  })

  it('risks / quick wins / strengths are the v4 ones, not the v1 diagnostics («Ключевые риски 0»)', () => {
    const state = previewState()
    const m = buildDashboardSummary(state)
    const weak = state.snapshot!.blocks.filter((b) => !b.informational && b.score !== null && b.score < 60 && b.top_issues.length)
    if (weak.length) expect(m.risks.length).toBeGreaterThan(0)
    expect(m.risks.length).toBeLessThanOrEqual(3)
  })

  it('«Требует внимания»: discrepancies first, top 3, each with an action', () => {
    const state = previewState()
    const all = attentionItems(state)
    expect(all[0]).toMatchObject({ kind: 'discrepancy', title: 'Выручка (год) · 2024', action: { label: 'Решить', href: `${POINT_A_HREF}#pa-attention` } })
    const m = buildDashboardSummary(state)
    expect(m.attention.length).toBe(Math.min(3, all.length))
    expect(m.attentionTotal).toBe(all.length)
    for (const a of m.attention) expect(a.action.href).toMatch(/^\/client\//)
  })

  it('the two revenue goals with progress; other goals are counted', () => {
    const state = honorState()
    state.goals.push({ ...revenueGoal('12m', 40, 22), goal: { ...revenueGoal('12m', 40, 22).goal, id: 'g-m', metricId: 'biz.finansy.valovaya_marzha' } })
    const m = buildDashboardSummary(state)
    expect(m.goals['12m']).toMatchObject({ goalId: 'g-12m', target: 780_000_000, targetMonthly: 65_000_000, current: 310_000_000, reachedPct: 40 })
    expect(m.goals['3y']).toMatchObject({ target: 3_400_000_000, targetMonthly: 283_333_333, reachedPct: 9 })
    expect(m.goals['12m'].statusText).toBeTruthy()
    expect(m.otherGoals).toBe(1)
  })

  it('no goal → an empty row (the block offers to set one)', () => {
    const m = buildDashboardSummary({ ...previewState(), goals: [] })
    expect(m.goals['12m']).toMatchObject({ goalId: null, target: null, reachedPct: null })
  })

  it('no snapshot yet → no score, goals still shown', () => {
    const m = buildDashboardSummary({ ...honorState(), snapshot: null })
    expect(m).toMatchObject({ hasSnapshot: false, score: null, confidencePct: null, risks: [] })
    expect(m.attention.every((a) => a.kind === 'discrepancy')).toBe(true)
    expect(m.goals['3y'].target).toBe(3_400_000_000)
  })

  it('goal input: amounts with units, the POST body of the goals API', () => {
    expect(parseGoalAmount('780 млн')).toBe(780_000_000)
    expect(parseGoalAmount('3,4 млрд')).toBe(3_400_000_000)
    expect(parseGoalAmount('780 000 000')).toBe(780_000_000)
    expect(parseGoalAmount('')).toBeNull()
    expect(parseGoalAmount('0')).toBeNull()
    expect(revenueGoalDraft('3y', 3_400_000_000.4)).toEqual({ metricId: 'biz.finansy.vyruchka_god', targetValue: 3_400_000_000, periodLabel: '3y', direction: 'higher_is_better', label: 'Выручка через 3 года' })
  })
})

describe('PointADashboardSummaryView', () => {
  const html = (state: PointAPageState, onSaveGoal?: () => Promise<void>) =>
    renderToStaticMarkup(createElement(PointADashboardSummaryView, { model: buildDashboardSummary(state), onSaveGoal }))

  it('renders score, completeness, key metrics, attention, findings and the links to Point A / B', () => {
    const out = html(honorState(), async () => undefined)
    expect(out).toContain('Состояние бизнеса')
    expect(out).toContain('Полнота данных')
    expect(out).toContain('Достоверность')
    expect(out).toContain('Главные метрики')
    expect(out).toContain('Требует внимания')
    expect(out).toContain('Выручка (год) · 2024')
    expect(out).toContain('Риски, быстрые шаги, сильные стороны')
    expect(out).toContain(`href="${POINT_A_HREF}"`)
    expect(out).toContain(`href="${POINT_B_HREF}"`)
    // the stale v1 summary is gone
    expect(out).not.toContain('Оценка по пяти блокам')
    expect(out).not.toContain('Критические пробелы')
  })

  it('one goals block with both horizons, values and edit buttons for the owner', () => {
    const out = html(honorState(), async () => undefined)
    expect(out.match(/id="dashboard-goals"/g)).toHaveLength(1)
    expect(out).toContain('Выручка через 12 месяцев')
    expect(out).toContain('Выручка через 3 года')
    expect(out).toContain('780,0 млн ₸')
    expect(out).toContain('3,4 млрд ₸')
    expect(out).toContain('Изменить цель «Выручка через 12 месяцев»')
    expect(out).toContain('сейчас 40% цели')
  })

  it('a viewer (no manage access) sees the goals without edit buttons', () => {
    const out = renderToStaticMarkup(createElement(DashboardGoals, { model: { ...buildDashboardSummary(honorState()), canManage: false }, onSaveGoal: async () => undefined }))
    expect(out).not.toContain('Изменить')
    expect(out).toContain('780,0 млн ₸')
  })

  it('without goals the block offers to set them', () => {
    const out = html({ ...previewState(), goals: [] }, async () => undefined)
    expect(out).toContain('Цель не задана')
    expect(out).toContain('Задать цель')
  })
})

describe('«AI · Карта роста» uses the synced goals', () => {
  const render = async (items: PointAPageState['goals']) => {
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { default: GrowthSnapshotHero } = await import('@/components/dashboard/GrowthSnapshotHero')
    const qc = new QueryClient()
    qc.setQueryData(['goals'], items)
    return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(GrowthSnapshotHero as ComponentType<{ visibleSections?: string[]; hideSnapshot?: boolean }>, { visibleSections: ['point_b', 'gri', 'documents'], hideSnapshot: true })))
  }

  it('goals exist → shows them and opens Point B, does not ask to enter goals', async () => {
    const out = await render(honorState().goals)
    expect(out).toContain('AI · Карта роста')
    expect(out).toContain('Карта роста на 1–3 года по вашим целям')
    expect(out).toContain('780 млн ₸ / год')
    expect(out).toContain('65 млн ₸ / мес')
    expect(out).toContain('3.4 млрд ₸ / год')
    expect(out).toContain('href="/client/point-b"')
    expect(out).not.toContain('Укажите цели')
    expect(out).not.toContain('Выберите цель')
    // hideSnapshot: the «Точка А · Снимок» column (the second goals editor) is not rendered
    expect(out).not.toContain('Точка А · Снимок')
  })

  it('no goals → the goal inputs', async () => {
    const out = await render([])
    expect(out).toContain('Укажите цели — получите карту роста на 1-3 года')
    expect(out).toContain('Выберите цель')
  })
})
