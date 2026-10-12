import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildPointASnapshot, snapshotInputs, type SnapshotDeps } from '@/lib/point-a/snapshot'
import { changeReasons, inputsHash } from '@/lib/point-a/snapshot-diff'
import { resolveAllMetrics } from '@/lib/metrics/resolver'
import { memoryClient, type Row } from '../data-layer/memory-client'
import { CURRENT_TYPICAL } from '../point-a/fixtures/answer-sets'

const NOW = new Date('2026-10-12T00:00:00Z')

function setup(answers: Record<string, unknown> = CURRENT_TYPICAL, tables: Record<string, Row[]> = {}) {
  const m = memoryClient({
    companies: [{ id: 'co', user_id: 'owner', industry: 'Услуги' }],
    point_a_snapshots: [],
    diagnostics: [],
    ...tables,
  })
  const state = { answers, useV4: false }
  const after = vi.fn()
  const store = vi.fn(async (_db: unknown, o: { result: { overall_score: number } }) => ({ ok: true as const, diag: { id: `diag-${store.mock.calls.length}`, overall_score: o.result.overall_score } }))
  const deps: SnapshotDeps = {
    service: () => m.client,
    materialize: async () => ({
      values: resolveAllMetrics({ companyId: 'co', userId: 'owner', surveyAnswers: state.answers, documents: [], now: NOW }),
      surveyAnswers: state.answers,
    }),
    useV4: async () => state.useV4,
    store: store as unknown as SnapshotDeps['store'],
    afterWrite: after,
  }
  return { m, state, deps, after, store }
}

describe('buildPointASnapshot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('first run: stores v1 (shadow v4), a snapshot with both and «первый расчёт»', async () => {
    const { m, deps, after, store } = setup()
    const r = await buildPointASnapshot('co', { trigger: 'event', reasons: ['SURVEY_ANSWER_CHANGED'] }, deps)
    expect(r.status).toBe('written')
    if (r.status !== 'written') return
    expect(r.engine).toBe('v1')
    expect(store).toHaveBeenCalledTimes(1)
    const snap = m.db.point_a_snapshots[0]
    expect(snap).toMatchObject({ company_id: 'co', engine: 'v1', trigger: 'event', reasons: ['SURVEY_ANSWER_CHANGED'] })
    expect(snap.v1_overall).toBe(r.written.overall_score)
    expect(snap.overall).toBe(r.v4.overall)
    expect((snap.change_reasons as Array<{ type: string }>)[0].type).toBe('first')
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'co', ownerId: 'owner', engine: 'v1' }))
  })

  it('nothing changed → no new diagnostic, no snapshot; force writes anyway', async () => {
    const { m, deps, store } = setup()
    await buildPointASnapshot('co', { trigger: 'event' }, deps)
    const again = await buildPointASnapshot('co', { trigger: 'event' }, deps)
    expect(again.status).toBe('unchanged')
    expect(store).toHaveBeenCalledTimes(1)
    expect(m.db.point_a_snapshots).toHaveLength(1)
    expect((await buildPointASnapshot('co', { trigger: 'manual', force: true }, deps)).status).toBe('written')
  })

  it('a changed answer: new snapshot with what changed', async () => {
    const { m, state, deps } = setup()
    await buildPointASnapshot('co', { trigger: 'event' }, deps)
    state.answers = { ...CURRENT_TYPICAL, s4m_hours_on_ops: 2, s4n_structure_matches: true, s4m_delegation_readiness: 9, s4m_planning_team_or_solo: 'team' }
    const r = await buildPointASnapshot('co', { trigger: 'event' }, deps)
    expect(r.status).toBe('written')
    const texts = (m.db.point_a_snapshots[1].change_reasons as Array<{ type: string; text: string }>)
    expect(texts.some((c) => c.type === 'answers')).toBe(true)
    expect(texts.some((c) => c.type === 'block' && c.text.startsWith('Команда'))).toBe(true)
  })

  it('point_a_v4 on: the diagnostics row is the v4 result', async () => {
    const { state, deps, store } = setup()
    state.useV4 = true
    const r = await buildPointASnapshot('co', { trigger: 'manual' }, deps)
    if (r.status !== 'written') throw new Error(r.status)
    expect(r.engine).toBe('v4')
    expect(store.mock.calls[0][1].result.overall_score).toBe(r.v4.overall ?? 0)
  })

  it('open discrepancies lower the confidence and are part of the inputs', async () => {
    const { m, deps } = setup(CURRENT_TYPICAL, { data_discrepancies: [{ id: 'd', company_id: 'co', metric_key: 'biz.finansy.vyruchka_god', status: 'open' }] })
    const r = await buildPointASnapshot('co', { trigger: 'event' }, deps)
    if (r.status !== 'written') throw new Error(r.status)
    expect(r.v4.blocks.find((b) => b.key === 'finance')!.conflicts).toEqual(['biz.finansy.vyruchka_god'])
    expect((m.db.point_a_snapshots[0].inputs as { conflicts: string[] }).conflicts).toEqual(['biz.finansy.vyruchka_god'])
  })

  it('skips: before migration 111, a company without owner, no answers', async () => {
    const a = setup()
    const notMigrated = memoryClient({}, { missing: ['point_a_snapshots'] })
    expect(await buildPointASnapshot('co', { trigger: 'event' }, { ...a.deps, service: () => notMigrated.client })).toEqual({ status: 'skipped', reason: 'not_migrated' })
    const noOwner = setup(CURRENT_TYPICAL, { companies: [{ id: 'co', user_id: null }] })
    expect(await buildPointASnapshot('co', { trigger: 'event' }, noOwner.deps)).toEqual({ status: 'skipped', reason: 'no_owner' })
    const empty = setup({})
    expect(await buildPointASnapshot('co', { trigger: 'event' }, empty.deps)).toEqual({ status: 'skipped', reason: 'no_answers' })
  })
})

describe('snapshot inputs and change reasons', () => {
  it('a metric value change is a reason with its source and period', () => {
    const values = resolveAllMetrics({ companyId: 'co', userId: 'u', surveyAnswers: { s1_current_revenue_year: 66_000_000 }, documents: [], now: NOW })
    const a = snapshotInputs(values, { s1_current_revenue_year: 66_000_000 }, [], 'default@1/0')
    const values2 = resolveAllMetrics({ companyId: 'co', userId: 'u', surveyAnswers: { s1_current_revenue_year: 80_000_000 }, documents: [], now: NOW })
    const b = snapshotInputs(values2, { s1_current_revenue_year: 80_000_000 }, ['biz.finansy.vyruchka_god'], 'default@1/0')
    expect(inputsHash(a)).not.toBe(inputsHash(b))
    const reasons = changeReasons({ blocks: [], inputs: a }, { blocks: [], inputs: b })
    const metric = reasons.find((r) => r.type === 'metric' && r.metric === 'biz.finansy.vyruchka_god')
    expect(metric?.text).toBe('Выручка (год): 66 млн → 80 млн · 2026-10 · анкета')
    expect(reasons.find((r) => r.type === 'conflicts')?.text).toBe('Найдено расхождений: 1')
    expect(reasons.find((r) => r.type === 'answers')?.text).toBe('Анкета, шаг 1: изменено ответов — 1')
  })
})
