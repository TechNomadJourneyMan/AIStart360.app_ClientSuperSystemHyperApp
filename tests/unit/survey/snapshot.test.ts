/**
 * «Снимок бизнеса» logic (spec §7.3): five numbers, margin money, blind spots,
 * Point A read from the state (fresh / pending / ready).
 */
import { describe, expect, it } from 'vitest'
import { expressBlindSpots, marginMoney, readSnapshotPointA, snapshotFigures } from '@/lib/survey/snapshot'
import { approxAnswer, unknownAnswer } from '@/lib/survey/answer-value'

const base = { s1_current_revenue_month: 5_500_000, s1_goal_12m_revenue_month: 9_000_000, s1_employee_count: 18, s9n_net_margin: 15, s4m_hours_on_ops: 8 }

describe('snapshotFigures', () => {
  it('five numbers from the owner answers', () => {
    const f = Object.fromEntries(snapshotFigures(base).map((x) => [x.id, x]))
    expect(Object.keys(f)).toEqual(['revenue', 'goal', 'per_employee', 'margin', 'hours'])
    expect(f.revenue.value).toMatch(/5,5 млн ₸/)
    expect(f.goal.note).toMatch(/^нужно \+4,2 % каждый месяц$/)
    expect(f.per_employee.value).toMatch(/3,7 млн ₸/)
    expect(f.margin.value).toBe('15 ₸')
    expect(f.margin.note).toMatch(/825 тыс\. ₸ чистыми в месяц/)
    expect(f.hours.value).toBe('176 ч')
  })
  it('missing → no value and the question to ask; «не знаю» flagged', () => {
    const f = Object.fromEntries(snapshotFigures({ s9n_net_margin: unknownAnswer() }).map((x) => [x.id, x]))
    expect(f.revenue).toMatchObject({ value: null, askKey: 's1_current_revenue_month', unknown: false })
    expect(f.margin).toMatchObject({ value: null, unknown: true })
    expect(f.per_employee.askKey).toBe('s1_employee_count')
  })
  it('«примерно» → «≈ … (диапазон …)»', () => {
    const f = snapshotFigures({ s1_current_revenue_month: approxAnswer(5_000_000, 6_000_000) })[0]
    expect(f.value).toMatch(/^≈ 5,5 млн ₸ \(диапазон 5 млн ₸ – 6 млн ₸\)$/)
  })
})

describe('marginMoney and blind spots', () => {
  it('margin in money; without revenue — a hint', () => {
    expect(marginMoney(base)?.line).toMatch(/^С каждых 100 ₸ выручки остаётся 15 ₸ — ≈ 825 тыс\. ₸ в месяц\.$/)
    expect(marginMoney({ s9n_net_margin: 15 })?.note).toMatch(/Укажите выручку/)
    expect(marginMoney({})).toBeNull()
  })
  it('«Вы не знаете 3 из 26 цифр быстрого старта: …»', () => {
    const s = expressBlindSpots({ s9n_net_margin: unknownAnswer(), s3_deal_cycle_days: unknownAnswer(), s9n_breakeven_point: unknownAnswer(), s9n_net_profit: unknownAnswer() })
    expect(s.count).toBe(3)
    expect(s.text).toMatch(/^Вы не знаете 3 из 26 цифр быстрого старта: цикл сделки \(дней\), чистая маржа, точка безубыточности\. Это первое, что стоит начать считать\.$/)
    expect(expressBlindSpots({}).text).toBeNull()
  })
})

describe('readSnapshotPointA', () => {
  const snap = (createdAt: string) => ({ createdAt, overall: 62, confidence: 0.5, blocks: [] })
  const fresh = Date.parse('2026-10-23T10:00:00Z')
  it('a snapshot older than «Готово» is the previous one → pending, poll', () => {
    expect(readSnapshotPointA({ snapshot: snap('2026-10-20T10:00:00Z'), recalculation: 'idle' }, fresh)).toMatchObject({ view: { state: 'pending' }, poll: true })
  })
  it('the new snapshot → ready', () => {
    expect(readSnapshotPointA({ snapshot: snap('2026-10-23T10:00:20Z'), recalculation: 'idle' }, fresh)).toMatchObject({ view: { state: 'ready' }, poll: false })
  })
  it('a running recalculation → pending; nothing and no «Готово» → none', () => {
    expect(readSnapshotPointA({ snapshot: null, recalculation: 'running' }, null).view.state).toBe('pending')
    expect(readSnapshotPointA({ snapshot: null, recalculation: 'idle' }, null)).toEqual({ view: { state: 'none' }, poll: false })
    expect(readSnapshotPointA(null, null).view.state).toBe('none')
  })
})
