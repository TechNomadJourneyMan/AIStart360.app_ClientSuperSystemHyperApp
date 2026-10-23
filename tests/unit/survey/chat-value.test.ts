/** The server builds the card value from the model's literals (spec §8.2). */
import { describe, expect, it } from 'vitest'
import { buildProposal, editedEnvelope, matchOption } from '@/lib/survey/chat/value'
import { SURVEY_QUESTIONS } from '@/lib/survey/questions'
import type { ModelTurn } from '@/lib/survey/chat/types'

const turn = (p: Partial<ModelTurn>): ModelTurn => ({ intent: 'answer', numbers: [], options: [], bool: null, text: null, clarify: null, reply: null, block: null, ...p })
const Q = SURVEY_QUESTIONS

describe('buildProposal', () => {
  it('money: approx range from the client words', () => {
    const r = buildProposal(Q.s1_current_revenue_month, turn({ intent: 'approx', numbers: [{ raw: '5', scale: null, period: null }, { raw: '6', scale: 'млн', period: 'month' }] }), ['где-то пять-шесть миллионов в месяц'])
    expect(r.ok && r.proposal.envelope).toEqual({ value: 5_500_000, approx: true, range: [5_000_000, 6_000_000] })
    expect(r.ok && r.proposal.display).toBe('≈ 5 500 000 ₸ (5 000 000 – 6 000 000 ₸)')
    expect(r.ok && r.proposal.quote).toBe('где-то пять-шесть миллионов в месяц')
  })

  it('a number not in the client words → number_guard, no value', () => {
    const r = buildProposal(Q.s1_current_revenue_month, turn({ numbers: [{ raw: '8', scale: 'млн', period: null }] }), ['около 5 млн'])
    expect(r).toMatchObject({ ok: false, reason: 'number_guard', detail: 'not_in_text' })
  })

  it('percent range and integer counts', () => {
    expect(buildProposal(Q.s5_marketing_budget_pct, turn({ numbers: [{ raw: '150', scale: null, period: null }] }), ['150 процентов'])).toMatchObject({ ok: false, reason: 'out_of_range' })
    expect(buildProposal(Q.s1_employee_count, turn({ numbers: [{ raw: '12,5', scale: null, period: null }] }), ['12,5 человек'])).toMatchObject({ ok: false, reason: 'out_of_range' })
    const ok = buildProposal(Q.s1_employee_count, turn({ numbers: [{ raw: '12', scale: null, period: null }] }), ['нас 12'])
    expect(ok.ok && ok.proposal.envelope).toEqual({ value: 12 })
  })

  it('select only from the registry options', () => {
    expect(matchOption(Q.s12_crm_tool, 'Bitrix24')).toBe('bitrix24')
    expect(buildProposal(Q.s12_crm_tool, turn({ options: ['amocrm'] }), ['в амо']).ok).toBe(true)
    expect(buildProposal(Q.s12_crm_tool, turn({ options: ['salesforce'] }), ['salesforce'])).toMatchObject({ ok: false, reason: 'bad_option' })
  })

  it('bool and unknown', () => {
    const b = buildProposal(Q.s4_has_org_chart, turn({ bool: false }), ['нет'])
    expect(b.ok && b.proposal.envelope).toEqual({ value: false })
    const u = buildProposal(Q.s9n_net_margin, turn({ intent: 'unknown' }), ['не считаем'])
    expect(u.ok && u.proposal.envelope).toEqual({ value: null, unknown: true })
    expect(u.ok && u.proposal.display).toBe('Не знаю')
  })

  it('text = the client words as they are, never the model paraphrase', () => {
    const r = buildProposal(Q.s6_main_pain, turn({ text: 'Перефразировано моделью' }), ['нет людей', 'и денег мало'])
    expect(r.ok && r.proposal.envelope).toEqual({ value: 'нет людей\nи денег мало' })
  })

  it('negative only when the client said so', () => {
    const q = Q.s9n_net_profit
    const neg = buildProposal(q, turn({ numbers: [{ raw: '-2', scale: 'млн', period: null }] }), ['убыток 2 млн'])
    expect(neg.ok && neg.proposal.envelope.value).toBe(-2_000_000)
    const pos = buildProposal(q, turn({ numbers: [{ raw: '-2', scale: 'млн', period: null }] }), ['2 млн'])
    expect(pos.ok && pos.proposal.envelope.value).toBe(2_000_000)
  })
})

describe('editedEnvelope («Исправить»)', () => {
  it('same field schema', () => {
    expect(editedEnvelope(Q.s1_employee_count, '15')).toEqual({ value: 15 })
    expect(editedEnvelope(Q.s1_employee_count, '-1')).toBeNull()
    expect(editedEnvelope(Q.s12_crm_tool, 'Нет')).toEqual({ value: 'none' })
    expect(editedEnvelope(Q.s12_crm_tool, 'oracle')).toBeNull()
    expect(editedEnvelope(Q.s1_current_revenue_month, { value: 5_500_000, approx: true, range: [5_000_000, 6_000_000] })).toEqual({ value: 5_500_000, approx: true, range: [5_000_000, 6_000_000] })
    expect(editedEnvelope(Q.s1_current_revenue_month, { value: 1, approx: true, range: [5, 6] })).toBeNull()
  })
})
