import { describe, expect, it } from 'vitest'
import { canTransition, checkApprovalConditions, EXCEPTION_REASON_MIN, isEditable } from '@/lib/point-b/plan/status'
import type { GoalReviewStatus, PlanGoalsSnapshot } from '@/lib/point-b/plan/types'

const REVENUE = 'biz.finansy.vyruchka_god'

function goals(status: GoalReviewStatus | null, primary = true): PlanGoalsSnapshot {
  return {
    primary: primary ? { metricKey: REVENUE, periodLabel: '12m' } : null,
    items: status === null ? [] : [{
      metricKey: REVENUE, periodLabel: '12m', label: 'Выручка', baselineValue: 100, baselinePeriod: '2026',
      targetValue: 200, deadline: null, reviewStatus: status,
    }],
  }
}

describe('plan version state machine', () => {
  it('draft → in_review on submit only', () => {
    expect(canTransition('draft', 'submit')).toBe(true)
    for (const t of ['approve', 'reject', 'supersede'] as const) expect(canTransition('draft', t)).toBe(false)
    for (const from of ['in_review', 'approved', 'superseded'] as const) expect(canTransition(from, 'submit')).toBe(false)
  })

  it('in_review → approved on approve, in_review → draft on reject', () => {
    expect(canTransition('in_review', 'approve')).toBe(true)
    expect(canTransition('in_review', 'reject')).toBe(true)
    expect(canTransition('in_review', 'supersede')).toBe(false)
    expect(canTransition('draft', 'approve')).toBe(false)
    expect(canTransition('approved', 'reject')).toBe(false)
  })

  it('approved can only be superseded', () => {
    expect(canTransition('approved', 'supersede')).toBe(true)
    for (const t of ['submit', 'approve', 'reject'] as const) expect(canTransition('approved', t)).toBe(false)
    for (const t of ['submit', 'approve', 'reject', 'supersede'] as const) expect(canTransition('superseded', t)).toBe(false)
  })

  it('only draft is editable', () => {
    expect(isEditable('draft')).toBe(true)
    for (const s of ['in_review', 'approved', 'superseded'] as const) expect(isEditable(s)).toBe(false)
  })
})

describe('checkApprovalConditions', () => {
  const reason = 'Обновили цель по выручке'

  it('approval fails without a verified primary goal and lists the reason', () => {
    const r = checkApprovalConditions({ goals: goals('owner_draft'), changeReason: reason })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasons).toContain('Главная цель не проверена экспертом')
  })

  it('owner_draft, corrected and disputed primary goals block approval', () => {
    for (const s of ['owner_draft', 'corrected', 'disputed'] as const) {
      expect(checkApprovalConditions({ goals: goals(s), changeReason: reason }).ok).toBe(false)
    }
  })

  it('agreed and verified pass', () => {
    for (const s of ['agreed', 'verified'] as const) {
      expect(checkApprovalConditions({ goals: goals(s), changeReason: reason })).toEqual({ ok: true, exception: false })
    }
  })

  it('a primary goal that is missing from the items is treated as not verified', () => {
    const g: PlanGoalsSnapshot = { primary: { metricKey: REVENUE, periodLabel: '12m' }, items: [] }
    expect(checkApprovalConditions({ goals: g, changeReason: reason }).ok).toBe(false)
  })

  it('exception reason shorter than 10 chars is rejected', () => {
    expect(EXCEPTION_REASON_MIN).toBe(10)
    const r = checkApprovalConditions({ goals: goals('owner_draft'), changeReason: reason }, { exceptionReason: '123456789' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasons.some((x) => x.includes('10'))).toBe(true)
    // whitespace does not count
    expect(checkApprovalConditions({ goals: goals('owner_draft'), changeReason: reason }, { exceptionReason: '   12345   ' }).ok).toBe(false)
  })

  it('a sufficient exception reason passes the goal condition and is flagged as an exception', () => {
    expect(checkApprovalConditions({ goals: goals('owner_draft'), changeReason: reason }, { exceptionReason: 'Владелец недоступен, срок горит' }))
      .toEqual({ ok: true, exception: true })
  })

  it('an exception is not flagged when the goal condition holds anyway', () => {
    expect(checkApprovalConditions({ goals: goals('verified'), changeReason: reason }, { exceptionReason: 'Не нужна, но есть' }))
      .toEqual({ ok: true, exception: false })
  })

  it('exception passes goal condition but not the missing change reason', () => {
    for (const changeReason of [null, '', '   ']) {
      const r = checkApprovalConditions({ goals: goals('owner_draft'), changeReason }, { exceptionReason: 'Достаточно длинная причина' })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.reasons).toContain('Не указана причина изменений')
        expect(r.reasons).not.toContain('Главная цель не проверена экспертом')
      }
    }
  })

  it('no primary goal at all blocks approval', () => {
    const r = checkApprovalConditions({ goals: goals(null, false), changeReason: reason })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasons).toContain('Не задана главная цель')
    // and a long exception reason bypasses it, as any goal condition
    expect(checkApprovalConditions({ goals: goals(null, false), changeReason: reason }, { exceptionReason: 'Согласовано с владельцем устно' }).ok).toBe(true)
  })

  it('lists every failed condition at once', () => {
    const r = checkApprovalConditions({ goals: goals('corrected'), changeReason: null })
    expect(r).toEqual({ ok: false, reasons: ['Главная цель не проверена экспертом', 'Не указана причина изменений'] })
  })
})
