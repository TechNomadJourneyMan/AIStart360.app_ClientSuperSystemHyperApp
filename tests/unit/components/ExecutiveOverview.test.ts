// ExecutiveOverview (Point A level 1) — state machine, API mapping and the
// rendered output of each state (loading / error / no company / not started /
// ready / stale). The view is stateless, so it is rendered with
// react-dom/server (node env, no DOM needed).

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/point-a',
}))

import {
  ExecutiveOverviewView,
  type ExecutiveOverviewViewProps,
} from '@/components/point-a/ExecutiveOverview'
import {
  gapAction,
  overviewViewState,
  sourceRows,
  statusMeta,
  formatRelativeRuLong,
} from '@/components/point-a/executive-overview-model'
import { interpretOverviewResponse, recalcErrorMessage, PointAOverviewError } from '@/hooks/usePointAOverview'
import { PROVENANCE_META, confidenceText } from '@/components/common/ProvenanceBadge'
import type { PointAOverview } from '@/types/point-a-overview'

const NOW = new Date('2026-10-06T12:00:00Z')

function overview(patch: Partial<PointAOverview> = {}): PointAOverview {
  return {
    companyId: 'c-1',
    companyName: 'ТОО Ромашка',
    overallScore: 62,
    healthIndex: 55,
    maturity: { level: 'growth', label: 'Рост' },
    griIndex: 7.4,
    status: 'ready',
    completeness: 0.58,
    completenessLevel: 'medium',
    dataGaps: ['Загрузите отчёт P&L за 2025 год', 'Пройдите GRI-оценку', 'Ответьте на шаг 9 анкеты'],
    problemZones: [
      { area: 'finance', label: 'Финансы', score: 34, status: 'critical', topIssue: 'Нет данных о марже' },
      { area: 'marketing', label: 'Маркетинг', score: 51, status: 'weak', topIssue: null },
    ],
    keyRisks: [
      {
        id: 'r1',
        kind: 'risk',
        area: 'finance',
        title: 'Кассовый разрыв в низкий сезон',
        body: 'Резерв меньше месяца расходов',
        severity: 'critical',
        provenanceType: 'INFERRED',
        confidence: 0.8,
        source: 'engine:point_a_v1',
      },
    ],
    strengths: [
      {
        id: 's1',
        kind: 'strength',
        area: 'sales',
        title: 'Высокая доля повторных продаж',
        body: null,
        severity: 'info',
        provenanceType: 'CALCULATED',
        confidence: 0.9,
        source: 'engine:point_a_v1',
      },
    ],
    criticalGaps: [],
    sources: {
      surveyStepsCompleted: 9,
      surveyStepsTotal: 12,
      documentsTotal: 3,
      documentsProcessed: 2,
      documentsFailed: 1,
      documentsPending: 0,
      griAssessments: 1,
      integrationsConnected: 0,
      metricsWithValue: 23,
      metricsTotal: 130,
      processedSources: 3,
    },
    calculatedAt: '2026-10-03T09:30:00Z',
    lastInputAt: '2026-10-02T10:00:00Z',
    generatedAt: '2026-10-06T11:59:00Z',
    ...patch,
  }
}

const recalc = { run: vi.fn(), pending: false, error: null }

function html(props: Partial<ExecutiveOverviewViewProps> & { state: ExecutiveOverviewViewProps['state'] }): string {
  return renderToStaticMarkup(createElement(ExecutiveOverviewView, { recalc, now: NOW, ...props }))
}

// ─── API mapping ────────────────────────────────────────────────────────────

describe('interpretOverviewResponse', () => {
  it('maps 200 {ok,data} to ready', () => {
    const data = overview()
    expect(interpretOverviewResponse(200, { ok: true, data })).toEqual({ kind: 'ready', data })
  })

  it('maps 404 no_company to an empty state, not an error', () => {
    expect(interpretOverviewResponse(404, { ok: false, error: 'no_company' })).toEqual({ kind: 'no_company' })
  })

  it('maps 401 to unauthorized', () => {
    expect(interpretOverviewResponse(401, null)).toEqual({ kind: 'unauthorized' })
  })

  it('throws a Russian error for 5xx', () => {
    expect(() => interpretOverviewResponse(500, { ok: false, error: 'boom' })).toThrow(PointAOverviewError)
    expect(() => interpretOverviewResponse(500, null)).toThrow(/временно недоступен/)
  })

  it('explains recalculation failures', () => {
    expect(recalcErrorMessage(422)).toMatch(/анкеты/)
    expect(recalcErrorMessage(429)).toMatch(/минуту/)
  })
})

// ─── View state machine ─────────────────────────────────────────────────────

describe('overviewViewState', () => {
  it('loading until the first answer', () => {
    expect(overviewViewState({ isLoading: true, isError: false, result: undefined })).toBe('loading')
  })
  it('error without data', () => {
    expect(overviewViewState({ isLoading: false, isError: true, result: undefined })).toBe('error')
  })
  it('no company / unauthorized', () => {
    expect(overviewViewState({ isLoading: false, isError: false, result: { kind: 'no_company' } })).toBe('no_company')
    expect(overviewViewState({ isLoading: false, isError: false, result: { kind: 'unauthorized' } })).toBe('unauthorized')
  })
  it('not_started without a score collapses to the onboarding empty state', () => {
    const data = overview({ status: 'not_started', overallScore: null })
    expect(overviewViewState({ isLoading: false, isError: false, result: { kind: 'ready', data } })).toBe('not_started')
  })
  it('stale / collecting / processing still render the full overview', () => {
    for (const status of ['stale', 'collecting', 'processing', 'ready'] as const) {
      const data = overview({ status })
      expect(overviewViewState({ isLoading: false, isError: false, result: { kind: 'ready', data } })).toBe('ready')
    }
  })
})

// ─── Rendered states ────────────────────────────────────────────────────────

describe('ExecutiveOverviewView — rendering', () => {
  it('loading → skeleton with aria-busy', () => {
    const out = html({ state: 'loading' })
    expect(out).toContain('data-state="loading"')
    expect(out).toContain('aria-busy="true"')
    expect(out).toContain('Загружаем обзор Точки А')
  })

  it('error → alert with retry button', () => {
    const out = html({ state: 'error', errorMessage: 'Сервис Точки А временно недоступен', onRetry: () => {} })
    expect(out).toContain('role="alert"')
    expect(out).toContain('Сервис Точки А временно недоступен')
    expect(out).toContain('Повторить')
  })

  it('no_company → empty state with the survey CTA (not an error)', () => {
    const out = html({ state: 'no_company' })
    expect(out).toContain('data-state="no_company"')
    expect(out).not.toContain('role="alert"')
    expect(out).toContain('Профиль компании ещё не создан')
    expect(out).toContain('href="/client/onboarding"')
  })

  it('unauthorized → sign-in prompt', () => {
    const out = html({ state: 'unauthorized', signInHref: '/login?from=%2Fpoint-a' })
    expect(out).toContain('Войдите, чтобы увидеть Точку А')
    expect(out).toContain('href="/login?from=%2Fpoint-a"')
  })

  it('not_started → checklist from real source counts + «Пройти анкету»', () => {
    const data = overview({
      status: 'not_started',
      overallScore: null,
      sources: { ...overview().sources, surveyStepsCompleted: 0, documentsTotal: 0, griAssessments: 0 },
    })
    const out = html({ state: 'not_started', overview: data })
    expect(out).toContain('data-state="not_started"')
    expect(out).toContain('Диагностика ещё не начата')
    expect(out).toContain('0 из 12 шагов')
    expect(out).toContain('Пройти анкету')
    // No score gauge in the empty state.
    expect(out).not.toContain('Общий балл')
  })

  it('ready → score, maturity, GRI, completeness, gaps, zones, risks, strengths, freshness, sources', () => {
    const out = html({ state: 'ready', overview: overview() })
    expect(out).toContain('data-state="ready"')
    expect(out).toContain('Общий балл 62 из 100')
    expect(out).toContain('Стадия: Рост')
    expect(out).toContain('GRI 7.4 / 10')
    expect(out).toContain('58%')
    expect(out).toContain('Средняя')
    // data gaps are actionable links
    expect(out).toContain('Загрузите отчёт P&amp;L за 2025 год')
    expect(out).toContain('href="/client/onboarding/documents"')
    expect(out).toContain('href="/gri"')
    // problem zones coloured by status
    expect(out).toContain('data-zone-status="critical"')
    expect(out).toContain('34/100')
    // risks with severity + provenance badge (confidence in aria-label)
    expect(out).toContain('Кассовый разрыв в низкий сезон')
    expect(out).toContain('Критично')
    expect(out).toContain('data-provenance="INFERRED"')
    expect(out).toContain('Уверенность: 80%')
    // strengths without severity chip
    expect(out).toContain('Высокая доля повторных продаж')
    // freshness: relative + exact
    expect(out).toContain('Обновлено:')
    expect(out).toContain('3 дня назад')
    expect(out).toContain('dateTime="2026-10-03T09:30:00Z"')
    // sources breakdown trigger
    expect(out).toContain('Источников обработано:')
    expect(out).toContain('aria-expanded="false"')
    // ready status badge, no recalculation CTA
    expect(out).toMatch(/data-status="ready"[^>]*><span class="sr-only">Статус диагностики: <\/span>[\s\S]*?Актуальна/)
    expect(out).not.toContain('Пересчитать')
  })

  it('stale → «Устарела» badge, hint and the «Пересчитать» button', () => {
    const out = html({ state: 'ready', overview: overview({ status: 'stale' }) })
    expect(out).toContain('data-status="stale"')
    expect(out).toMatch(/Статус диагностики: <\/span>[\s\S]*?Устарела/)
    expect(out).toContain('Пересчитать')
    expect(out).toContain('После последнего расчёта появились новые данные')
  })

  it('stale + pending recalculation shows progress; recalc error is announced', () => {
    const out = html({
      state: 'ready',
      overview: overview({ status: 'stale' }),
      recalc: { run: () => {}, pending: true, error: 'Слишком много пересчётов подряд — попробуйте через минуту' },
    })
    expect(out).toContain('Считаем…')
    expect(out).toContain('Слишком много пересчётов подряд')
  })

  it('a calculated-less overview says so instead of showing a date', () => {
    const out = html({ state: 'ready', overview: overview({ status: 'collecting', overallScore: null, calculatedAt: null }) })
    expect(out).toContain('Ещё не рассчитывалась')
    expect(out).toContain('Общий балл ещё не рассчитан')
    expect(out).toContain('Рассчитать Точку А')
    expect(out).toContain('Продолжить анкету')
  })

  it('caps lists: ≤5 risks, ≤3 strengths, ≤5 gaps', () => {
    const risk = overview().keyRisks[0]
    const many = Array.from({ length: 8 }, (_, i) => ({ ...risk, id: `r${i}`, title: `Риск №${i}` }))
    const gaps = Array.from({ length: 8 }, (_, i) => `Пробел №${i}`)
    const out = html({ state: 'ready', overview: overview({ keyRisks: many, dataGaps: gaps }) })
    expect(out).toContain('Риск №4')
    expect(out).not.toContain('Риск №5')
    expect(out).toContain('Пробел №4')
    expect(out).not.toContain('Пробел №5')
  })
})

// ─── Helpers ────────────────────────────────────────────────────────────────

describe('executive overview helpers', () => {
  it('maps every diagnostic status to a Russian label + CTA', () => {
    expect(statusMeta('not_started').cta.label).toBe('Пройти анкету')
    expect(statusMeta('stale').cta.kind).toBe('recalculate')
    expect(statusMeta('processing').cta.kind).toBe('none')
    expect(statusMeta('ready').label).toBe('Актуальна')
  })

  it('routes data gaps to the screen that closes them', () => {
    expect(gapAction('Загрузите выгрузку из CRM').href).toBe('/pulse')
    expect(gapAction('Загрузите отчёт P&L').href).toBe('/client/onboarding/documents')
    expect(gapAction('Пройдите GRI').href).toBe('/gri')
    expect(gapAction('Ответьте на шаг 9 анкеты').href).toBe('/client/onboarding')
  })

  it('builds the sources breakdown from counts', () => {
    const rows = sourceRows(overview().sources)
    expect(rows.map((r) => r.key)).toEqual(['survey', 'documents', 'gri', 'integrations', 'metrics'])
    expect(rows[1].value).toBe('2 из 3 обработано')
    expect(rows[1].detail).toBe('с ошибкой 1')
    expect(rows[3].active).toBe(false)
  })

  it('formats relative dates in Russian', () => {
    expect(formatRelativeRuLong('2026-10-06T11:55:00Z', NOW)).toBe('5 минут назад')
    expect(formatRelativeRuLong('2026-10-05T11:00:00Z', NOW)).toBe('вчера')
    expect(formatRelativeRuLong('2026-09-01T11:00:00Z', NOW)).toBe('1 месяц назад')
  })

  it('provenance badge labels', () => {
    expect(PROVENANCE_META.FACT.label).toBe('Факт')
    expect(PROVENANCE_META.CALCULATED.label).toBe('Расчёт')
    expect(PROVENANCE_META.INFERRED.label).toBe('Вывод')
    expect(PROVENANCE_META.AI_HYPOTHESIS.label).toBe('Гипотеза ИИ')
    expect(PROVENANCE_META.RECOMMENDATION.label).toBe('Рекомендация')
    expect(confidenceText(0.824)).toBe('Уверенность: 82%')
    expect(confidenceText(null)).toBeNull()
  })
})
