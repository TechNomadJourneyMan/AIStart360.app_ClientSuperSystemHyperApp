/**
 * SurveyAnswersView (spec §6.2–§6.5) rendered to static markup: groups, author
 * line with the path, filters / search a11y, edit buttons only when allowed,
 * print rules, the staff variant, and the inline editor by question type.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SurveyAnswersView } from '@/components/onboarding/answers/SurveyAnswersView'
import { AnswerInlineEditor } from '@/components/onboarding/answers/AnswerInlineEditor'
import { SURVEY_QUESTIONS } from '@/lib/survey/questions'
import type { AnswerAttribution } from '@/lib/survey/attribution-label'

const OWNER = '11111111-1111-4111-8111-111111111111'
const EXPERT = '22222222-2222-4222-8222-222222222222'
const AT = '2026-10-22T09:00:00.000Z'
const answers = {
  s1_company_name: 'ТОО Альфа',
  s12_crm_tool: 'amocrm',
  s3_deal_cycle_days: 30,
  s9n_net_profit: { value: null, unknown: true },
}
const attribution: Record<string, AnswerAttribution> = {
  s1_company_name: { updatedBy: OWNER, updatedByRole: 'user', updatedAt: AT, updatedByName: null, updatedVia: 'express' },
  s12_crm_tool: { updatedBy: OWNER, updatedByRole: 'user', updatedAt: AT, updatedByName: null, updatedVia: 'helper' },
  s3_deal_cycle_days: { updatedBy: EXPERT, updatedByRole: 'expert', updatedAt: AT, updatedByName: 'Иван Петров', updatedVia: 'staff' },
}
const noop = async () => ({ ok: true as const })

const render = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(SurveyAnswersView, {
  answers, attribution, viewer: { viewerIsOwner: true }, mode: 'client', canEdit: true, onSave: noop, pdfHref: '/api/export/report?type=survey', ...over,
} as never))

describe('SurveyAnswersView — client', () => {
  const html = render()

  it('12 step sections with counts, every question, human answers', () => {
    expect(html.match(/<section[^>]*id="answers-step-/g)).toHaveLength(12)
    expect(html).toContain('1. О компании')
    expect(html).toContain('AmoCRM')
    expect(html).toContain('Не знаю')
    expect(html).toContain('Нет ответа')
  })

  it('author line with the path; the summary «кто заполнял»', () => {
    expect(html).toContain('Заполнил: вы (быстрый старт) · 22.10.2026')
    expect(html).toContain('Заполнил: вы (через ИИ-помощника) · 22.10.2026')
    expect(html).toContain('Изменил эксперт Иван Петров · 22.10.2026')
    expect(html).toContain('Кто заполнял: Ответов 4: вы — 2 (из них в быстром старте — 1, через ИИ-помощника — 1), эксперт Иван Петров — 1, без автора (старые) — 1')
  })

  it('search and filters are accessible; «Все» pressed by default', () => {
    expect(html).toContain('role="search"')
    expect(html).toMatch(/<input[^>]*type="search"/)
    expect(html).toContain('aria-live="polite"')
    expect(html).toMatch(/aria-pressed="true"[^>]*>Все</)
    expect(html).toContain('Изменено экспертом')
    expect(html).toContain('ИИ-помощник и документы')
  })

  it('edit / answer buttons; tables and files open the form; PDF and print', () => {
    expect(html).toContain('aria-label="Изменить: CRM-система"')
    expect(html).toContain('aria-label="Ответить: Сайт компании"')
    expect(html).toContain('href="/client/onboarding?step=8#s8n_metrics_table"')
    expect(html).toContain('href="/api/export/report?type=survey"')
    expect(html).toContain('Печать')
    // Buttons and filters are hidden on paper.
    expect(html).toMatch(/role="search"[^>]*>|print:hidden/)
    expect((html.match(/print:hidden/g) ?? []).length).toBeGreaterThan(10)
  })

  it('a filter from the link (?filter=staff) narrows the list', () => {
    const only = render({ initialFilters: ['staff'] })
    expect(only.match(/<section[^>]*id="answers-step-/g)).toHaveLength(1)
    expect(only).toContain('Найдено: 1')
  })

  it('no edit buttons without the right', () => {
    const ro = render({ canEdit: false })
    expect(ro).not.toContain('aria-label="Изменить: CRM-система"')
  })

  it('grouping by mode-2 blocks', () => {
    const blocks = render({ initialGrouping: 'blocks' })
    expect(blocks).toContain('Быстрый старт')
    expect(blocks).toContain('Б11. Финансы')
  })
})

describe('SurveyAnswersView — staff', () => {
  it('names the client and the path the way staff read it; no «Открыть в анкете»', () => {
    const html = render({ mode: 'staff', viewer: { viewerId: EXPERT, ownerName: 'Айгуль' }, onHistory: () => undefined })
    expect(html).toContain('Заполнил пользователь Айгуль (экспресс) · 22.10.2026')
    expect(html).toContain('Изменили вы (эксперт) · 22.10.2026')
    expect(html).not.toContain('Открыть в анкете')
    expect(html).toContain('aria-label="История: CRM-система"')
  })

  it('empty questionnaire', () => {
    const html = render({ mode: 'staff', answers: {}, attribution: {} })
    expect(html).toContain('Клиент ещё не отвечал на вопросы анкеты.')
  })
})

describe('AnswerInlineEditor', () => {
  const ed = (key: string, value: unknown, over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(AnswerInlineEditor, { question: SURVEY_QUESTIONS[key], value, onSave: noop, onCancel: () => undefined, ...over } as never))

  it('the field follows the registry type', () => {
    expect(ed('s1_current_revenue_month', 5_000_000)).toContain('Примерно')
    expect(ed('s3_deal_cycle_days', 30)).toContain('Не знаю')
    expect(ed('s12_crm_tool', 'amocrm')).toMatch(/<option value="amocrm" selected="">AmoCRM<\/option>/)
    expect(ed('s5_marketing_channels', ['SEO'])).toMatch(/aria-pressed="true"[^>]*>SEO</)
    // Yes / no: nothing pressed when there is no answer.
    expect(ed('s4_has_org_chart', undefined)).not.toContain('aria-pressed="true"')
    expect(ed('s4m_delegation_readiness', 7)).toMatch(/aria-pressed="true"[^>]*>7</)
    expect(ed('s6_main_pain', 'текст')).toContain('<textarea')
  })

  it('staff: the reason field (required for experts)', () => {
    expect(ed('s1_website', 'x', { requireReason: true })).toContain('Причина изменения — увидит клиент и журнал')
    expect(ed('s1_website', 'x', { reasonOptional: true })).toContain('(необязательно)')
    expect(ed('s1_website', 'x')).not.toContain('Причина')
  })
})
