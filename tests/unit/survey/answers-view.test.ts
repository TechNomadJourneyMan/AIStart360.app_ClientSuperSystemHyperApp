/**
 * lib/survey/answers-view.ts — «Мои ответы» and the staff view (spec §6.2–§6.5):
 * every registry question with its answer in human words, filters, search,
 * groups by step / by block, the summary.
 */
import { describe, expect, it } from 'vitest'
import {
  answersSummary, buildAnswerItems, displayAnswer, editKindOf, filterAnswerItems, formHref, groupAnswerItems, parseAnswerFilters,
} from '@/lib/survey/answers-view'
import { SURVEY_QUESTIONS } from '@/lib/survey/questions'
import type { AnswerAttribution } from '@/lib/survey/attribution-label'

const OWNER = '11111111-1111-4111-8111-111111111111'
const EXPERT = '22222222-2222-4222-8222-222222222222'
const AT = '2026-10-22T09:00:00.000Z'
const att = (over: Partial<AnswerAttribution>): AnswerAttribution => ({ updatedBy: OWNER, updatedByRole: 'user', updatedAt: AT, updatedByName: null, ...over })

const answers: Record<string, unknown> = {
  s1_company_name: 'ТОО Альфа',
  s1_current_revenue_month: { value: 5_500_000, approx: true, range: [5_000_000, 6_000_000] },
  s1_current_revenue_year: 66_000_000,
  s12_crm_tool: 'amocrm',
  s5_marketing_channels: ['SEO', 'PR / СМИ'],
  s4_has_org_chart: true,
  s9n_net_profit: { value: null, unknown: true },
  s3_deal_cycle_days: 30,
  s6_main_pain: '**Нет** системы продаж',
  s4m_delegation_readiness: 7,
  s11_influence_map: [{ category: 'Клиенты', name_or_link: 'Kaspi', status: 'есть контакт' }, { category: 'СМИ / PR', name_or_link: '', status: '' }],
}
const attribution: Record<string, AnswerAttribution> = {
  s1_company_name: att({ updatedVia: 'full' }),
  s12_crm_tool: att({ updatedVia: 'helper' }),
  s3_deal_cycle_days: att({ updatedBy: EXPERT, updatedByRole: 'expert', updatedByName: 'Иван Петров', updatedVia: 'staff' }),
  s9n_net_profit: att({ updatedByRole: 'ai', updatedVia: 'document' }),
}

describe('displayAnswer', () => {
  it('human words for every type', () => {
    const q = SURVEY_QUESTIONS
    expect(displayAnswer(q.s12_crm_tool, 'amocrm')).toBe('AmoCRM')
    expect(displayAnswer(q.s5_marketing_channels, ['SEO', 'PR / СМИ'])).toBe('SEO, PR / СМИ')
    expect(displayAnswer(q.s4_has_org_chart, false)).toBe('Нет')
    expect(displayAnswer(q.s9n_net_profit, { value: null, unknown: true })).toBe('Не знаю')
    expect(displayAnswer(q.s1_current_revenue_month, { value: 5_500_000, approx: true, range: [5_000_000, 6_000_000] })).toBe('≈ 5 500 000 ₸/мес (5 000 000 – 6 000 000 ₸/мес)')
    expect(displayAnswer(q.s1_current_revenue_year, 66_000_000)).toBe('66 000 000 ₸/год')
    expect(displayAnswer(q.s5_marketing_budget_pct, 12.5)).toBe('12,5%')
    expect(displayAnswer(q.s4m_delegation_readiness, 7)).toBe('7 из 10')
    expect(displayAnswer(q.s6_main_pain, '**Нет** системы')).toBe('Нет системы')
    expect(displayAnswer(q.s11_influence_map, answers.s11_influence_map)).toBe('1 строка · Клиенты — Kaspi — есть контакт')
    expect(displayAnswer(q.s1_website, '  ')).toBe('Нет ответа')
    expect(displayAnswer(q.s11_influence_map, [{ category: 'Клиенты', name_or_link: '', status: '' }])).toBe('Нет ответа')
  })

  it('edit kinds: in place / Markdown editor / the form / none for auto keys', () => {
    expect(editKindOf(SURVEY_QUESTIONS.s12_crm_tool)).toBe('inline')
    expect(editKindOf(SURVEY_QUESTIONS.s6_main_pain)).toBe('modal')
    expect(editKindOf(SURVEY_QUESTIONS.s8n_metrics_table)).toBe('form')
    expect(editKindOf(SURVEY_QUESTIONS.s6n_script_meeting)).toBe('form')
    expect(editKindOf(SURVEY_QUESTIONS.s1_current_revenue_year)).toBe('none')
    expect(formHref(SURVEY_QUESTIONS.s8n_metrics_table)).toBe('/client/onboarding?step=8#s8n_metrics_table')
  })
})

describe('items, filters, search', () => {
  const items = buildAnswerItems(answers, attribution, { viewerIsOwner: true })

  it('all 174 questions, author line with the path', () => {
    expect(items).toHaveLength(174)
    const crm = items.find((i) => i.question.key === 's12_crm_tool')!
    expect(crm.authorLine).toBe('Заполнил: вы (через ИИ-помощника) · 22.10.2026')
    expect(items.find((i) => i.question.key === 's3_deal_cycle_days')!.authorLine).toBe('Изменил эксперт Иван Петров · 22.10.2026')
    // An empty question has no author line even if a stale author arrived.
    expect(buildAnswerItems({}, { s1_website: att({}) }).find((i) => i.question.key === 's1_website')!.authorLine).toBeNull()
  })

  it('filters: empty / unsure / assistant / staff / minimum; several = any of them', () => {
    const keys = (f: Parameters<typeof filterAnswerItems>[1]) => filterAnswerItems(items, f).map((i) => i.question.key)
    expect(keys(['unsure'])).toEqual(['s1_current_revenue_month', 's9n_net_profit'])
    expect(keys(['assistant'])).toEqual(['s9n_net_profit', 's12_crm_tool'])
    expect(keys(['staff'])).toEqual(['s3_deal_cycle_days'])
    expect(keys(['staff', 'unsure']).sort()).toEqual(['s1_current_revenue_month', 's3_deal_cycle_days', 's9n_net_profit'])
    expect(keys(['minimum'])).toContain('s9n_breakeven_point')
    const empty = keys(['empty'])
    expect(empty).not.toContain('s1_company_name')
    expect(empty).not.toContain('s1_goal_12m_revenue_year') // auto keys are not «questions to answer»
    expect(empty).toHaveLength(171 - 10)
    expect(filterAnswerItems(items, [])).toHaveLength(174)
  })

  it('search: labels and answers, case and ё insensitive, every word', () => {
    expect(filterAnswerItems(items, [], 'АЛЬФА').map((i) => i.question.key)).toEqual(['s1_company_name'])
    expect(filterAnswerItems(items, [], 'цикл сделки').map((i) => i.question.key)).toEqual(['s3_deal_cycle_days'])
    expect(filterAnswerItems(items, [], 'amocrm').map((i) => i.question.key)).toEqual(['s12_crm_tool'])
    expect(filterAnswerItems(items, [], 'учет').map((i) => i.question.key)).toContain('s9n_accounting_method')
    expect(filterAnswerItems(items, ['staff'], 'выручка')).toHaveLength(0)
  })

  it('groups by the 12 steps or by express + 15 blocks, with answered / total', () => {
    const steps = groupAnswerItems(items, 'steps')
    expect(steps).toHaveLength(12)
    expect(steps[0]).toMatchObject({ id: 'step-1', title: '1. О компании', total: 18 })
    expect(steps[0].answered).toBe(2)
    const blocks = groupAnswerItems(items, 'blocks')
    expect(blocks.map((g) => g.id)).toEqual(['express', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10', 'b11', 'b12', 'b13', 'b14', 'b15'])
    expect(blocks[0]).toMatchObject({ title: 'Быстрый старт', total: 26 })
    // A filtered list drops empty groups.
    expect(groupAnswerItems(filterAnswerItems(items, ['staff']), 'steps').map((g) => g.id)).toEqual(['step-5'])
  })

  it('summary: depth, «не знаю», minimum, who filled', () => {
    const s = answersSummary(items, answers)
    expect(s).toMatchObject({ answered: 10, total: 171, depth: 6, unknown: 1, approx: 1 })
    expect(s.minimum.total).toBe(15)
    expect(s.authors).toMatchObject({ total: 10, owner: 2, ownerViaAssistant: 1, documents: 1, unknown: 6 })
  })

  it('filters from the query string', () => {
    expect(parseAnswerFilters('staff,empty,nope')).toEqual(['staff', 'empty'])
    expect(parseAnswerFilters(null)).toEqual([])
  })
})

describe('surveyPrintModel — paper and PDF (spec §6.4)', () => {
  it('answered questions by step, with the author line and «кто заполнял»', async () => {
    const m = (await import('@/lib/survey/answers-view')).surveyPrintModel(answers, attribution)
    expect(m.answered).toBe(10)
    expect(m.summary).toContain('Кто заполнял: Ответов 10: вы — 2 (из них через ИИ-помощника — 1)')
    const step12 = m.sections.find((s) => s.title === '12. Системы и инструменты')!
    expect(step12.rows).toEqual([{ label: 'CRM-система', value: 'AmoCRM', author: 'Заполнил: вы (через ИИ-помощника) · 22.10.2026' }])
    expect(m.sections.flatMap((s) => s.rows).find((r) => r.label === 'Чистая прибыль / убыток')?.value).toBe('Не знаю')
  })

  it('renders a PDF with the new layout', async () => {
    const { renderSurveyPdf } = await import('@/lib/reports/pdf')
    const { surveyPrintModel } = await import('@/lib/survey/answers-view')
    const pdf = await renderSurveyPdf({ meta: { companyName: 'ТОО Альфа' }, answers: {}, print: surveyPrintModel(answers, attribution) })
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
  }, 30_000)
})
