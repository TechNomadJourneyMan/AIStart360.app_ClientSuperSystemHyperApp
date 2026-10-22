/**
 * Speed of the Point B page state (W4): the reads of loadPointBState go out in as few sequential round trips
 * («waves») as the data allows, the goals are read once, and the result is the same as before.
 *
 * The in-memory DB is wrapped in a «network»: a query answers only when the current wave is flushed (one
 * macrotask), so everything started before the flush is one round trip; a read that waits for another
 * read lands in the next wave. No real network, no timers that depend on speed.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pbDb, type Row } from './_pbdb'

vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))

const { loadPointBState, loadModelForCompany, goalsReader } = await import('@/lib/point-b/model/load')
const { loadPointBInputs } = await import('@/lib/point-b/inputs')

const REVENUE = 'biz.finansy.vyruchka_god'
const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const COMPANY = 'company-1'
const NOW = new Date('2026-10-18T09:00:00Z')

const block = (score: number) => ({ score, status: 'average', top_issues: [], recommendations: [] })
const metric = (key: string, value: number) => ({ company_id: COMPANY, metric_key: key, metric_value: value, source: 'survey', period_year: 2026, computed_at: '2026-10-01T00:00:00Z' })

function seed(extra: Record<string, Row[]> = {}) {
  return pbDb({
    companies: [{ id: COMPANY, user_id: CLIENT, name: 'Ромашка', industry: 'Интернет-магазин', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, createdAt: '2026-01-01T00:00:00Z' }],
    metric_targets: [{
      id: 'mt-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', target_value: 120_000_000, direction: 'higher_is_better',
      source: 'owner', deadline: null, label: null, note: null, baseline_value: 60_000_000, baseline_period: '2026', baseline_at: '2026-04-18T09:00:00Z', created_at: '2026-04-18T09:00:00Z',
    }],
    metrics: [metric(REVENUE, 60_000_000), metric('biz.marketing.lidov_v_mes', 300), metric('biz.marketing.konversiya_lid_klient', 12), metric('biz.prodazhi.sredniy_chek', 140_000)],
    diagnostics: [{
      id: 'diag-1', user_id: CLIENT, company_id: COMPANY, is_current: true, calculated_at: '2026-10-01T00:00:00Z', overall_score: 55, health_index: 50, stage: 'growth',
      finance_score: block(60), sales_score: block(50), operations_score: block(55), marketing_score: block(45), strategy_score: block(40),
    }],
    point_a_snapshots: [{ id: 'snap-1', company_id: COMPANY, engine: 'v4', confidence: 0.6, coverage: 0.7, created_at: '2026-10-10T00:00:00Z', blocks: [{ key: 'finance', score: 60 }], inputs: {} }],
    metric_facts: [
      { company_id: COMPANY, metric_key: REVENUE, period_key: '2026-08', value: 5_000_000, source_kind: 'manual', flags: [], confidence: 1 },
      { company_id: COMPANY, metric_key: REVENUE, period_key: '2026-09', value: 5_200_000, source_kind: 'manual', flags: [], confidence: 1 },
    ],
    ...extra,
  })
}

const node = (kind: string, key: string, parentKey: string | null, over: Record<string, unknown> = {}) => ({
  key, kind, parentKey, title: key, description: null, ownerLabel: null, dueDate: null,
  impact: kind === 'task' ? null : 4, effort: kind === 'task' ? null : 2, metricId: null, block: null, kpi: null, dependsOn: [], delayRisk: null, order: 0, ...over,
})
const APPROVED = {
  id: 'v-1', plan_id: 'plan-1', version: 1, status: 'approved', base_snapshot_id: null,
  goals: { primary: { metricKey: REVENUE, periodLabel: '12m' }, items: [] }, assumptions: {}, scenarios: [{ key: 'moderate', label: 'Умеренный' }], selected_scenario: 'moderate',
  strategy: { items: [node('strategy', 'strat-0000001', null), node('initiative', 'init-00000001', 'strat-0000001'), node('task', 'task-00000001', 'init-00000001', { dueDate: '2026-11-01' })], milestones: [] }, risks: [], expert_notes: null, change_reason: null,
  author_id: 'e', author_name: 'Алия Эксперт', author_kind: 'expert', submitted_at: null, approved_by: 'e', approved_at: '2026-10-12T00:00:00Z',
  approval_exception: null, rejected_by: null, rejected_at: null, rejected_reason: null, created_at: '2026-10-09T00:00:00Z',
}
const withPlan = () => ({
  pb_plans: [{ id: 'plan-1', company_id: COMPANY, user_id: CLIENT, current_version_id: 'v-1', published_version_id: 'v-1', settings: {}, created_at: '2026-10-01T00:00:00Z' }],
  pb_plan_versions: [APPROVED],
})

/** The DB behind a «network»: every query answers when the wave is flushed; counts waves and reads per table. */
function network(sb: SupabaseClient, opts: { fail?: Record<string, { code: string; message: string }> } = {}) {
  let waves = 0
  let pending: Array<() => void> = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const reads: Record<string, number> = {}
  const flush = () => {
    timer = null
    waves++
    const batch = pending
    pending = []
    for (const run of batch) run()
  }
  const later = <T,>(run: () => PromiseLike<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      pending.push(() => { run().then(resolve, reject) })
      timer ??= setTimeout(flush, 0)
    })
  const client = {
    from(table: string) {
      reads[table] = (reads[table] ?? 0) + 1
      const failure = opts.fail?.[table]
      const target = (sb as unknown as { from: (t: string) => Record<string, unknown> }).from(table)
      const answer = <T,>(real: () => PromiseLike<T>) => later(failure ? () => Promise.resolve({ data: null, error: failure } as T) : real)
      const proxy: Record<string, unknown> = new Proxy(target, {
        get(t, prop: string) {
          if (prop === 'then') return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => answer(() => ({ then: (a: (v: unknown) => unknown, b?: (e: unknown) => unknown) => (t.then as (a: unknown, b: unknown) => Promise<unknown>)(a, b) })).then(res, rej)
          if (prop === 'maybeSingle' || prop === 'single') return () => answer(() => (t[prop] as () => Promise<unknown>)())
          const v = t[prop]
          return typeof v === 'function' ? (...args: unknown[]) => { const r = (v as (...a: unknown[]) => unknown)(...args); return r === t ? proxy : r } : v
        },
      })
      return proxy
    },
  }
  return { sb: client as unknown as SupabaseClient, reads, waves: () => waves }
}

describe('Point B state: reads in parallel (W4)', () => {
  it('the same state as on the plain DB, in three round trips without a plan, the goals read once', async () => {
    const plain = await loadPointBState(seed().sb, CLIENT, { now: NOW })
    const net = network(seed().sb)
    const state = await loadPointBState(net.sb, CLIENT, { now: NOW })
    expect(state).toEqual(plain)
    expect(state.overview.result.level).toBeGreaterThan(0)
    // the company → everything company-keyed at once (+ the metrics the inputs resolve after their first read)
    expect(net.waves()).toBeLessThanOrEqual(3)
    expect(net.reads.metric_targets).toBe(1)
    expect(net.reads.diagnostics).toBe(1)
    expect(net.reads.pb_plans).toBe(1)
  })

  it('with an approved plan the strategy follows the plan read only; the result is the same as on the plain DB', async () => {
    const plain = await loadPointBState(seed(withPlan()).sb, CLIENT, { now: NOW })
    const net = network(seed(withPlan()).sb)
    const state = await loadPointBState(net.sb, CLIENT, { now: NOW })
    expect(state).toEqual(plain)
    expect(state.plan.status).toBe('published')
    expect(state.plan.strategy?.items.map((i) => i.key)).toContain('task-00000001')
    // company → plan → versions → task statuses of the strategy
    expect(net.waves()).toBeLessThanOrEqual(4)
    expect(net.reads.metric_targets).toBe(1)
  })

  it('a failed plan read still fails the page; a failed goals read is «no goal», not a failure', async () => {
    const broken = network(seed().sb, { fail: { pb_plans: { code: 'XX000', message: 'boom' } } })
    await expect(loadPointBState(broken.sb, CLIENT, { now: NOW })).rejects.toThrow()

    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const noGoals = network(seed().sb, { fail: { pb_goal_reviews: { code: 'XX000', message: 'boom' } } })
      const state = await loadPointBState(noGoals.sb, CLIENT, { now: NOW })
      expect(state.access).toBe('ok')
      expect(err.mock.calls.some((c) => /goals not read/.test(String(c[0])))).toBe(true)
    } finally {
      err.mockRestore()
    }
  })

  it('a user without a company: level 0, nothing company-keyed is read', async () => {
    const net = network(seed({ companies: [], diagnostics: [] }).sb)
    const state = await loadPointBState(net.sb, CLIENT, { now: NOW })
    expect(state.overview.result.level).toBe(0)
    expect(state.plan.status).toBe('none')
    expect(net.reads.pb_plans ?? 0).toBe(0)
    expect(net.reads.pb_recommendations ?? 0).toBe(0)
  })
})

describe('Point B inputs: the diagnostic does not hold up the other reads (W4)', () => {
  it('with the company named, the diagnostic is read in the same wave as the rest', async () => {
    const net = network(seed().sb)
    const viaNet = await loadPointBInputs(net.sb, CLIENT, { companyId: COMPANY, now: NOW })
    expect(viaNet).toEqual(await loadPointBInputs(seed().sb, CLIENT, { companyId: COMPANY, now: NOW }))
    expect(viaNet.diagnostic?.id).toBe('diag-1')
    expect(net.waves()).toBeLessThanOrEqual(2) // one wave (+ the metric read that follows its own lookup)
  })

  it('without a company the diagnostic still names it first (as before)', async () => {
    const net = network(seed().sb)
    const inputs = await loadPointBInputs(net.sb, CLIENT, { now: NOW })
    expect(inputs.companyId).toBe(COMPANY)
    expect(net.reads.companies ?? 0).toBe(1) // loadGoals' company targets only: the diagnostic named the company
  })

  it('a goals reader shared by the caller is used instead of a second read', async () => {
    const net = network(seed().sb)
    const readGoals = goalsReader(net.sb, COMPANY)
    await loadModelForCompany(net.sb, { userId: CLIENT, companyId: COMPANY, goals: null, now: NOW, readGoals })
    await readGoals()
    expect(net.reads.metric_targets).toBe(1)
  })
})
