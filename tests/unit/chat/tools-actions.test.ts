import { describe, it, expect, vi } from 'vitest'
import { CHAT_TOOLS, toolsFor, type ToolContext } from '@/lib/chat/tools'
import { decideAction } from '@/lib/chat/actions'
import { memoryClient } from '../data-layer/memory-client'

const tool = (n: string) => CHAT_TOOLS.find((t) => t.name === n)!

function ctx(m: ReturnType<typeof memoryClient>, over: Partial<ToolContext> = {}): ToolContext {
  return { companyId: 'co', userId: 'u', ownerId: 'u', sb: m.client, canManage: true, now: new Date('2026-10-12T00:00:00Z'), propose: vi.fn(async () => 'act-1'), ...over }
}

describe('chat tools', () => {
  it('read-only users get no proposal tools', () => {
    expect(toolsFor(false).every((t) => t.kind === 'read')).toBe(true)
    expect(toolsFor(true).some((t) => t.kind === 'propose')).toBe(true)
  })

  it('get_point_a reads the company snapshot only', async () => {
    const m = memoryClient({ point_a_snapshots: [
      { id: 's-other', company_id: 'other', created_at: '2026-10-11', overall: 99, blocks: [] },
      { id: 's1', company_id: 'co', created_at: '2026-10-10', overall: 64, confidence: 0.5, blocks: [{ key: 'finance', title: 'Финансы', score: 70, checks: [] }], v4: {}, change_reasons: [{ text: 'x' }] },
    ] })
    const r = await tool('get_point_a').run({}, ctx(m))
    expect(r).toMatchObject({ overall: 64, recent_changes: ['x'] })
    expect((r.blocks as Array<{ key: string }>)[0].key).toBe('finance')
  })

  it('propose_metric_value checks the metric, the period and the range; writes nothing itself', async () => {
    const m = memoryClient({ metrics: [] })
    const c = ctx(m)
    await expect(tool('propose_metric_value').run({ metric_id: 'nope', period: '2024', value: 1, reason: 'r' }, c)).rejects.toThrow(/Неизвестная/)
    await expect(tool('propose_metric_value').run({ metric_id: 'biz.klienty.nps', period: '2024', value: 900, reason: 'r' }, c)).rejects.toThrow(/диапазона/)
    await expect(tool('propose_metric_value').run({ metric_id: 'biz.finansy.vyruchka_god', period: 'вчера', value: 1, reason: 'r' }, c)).rejects.toThrow(/Период/)
    const r = await tool('propose_metric_value').run({ metric_id: 'biz.finansy.vyruchka_god', period: '2024', value: 14_000_000, reason: 'по ОПиУ' }, c)
    expect(r).toMatchObject({ status: 'proposed', action_id: 'act-1' })
    expect(c.propose).toHaveBeenCalledWith('set_value', expect.objectContaining({ metric_id: 'biz.finansy.vyruchka_god', period_key: '2024', value: 14_000_000 }), expect.objectContaining({ after: expect.stringContaining('14') }))
    expect(m.db.metric_overrides ?? []).toEqual([])
  })
})

describe('decideAction', () => {
  const base = { id: 'a1', user_id: 'u', company_id: 'co', status: 'pending', expires_at: new Date(Date.now() + 3600e3).toISOString() }
  const actor = { userId: 'u', canManage: true, expert: false }

  it('apply set_value → manual value of the period + MANUAL_VALUE_SET', async () => {
    const m = memoryClient({ ai_pending_actions: [{ ...base, kind: 'set_value', payload: { metric_id: 'biz.finansy.vyruchka_god', period_key: '2024', value: 14_000_000 } }] })
    const row = m.db.ai_pending_actions[0] as never
    const out = await decideAction(m.client, row, 'apply', actor)
    expect(out).toMatchObject({ ok: true, status: 'applied', event: 'MANUAL_VALUE_SET' })
    expect(m.db.metric_overrides[0]).toMatchObject({ company_id: 'co', metric_key: 'biz.finansy.vyruchka_god', period_key: '2024', value: 14_000_000, set_by: 'u' })
    expect(m.db.ai_pending_actions[0].status).toBe('applied')
  })

  it('reject, expired, already decided, no manage access', async () => {
    const fresh = (over: Record<string, unknown> = {}) => {
      const m = memoryClient({ ai_pending_actions: [{ ...base, kind: 'set_goal', payload: {}, ...over }] })
      return { m, row: m.db.ai_pending_actions[0] as never }
    }
    let f = fresh({ status: 'applied' })
    expect(await decideAction(f.m.client, f.row, 'apply', actor)).toMatchObject({ ok: false, status: 409 })
    f = fresh({ expires_at: '2020-01-01' })
    expect(await decideAction(f.m.client, f.row, 'apply', actor)).toMatchObject({ ok: false, status: 410 })
    f = fresh()
    expect(await decideAction(f.m.client, f.row, 'apply', { ...actor, canManage: false })).toMatchObject({ ok: false, status: 403 })
    f = fresh()
    expect(await decideAction(f.m.client, f.row, 'reject', { ...actor, canManage: false })).toMatchObject({ ok: true, status: 'rejected' })
  })

  it('two parallel «Применить» — only one applies, the other is already decided', async () => {
    const m = memoryClient({ ai_pending_actions: [{ ...base, kind: 'set_value', payload: { metric_id: 'biz.finansy.vyruchka_god', period_key: '2024', value: 14_000_000 } }] })
    const row = { ...(m.db.ai_pending_actions[0] as object) } as never
    const [a, b] = await Promise.all([decideAction(m.client, row, 'apply', actor), decideAction(m.client, row, 'apply', actor)])
    expect([a, b].filter((o) => o.ok)).toHaveLength(1)
    expect([a, b].find((o) => !o.ok)).toMatchObject({ status: 409, error: 'already_decided' })
    expect(m.db.metric_overrides).toHaveLength(1)
    expect(m.db.ai_pending_actions[0].status).toBe('applied')
  })

  it('apply set_goal → the goals store', async () => {
    const m = memoryClient({ companies: [{ id: 'co' }], metric_targets: [], metrics: [], ai_pending_actions: [{ ...base, kind: 'set_goal', payload: { metricId: 'biz.finansy.valovaya_marzha', targetValue: 40, periodLabel: '12m', label: 'Маржа' } }] })
    const out = await decideAction(m.client, m.db.ai_pending_actions[0] as never, 'apply', actor)
    expect(out).toMatchObject({ ok: true, event: 'TARGET_CHANGED' })
    expect(m.db.metric_targets[0]).toMatchObject({ metric_key: 'biz.finansy.valovaya_marzha', target_value: 40 })
  })
})
