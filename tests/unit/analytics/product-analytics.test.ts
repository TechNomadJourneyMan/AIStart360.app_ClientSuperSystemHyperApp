/**
 * Package 5 «Product analytics»: survey completion predicate (F-065), single
 * event stream (F-064), daily rollup wrapper + cohorts rendering (F-066),
 * activation settings (F-067), CSV export.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

import { isSurveyCompleted, surveyCompletedAt } from '@/lib/survey/completion'
import { userSegments, type UserFacts } from '@/lib/platform/visibility'
import { EVENTS, EVENT_TYPES, isClientEvent, isEventName, type EventName } from '@/lib/events/registry'
import { toEventRow } from '@/lib/events/track'
import { nbaEventMetadata, NBA_EVENT_NAMES } from '@/lib/nba/events'
import { newlyCompletedSections } from '@/lib/gri-assessment/section-events'
import { almatyDay, planRollupDays, runDailyRollup, shiftDay } from '@/lib/analytics/rollup'
import {
  activityCsv, cohortCellOpacity, cohortsCsv, funnelCsv, normalizeCohorts, normalizeSeries,
} from '@/lib/analytics/reports'
import { RetentionCohortTable } from '@/components/giga-panel/analytics/RetentionCohortTable'
import { SETTINGS, coerceSetting, validateSetting } from '@/lib/settings/registry'

// ─── F-065: «анкета заполнена» ───────────────────────────────────────────────

describe('survey completion predicate', () => {
  it('11/12 steps + final submit (event) = completed — step 12 may be passed empty', () => {
    expect(isSurveyCompleted({ filledSteps: 11, completedEventAt: '2026-09-01T10:00:00Z' })).toBe(true)
  })

  it('11/12 steps + completion-notice marker = completed', () => {
    expect(isSurveyCompleted({ filledSteps: 11, noticeMarkerAt: '2026-09-01T10:00:00Z' })).toBe(true)
  })

  it('all 12 steps without any marker = completed (legacy rule kept)', () => {
    expect(isSurveyCompleted({ filledSteps: 12 })).toBe(true)
  })

  it('11/12 steps and nothing submitted = not completed', () => {
    expect(isSurveyCompleted({ filledSteps: 11 })).toBe(false)
    expect(isSurveyCompleted({})).toBe(false)
    expect(surveyCompletedAt({ filledSteps: 11, lastAnswerAt: '2026-09-01T00:00:00Z' })).toBeNull()
  })

  it('completion time is the earliest known fact', () => {
    expect(surveyCompletedAt({
      noticeMarkerAt: '2026-09-03T00:00:00Z',
      completedEventAt: '2026-09-02T00:00:00Z',
      filledSteps: 12,
      lastAnswerAt: '2026-09-05T00:00:00Z',
    })).toBe('2026-09-02T00:00:00Z')
  })

  const facts = (over: Partial<UserFacts>): UserFacts => ({
    role: 'client', status: 'approved', tier: 'free', vertical: 'generic', created_at: null,
    survey_steps: 0, gri_runs: 0, is_staff: false, ...over,
  })

  it('userSegments uses survey_completed, keeping survey_steps as a fallback', () => {
    expect(userSegments(facts({ survey_steps: 11, survey_completed: true })).has('survey_completed')).toBe(true)
    expect(userSegments(facts({ survey_steps: 11, survey_completed: false })).has('survey_not_completed')).toBe(true)
    // Older RPC without the flag: the step rule still applies.
    expect(userSegments(facts({ survey_steps: 12 })).has('survey_completed')).toBe(true)
    expect(userSegments(facts({ survey_steps: 3 })).has('survey_not_completed')).toBe(true)
  })
})

// ─── F-064: единый поток событий ─────────────────────────────────────────────

describe('event registry additions', () => {
  const ADDED: EventName[] = [
    'AI_CHAT_ASKED', 'AI_CHAT_ANSWERED', 'NBA_SHOWN', 'NBA_DONE', 'NBA_DISMISSED', 'PULSE_SUBMITTED',
    'SIMULATION_RUN', 'GRI_SECTION_COMPLETED', 'GRI_RESULT_VIEWED', 'POINT_B_VIEWED', 'DOCUMENT_PARSED',
    'TIER_CHANGED', 'LOGOUT',
  ]

  it('every new event is registered with a DB-allowed type and a valid name', () => {
    for (const name of ADDED) {
      expect(isEventName(name), name).toBe(true)
      expect(EVENT_TYPES).toContain(EVENTS[name].type)
      expect(name).toMatch(/^[A-Z][A-Z0-9_]{2,63}$/) // user_events.event_name CHECK
      expect(EVENTS[name].label.length).toBeGreaterThan(0)
    }
  })

  it('server-only facts cannot be forged by the browser', () => {
    for (const name of ['AI_CHAT_ASKED', 'NBA_DONE', 'PULSE_SUBMITTED', 'SIMULATION_RUN', 'GRI_SECTION_COMPLETED', 'POINT_B_VIEWED', 'DOCUMENT_PARSED', 'TIER_CHANGED'] as const) {
      expect(isClientEvent(name), name).toBe(false)
    }
    // Browser-side by nature.
    expect(isClientEvent('GRI_RESULT_VIEWED')).toBe(true)
    expect(isClientEvent('LOGOUT')).toBe(true)
  })

  it('TIER_CHANGED row: subject is the user, staff actor → source admin, tiny metadata', () => {
    const row = toEventRow({ userId: 'u1', name: 'TIER_CHANGED', metadata: { from: 'free', to: 'pro', by: 'staff' }, source: 'admin' })
    expect(row).toMatchObject({ user_id: 'u1', event_type: 'system', source: 'admin', metadata: { from: 'free', to: 'pro', by: 'staff' } })
  })

  it('NBA events keep only the action family (no ids) in metadata', () => {
    expect(NBA_EVENT_NAMES.done).toBe('NBA_DONE')
    expect(NBA_EVENT_NAMES.why_opened).toBeUndefined()
    expect(nbaEventMetadata('plan_task:11111111-2222-3333-4444-555555555555', { score: 3 })).toEqual({ action: 'plan_task', score: 3 })
  })

  it('GRI_SECTION_COMPLETED fires only for sections that became completed now', () => {
    const before = { 'product-demand': true }
    expect(newlyCompletedSections(before, { 'product-demand': true, 'unknown-x': true })).toEqual([])
    expect(newlyCompletedSections(null, { 'product-demand': true })).toEqual(['product-demand'])
  })
})

// ─── F-066: ежедневная свёртка ───────────────────────────────────────────────

describe('daily rollup wrapper', () => {
  const NOW = new Date('2026-09-24T01:30:00Z') // 06:30 in Almaty → today = 2026-09-24

  it('uses the Almaty calendar day', () => {
    expect(almatyDay(new Date('2026-09-23T20:00:00Z'))).toBe('2026-09-24') // 01:00 Almaty
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('plans yesterday + day before first, then missing days newest first, bounded', () => {
    const plan = planRollupDays(NOW, ['2026-09-01', '2026-09-20', '2026-09-23', '2026-09-24', '2025-01-01', 'bad'], 4)
    expect(plan).toEqual(['2026-09-23', '2026-09-22', '2026-09-20', '2026-09-01'])
    // never today, never beyond the 90-day backfill window, never duplicates
    expect(plan).not.toContain('2026-09-24')
    expect(plan).not.toContain('2025-01-01')
  })

  it('calls rollup_daily_activity per planned day and collects failures', async () => {
    const calls: Array<[string, unknown]> = []
    const sb = {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        calls.push([fn, args])
        if (fn === 'analytics_missing_days') return { data: [{ day: '2026-09-10' }], error: null }
        if (args.p_day === '2026-09-22') return { data: null, error: { message: 'boom' } }
        return { data: 5, error: null }
      }),
    }
    const r = await runDailyRollup(sb as never, { now: NOW })
    expect(calls[0]).toEqual(['analytics_missing_days', { p_days: 90 }])
    expect(calls.slice(1).map(([, a]) => (a as { p_day: string }).p_day)).toEqual(['2026-09-23', '2026-09-22', '2026-09-10'])
    expect(r.rolled).toEqual([{ day: '2026-09-23', users: 5 }, { day: '2026-09-10', users: 5 }])
    expect(r.failed).toEqual([{ day: '2026-09-22', error: 'boom' }])
    expect(r.ok).toBe(false)
  })

  it('still rolls up yesterday when the missing-days lookup fails', async () => {
    const sb = { rpc: vi.fn(async (fn: string) => (fn === 'analytics_missing_days' ? { data: null, error: { message: 'no fn' } } : { data: 1, error: null })) }
    const r = await runDailyRollup(sb as never, { now: NOW })
    expect(r.rolled.map((x) => x.day)).toEqual(['2026-09-23', '2026-09-22'])
  })

  it('stops on the time budget', async () => {
    const sb = { rpc: vi.fn(async () => ({ data: [], error: null })) }
    const r = await runDailyRollup(sb as never, { now: NOW, budgetMs: -1 })
    expect(r.stoppedEarly).toBe(true)
    expect(r.rolled).toEqual([])
  })
})

// ─── F-066: когорты ──────────────────────────────────────────────────────────

describe('retention cohorts', () => {
  const cohorts = normalizeCohorts([
    { cohort_start: '2026-09-14', cohort_size: 10, d1: '40.0', d7: 20, d30: null, weeks: [30, null] },
    { cohort_start: '2026-09-07', cohort_size: 4, d1: 0, d7: 0, d30: null, weeks: [] },
  ])

  it('normalizes RPC rows (numeric strings, short week arrays)', () => {
    expect(cohorts[0].d1).toBe(40)
    expect(cohorts[0].weeks).toHaveLength(8)
    expect(cohorts[0].weeks.slice(0, 2)).toEqual([30, null])
  })

  it('heat intensity grows with retention; 0% stays visible, no data is empty', () => {
    expect(cohortCellOpacity(null)).toBe(0)
    expect(cohortCellOpacity(0)).toBeGreaterThan(0)
    expect(cohortCellOpacity(80)).toBeGreaterThan(cohortCellOpacity(20))
    expect(cohortCellOpacity(250)).toBe(cohortCellOpacity(100))
  })

  it('renders a heatmap row per cohort with colored cells and «—» for unreached weeks', () => {
    const html = renderToStaticMarkup(RetentionCohortTable({ cohorts }))
    expect(html).toContain('Неделя регистрации')
    expect((html.match(/<tr/g) ?? []).length).toBe(3) // header + 2 cohorts
    expect((html.match(/data-testid="cohort-cell"/g) ?? []).length).toBe(2 * 11) // D1, D7, D30 + W1..W8
    expect(html).toContain('40%')
    expect(html).toContain('opacity:')
    expect(html).toContain('—')
  })

  it('renders an explanation when there are no cohorts', () => {
    expect(renderToStaticMarkup(RetentionCohortTable({ cohorts: [] }))).toContain('Когорт пока нет')
  })

  it('CSV tables keep headers and row widths aligned', () => {
    const c = cohortsCsv(cohorts)
    expect(c.rows.every((r) => r.length === c.headers.length)).toBe(true)
    const a = activityCsv(normalizeSeries([{ day: '2026-09-20', dau: 2, wau: 5, mau: 9, stickiness: '22.2', new_users: 1, rolled: true }]))
    expect(a.rows[0]).toEqual(['2026-09-20', 2, 5, 9, 22.2, 1, 'да'])
    const f = funnelCsv([{ key: 'registered', count: 10 }, { key: 'survey_completed', count: 4 }])
    expect(f.rows[1]).toEqual(['Анкета заполнена', 'survey_completed', 4, 40, 60])
  })
})

// ─── F-067: настройки активации ──────────────────────────────────────────────

describe('activation settings', () => {
  it('defaults to GRI_COMPLETED within 7 days', () => {
    expect(SETTINGS.activation_event.default).toBe('GRI_COMPLETED')
    expect(SETTINGS.activation_window_days.default).toBe(7)
    expect(coerceSetting('activation_event', undefined)).toBe('GRI_COMPLETED')
  })

  it('accepts only the three supported events', () => {
    for (const ev of ['GRI_COMPLETED', 'QUESTIONNAIRE_COMPLETED', 'POINT_A_CALCULATED']) expect(validateSetting('activation_event', ev).ok).toBe(true)
    expect(validateSetting('activation_event', 'PAGE_VIEWED').ok).toBe(false)
    expect(coerceSetting('activation_event', 'LOGIN')).toBe('GRI_COMPLETED')
  })

  it('bounds the activation window to 1..90 whole days', () => {
    expect(validateSetting('activation_window_days', 14).ok).toBe(true)
    expect(validateSetting('activation_window_days', 0).ok).toBe(false)
    expect(validateSetting('activation_window_days', 91).ok).toBe(false)
    expect(validateSetting('activation_window_days', 2.5).ok).toBe(false)
  })
})

// ─── Экспорт ─────────────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({ role: 'analyst' as string, audits: [] as Array<Record<string, unknown>>, rpc: [] as string[] }))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: 'staff-1', kind: 'session', role: state.role as StaffRole })) }
})
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async (_a: unknown, e: Record<string, unknown>) => { state.audits.push(e); return true } }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    rpc: async (fn: string) => {
      state.rpc.push(fn)
      if (fn === 'admin_retention_cohorts') return { data: [{ cohort_start: '2026-09-14', cohort_size: 3, d1: 33.3, d7: null, d30: null, weeks: [] }], error: null }
      if (fn === 'admin_overview') return { data: { funnel: [{ key: 'registered', count: 3 }] }, error: null }
      return { data: [], error: null }
    },
  }),
}))

describe('GET /api/giga-admin/analytics/export', () => {
  beforeEach(() => { state.audits = []; state.rpc = []; state.role = 'analyst' })
  const get = async (qs: string) => {
    const { GET } = await import('@/app/api/giga-admin/analytics/export/route')
    return GET(new NextRequest(`http://localhost/api/giga-admin/analytics/export?${qs}`))
  }

  it('returns CSV and writes analytics.exported to the audit log', async () => {
    const res = await get('report=cohorts')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    const body = await res.text()
    expect(body).toContain('Неделя регистрации')
    expect(body).toContain('2026-09-14')
    expect(state.audits).toEqual([expect.objectContaining({ action: 'analytics.exported', entityId: 'cohorts' })])
  })

  it('funnel report reads the overview funnel', async () => {
    const res = await get('report=funnel&days=30')
    expect(res.status).toBe(200)
    expect(state.rpc).toContain('admin_overview')
  })

  it('rejects an unknown report without touching the DB or the journal', async () => {
    const res = await get('report=users')
    expect(res.status).toBe(400)
    expect(state.rpc).toEqual([])
    expect(state.audits).toEqual([])
  })

  it('requires analytics.view', async () => {
    state.role = 'support'
    const res = await get('report=activity')
    expect(res.status).toBe(403)
    expect(state.rpc).toEqual([])
  })
})
