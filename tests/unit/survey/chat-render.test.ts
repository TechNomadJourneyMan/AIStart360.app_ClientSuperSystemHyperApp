/**
 * The questionnaire chat UI rendered to static markup (spec §8.1, §8.3, §14.4):
 * the log is announced politely, a card is a labelled group with «Записать /
 * Исправить / Пропустить», the staff transcript has no buttons, the helper
 * panel says the value goes into the form only after «Записать».
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatMessages, QuickActions } from '@/components/onboarding/chat/ChatMessages'
import { ProposalCard } from '@/components/onboarding/chat/ProposalCard'
import { SurveyChatTranscriptView } from '@/components/onboarding/chat/SurveyChatTranscript'
import { QuestionPanel } from '@/components/onboarding/chat/SurveyChat'
import { FieldHelperPanel, helperFormValue } from '@/components/onboarding/chat/FieldHelperPanel'
import { helperKeyAllowed } from '@/components/onboarding/chat/FieldHelperLayer'
import { questionDTO } from '@/lib/survey/chat/ask'
import { SURVEY_QUESTIONS } from '@/lib/survey/questions'
import type { ChatMessageDTO, ProposalDTO } from '@/lib/survey/chat/types'

const proposal = (over: Partial<ProposalDTO> = {}): ProposalDTO => ({
  id: 'a1', key: 's1_current_revenue_month', title: 'Текущая выручка / месяц', display: '≈ 5 500 000 ₸ (5 000 000 – 6 000 000 ₸)',
  quote: 'где-то пять-шесть миллионов в месяц', note: null, before: null, beforeByStaff: false,
  envelope: { value: 5_500_000, approx: true, range: [5_000_000, 6_000_000] }, status: 'pending', expiresAt: null, ...over,
})
const msg = (over: Partial<ChatMessageDTO>): ChatMessageDTO => ({ id: 'm1', role: 'assistant', content: 'Записать в анкету?', kind: 'proposal', key: 's1_current_revenue_month', focus: false, proposal: null, createdAt: '2026-10-23T10:00:00Z', ...over })

describe('chat UI', () => {
  it('the log and a pending card', () => {
    const html = renderToStaticMarkup(createElement(ChatMessages, { messages: [msg({ role: 'user', kind: 'user', content: 'где-то пять-шесть миллионов в месяц', id: 'u1' }), msg({ proposal: proposal() })] }))
    expect(html).toContain('role="log"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('role="group"')
    expect(html).toContain('Записать в анкету')
    expect(html).toContain('из вашего ответа: «где-то пять-шесть миллионов в месяц»')
    for (const b of ['Записать', 'Исправить', 'Пропустить']) expect(html).toContain(`>${b}</button>`)
  })

  it('a decided card shows its outcome, no buttons', () => {
    const html = renderToStaticMarkup(createElement(ProposalCard, { proposal: proposal({ status: 'applied' }) }))
    expect(html).toContain('Записано')
    expect(html).not.toContain('>Записать</button>')
    expect(renderToStaticMarkup(createElement(ProposalCard, { proposal: proposal({ status: 'expired' }) }))).toContain('Предложение устарело')
    expect(renderToStaticMarkup(createElement(ProposalCard, { proposal: proposal({ before: '5 000 000 ₸', beforeByStaff: true }) }))).toContain('Сейчас записано: 5 000 000 ₸ (изменил эксперт)')
  })

  it('quick actions and the escalation button', () => {
    const html = renderToStaticMarkup(createElement(QuickActions, { onAction: () => undefined, onEscalate: () => undefined }))
    for (const l of ['Не знаю', 'Примерно…', 'Объясни вопрос', 'Где взять цифру?', 'Пропустить', 'Позвать эксперта']) expect(html).toContain(l)
    expect(html).toContain('role="toolbar"')
  })

  it('the staff transcript is read-only with question labels', () => {
    const html = renderToStaticMarkup(createElement(SurveyChatTranscriptView, {
      conversations: [{ id: 'c1', title: 'Анкета · быстрый набор', createdAt: '2026-10-23T10:00:00Z', saved: 1, messages: [
        { ...msg({ proposal: proposal({ status: 'applied' }) }), keyLabel: 'Текущая выручка / месяц' },
        { ...msg({ id: 'm2', kind: 'escalate', escalate: { key: 's1_current_revenue_month', label: 'Текущая выручка / месяц', text: 'не знаю' }, buttons: [{ action: 'skip', label: 'Пропустить' }] }), keyLabel: 'Текущая выручка / месяц' },
      ] }],
    }))
    expect(html).toContain('Только чтение')
    expect(html).toContain('Текущая выручка / месяц')
    expect(html).not.toContain('<button')
    expect(renderToStaticMarkup(createElement(SurveyChatTranscriptView, { conversations: [] }))).toContain('не пользовался')
  })

  it('the side panel shows the current question and progress', () => {
    const html = renderToStaticMarkup(createElement(QuestionPanel, { question: questionDTO(SURVEY_QUESTIONS.s5_usp), progress: { minimum: { done: 3, total: 15 }, depth: { answered: 10, total: 171, percent: 6 }, savedInChat: 2 } }))
    expect(html).toContain('Чем вы лучше конкурентов (УТП)')
    expect(html).toContain('Уникальное торговое предложение')
    expect(html).toContain('Минимум для Точки А: <strong class="text-on-surface">3 из 15</strong>')
    expect(html).toContain('Записано в этой беседе: <strong class="text-on-surface">2</strong>')
  })

  it('the field helper: a dialog, the value goes to the form only after «Записать»', () => {
    const html = renderToStaticMarkup(createElement(FieldHelperPanel, { fieldKey: 's1_employee_count', onApply: () => undefined, onClose: () => undefined }))
    expect(html).toContain('role="dialog"')
    expect(html).toContain('Ответ появится в поле формы только после «Записать»')
    expect(html).toContain('Помоги ответить')
    expect(helperFormValue('s1_employee_count', '15')).toBe(15)
    expect(helperFormValue('s6_main_pain', 'текст')).toBe('текст')
    expect(helperKeyAllowed('s1_employee_count')).toBe(true)
    expect(helperKeyAllowed('s8n_metrics_table')).toBe(false)
    expect(helperKeyAllowed('s1_contact_phone')).toBe(false)
  })
})
