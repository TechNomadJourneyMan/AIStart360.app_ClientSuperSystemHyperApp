/**
 * Survey Ф5 — from an answer «через ИИ-помощника» to the place in the chat
 * (spec §5.4, §10, §16 Ф5): which message is the source, the button only at
 * chat / helper answers and only for staff, the transcript marks the message.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { anchorNote, findAnswerMessage, transcriptMessageId } from '@/lib/survey/chat/transcript-anchor'
import { SurveyAnswersView, answerFromChat } from '@/components/onboarding/answers/SurveyAnswersView'
import { SurveyChatTranscriptView } from '@/components/onboarding/chat/SurveyChatTranscript'
import type { ChatMessageDTO, ProposalDTO } from '@/lib/survey/chat/types'
import type { AnswerAttribution } from '@/lib/survey/attribution-label'

const KEY = 's1_current_revenue_month'
const proposal = (over: Partial<ProposalDTO> = {}): ProposalDTO => ({
  id: 'a1', key: KEY, title: 'Текущая выручка / месяц', display: '5 000 000 ₸', quote: 'пять миллионов', note: null, before: null,
  beforeByStaff: false, envelope: { value: 5_000_000 }, status: 'applied', expiresAt: null, ...over,
})
const msg = (over: Partial<ChatMessageDTO>): ChatMessageDTO => ({
  id: 'm', role: 'assistant', content: '…', kind: 'question', key: KEY, focus: false, proposal: null, createdAt: '2026-10-23T10:00:00Z', ...over,
})

describe('findAnswerMessage', () => {
  const conversations = [
    { id: 'c2', messages: [
      msg({ id: 'q2', createdAt: '2026-10-25T10:00:00Z' }),
      msg({ id: 'h1', focus: true, kind: 'proposal', proposal: proposal({ id: null, status: 'pending' }), createdAt: '2026-10-25T10:01:00Z' }),
    ] },
    { id: 'c1', messages: [
      msg({ id: 'q1', createdAt: '2026-10-23T10:00:00Z' }),
      msg({ id: 'p-old', kind: 'proposal', proposal: proposal(), createdAt: '2026-10-23T10:01:00Z' }),
      msg({ id: 'p-new', kind: 'proposal', proposal: proposal(), createdAt: '2026-10-23T10:05:00Z' }),
      msg({ id: 'p-rej', kind: 'proposal', proposal: proposal({ status: 'rejected' }), createdAt: '2026-10-23T10:09:00Z' }),
    ] },
  ]

  it('the newest applied card wins over newer helper turns and mentions', () => {
    expect(findAnswerMessage(conversations, KEY)).toEqual({ conversationId: 'c1', messageId: 'p-new', kind: 'applied' })
  })

  it('no applied card → the field-helper card; nothing applied or helper → the newest mention', () => {
    const noApplied = conversations.map((c) => ({ ...c, messages: c.messages.filter((m) => m.proposal?.status !== 'applied') }))
    expect(findAnswerMessage(noApplied, KEY)).toEqual({ conversationId: 'c2', messageId: 'h1', kind: 'helper' })
    const mentions = noApplied.map((c) => ({ ...c, messages: c.messages.filter((m) => !m.focus) }))
    expect(findAnswerMessage(mentions, KEY)).toEqual({ conversationId: 'c2', messageId: 'q2', kind: 'mention' })
  })

  it('unknown key / no key → null; notes are honest', () => {
    expect(findAnswerMessage(conversations, 's2_other')).toBeNull()
    expect(findAnswerMessage(conversations, null)).toBeNull()
    expect(anchorNote(null, 'Выручка')).toContain('не найдено')
    expect(anchorNote({ conversationId: 'c', messageId: 'm', kind: 'applied' }, 'Выручка')).toBe('Отмечено сообщение, из которого записан ответ «Выручка».')
    expect(anchorNote({ conversationId: 'c', messageId: 'm', kind: 'helper' }, 'Выручка')).toContain('«Помощник» у поля')
    expect(transcriptMessageId('abc')).toBe('survey-chat-msg-abc')
  })
})

describe('«Открыть беседу» at an answer', () => {
  const OWNER = '11111111-1111-4111-8111-111111111111'
  const AT = '2026-10-22T09:00:00.000Z'
  const answers = { s1_company_name: 'ТОО Альфа', s12_crm_tool: 'amocrm', s3_deal_cycle_days: 30 }
  const attribution: Record<string, AnswerAttribution> = {
    s1_company_name: { updatedBy: OWNER, updatedByRole: 'user', updatedAt: AT, updatedByName: null, updatedVia: 'chat' },
    s12_crm_tool: { updatedBy: OWNER, updatedByRole: 'user', updatedAt: AT, updatedByName: null, updatedVia: 'helper' },
    s3_deal_cycle_days: { updatedBy: OWNER, updatedByRole: 'user', updatedAt: AT, updatedByName: null, updatedVia: 'full' },
  }
  const render = (over: Record<string, unknown>) => renderToStaticMarkup(createElement(SurveyAnswersView, {
    answers, attribution, viewer: { ownerName: 'Аскар' }, mode: 'staff', canEdit: false, onOpenChat: () => undefined, ...over,
  } as never))

  it('staff: at chat and helper answers only', () => {
    const html = render({})
    expect(html).toContain('aria-label="Открыть беседу: ')
    expect(html.match(/aria-label="Открыть беседу: /g)).toHaveLength(2)
  })

  it('the client never sees it; staff without a transcript handler neither', () => {
    expect(render({ mode: 'client', viewer: { viewerIsOwner: true } })).not.toContain('Открыть беседу')
    expect(render({ onOpenChat: undefined })).not.toContain('Открыть беседу')
  })

  it('answerFromChat: an empty answer has no source', () => {
    expect(answerFromChat({ filled: true, attribution: attribution.s1_company_name })).toBe(true)
    expect(answerFromChat({ filled: false, attribution: attribution.s1_company_name })).toBe(false)
    expect(answerFromChat({ filled: true, attribution: attribution.s3_deal_cycle_days })).toBe(false)
  })

  it('the transcript opened from an answer marks the source message and says so', () => {
    const html = renderToStaticMarkup(createElement(SurveyChatTranscriptView, {
      focusKey: KEY,
      conversations: [{ id: 'c1', title: 'Анкета', createdAt: '2026-10-23T10:00:00Z', saved: 1, messages: [
        { ...msg({ id: 'q1' }), keyLabel: 'Текущая выручка / месяц' },
        { ...msg({ id: 'p1', kind: 'proposal', proposal: proposal() }), keyLabel: 'Текущая выручка / месяц' },
      ] }],
    }))
    expect(html).toContain('id="survey-chat-msg-q1"')
    expect(html).toMatch(/id="survey-chat-msg-p1" aria-current="true"/)
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
    expect(html).toContain('Отмечено сообщение, из которого записан ответ')
  })

  it('without a focus nothing is marked', () => {
    const html = renderToStaticMarkup(createElement(SurveyChatTranscriptView, {
      conversations: [{ id: 'c1', title: null, createdAt: null, saved: 0, messages: [{ ...msg({ id: 'q1' }), keyLabel: null }] }],
    }))
    expect(html).not.toContain('aria-current')
    expect(html).not.toContain('role="status"')
  })
})
