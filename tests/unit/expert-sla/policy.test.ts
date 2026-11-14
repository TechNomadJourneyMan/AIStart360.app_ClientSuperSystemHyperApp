/**
 * R2-B — правила SLA экспертов (lib/expert-sla/policy.ts): сроки 24 / 48 ч,
 * состояние задачи на подменённый момент времени, таймер «осталось N ч» и
 * честный текст клиенту.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXPERT_SLA, clientPromiseText, hoursGenitive, hoursLeft, isExpertWorkSource, slaDeadlines, slaStage, slaTimerLabel, type SlaTimes,
} from '@/lib/expert-sla/policy'
import { SETTINGS, coerceSetting, validateSetting } from '@/lib/settings/registry'

const T0 = new Date('2026-11-14T06:00:00.000Z')
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000)

function task(over: Partial<SlaTimes> = {}): SlaTimes {
  return { received_at: T0.toISOString(), ...slaDeadlines(T0), first_response_at: null, closed_at: null, ...over }
}

describe('expert SLA policy', () => {
  it('PO decision is the default: reaction 24 h, answer 48 h, auto-assignment on', () => {
    expect(DEFAULT_EXPERT_SLA).toEqual({ enabled: true, reaction_hours: 24, answer_hours: 48, auto_assign: true })
    expect(slaDeadlines(T0)).toEqual({ reaction_due_at: at(24).toISOString(), answer_due_at: at(48).toISOString() })
    // The answer deadline is never before the reaction one.
    expect(slaDeadlines(T0, { reaction_hours: 30, answer_hours: 10 }).answer_due_at).toBe(at(30).toISOString())
  })

  it('the setting refuses an answer window shorter than the reaction window and merges partial values', () => {
    expect(validateSetting('expert_sla', { enabled: true, reaction_hours: 24, answer_hours: 12, auto_assign: true }).ok).toBe(false)
    expect(validateSetting('expert_sla', { enabled: true, reaction_hours: 12, answer_hours: 36, auto_assign: false }).ok).toBe(true)
    expect(coerceSetting('expert_sla', { auto_assign: false })).toEqual({ ...SETTINGS.expert_sla.default, auto_assign: false })
    expect(coerceSetting('expert_sla', 'garbage')).toEqual(SETTINGS.expert_sla.default)
  })

  it('stage over a substituted clock: ok → due soon → no reaction (24 h) → breached (48 h)', () => {
    const t = task()
    expect(slaStage(t, at(1))).toBe('ok')
    expect(slaStage(t, at(17.9))).toBe('ok')
    expect(slaStage(t, at(18))).toBe('due_soon') // 6 h before the reaction deadline
    expect(slaStage(t, at(24))).toBe('escalated')
    expect(slaStage(t, at(47.99))).toBe('escalated')
    expect(slaStage(t, at(48))).toBe('breached')
  })

  it('after a reaction only the answer deadline counts; an answer closes the task whatever the clock says', () => {
    const reacted = task({ first_response_at: at(2).toISOString() })
    expect(slaStage(reacted, at(30))).toBe('ok')
    expect(slaStage(reacted, at(42))).toBe('due_soon')
    expect(slaStage(reacted, at(49))).toBe('breached')
    expect(slaStage(task({ closed_at: at(60).toISOString() }), at(100))).toBe('closed')
  })

  it('timer text: «осталось N ч», «осталось N мин», «просрочено на N ч», «ответ дан»', () => {
    const t = task()
    expect(slaTimerLabel(t, at(0))).toBe('осталось 48 ч')
    expect(slaTimerLabel(t, at(16.5))).toBe('осталось 31 ч')
    expect(slaTimerLabel(t, at(47.5))).toBe('осталось 30 мин')
    expect(slaTimerLabel(t, at(53))).toBe('просрочено на 5 ч')
    expect(slaTimerLabel(task({ closed_at: at(3).toISOString() }), at(53))).toBe('ответ дан')
    expect(hoursLeft(t, at(16.5))).toBe(31.5)
    expect(hoursLeft(t, at(50))).toBe(-2)
  })

  it('client promise: «Эксперт ответит в течение 48 часов.» with the right Russian form', () => {
    expect(clientPromiseText()).toBe('Эксперт ответит в течение 48 часов.')
    expect(clientPromiseText(24)).toBe('Эксперт ответит в течение 24 часов.')
    expect(clientPromiseText(21)).toBe('Эксперт ответит в течение 21 часа.')
    expect(clientPromiseText(1)).toBe('Эксперт ответит в течение 1 часа.')
    expect(hoursGenitive(11)).toBe('часов')
    expect(hoursGenitive(101)).toBe('часа')
  })

  it('plan approval is not expert work (Admin / Super Admin approve)', () => {
    expect(isExpertWorkSource('case')).toBe(true)
    expect(isExpertWorkSource('report_review')).toBe(true)
    expect(isExpertWorkSource('rec_review')).toBe(true)
    expect(isExpertWorkSource('plan_review')).toBe(false)
    expect(isExpertWorkSource('other')).toBe(false)
  })
})
