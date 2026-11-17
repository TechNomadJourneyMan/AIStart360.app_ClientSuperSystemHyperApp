/**
 * R4 (R-024; PO, Round 4): the cabinet «Сообщения» says WHO answers — «команда
 * AIStart360», not «эксперт» (no approved experts on production) — and WHEN only
 * when it is really promised: an open client request ('case') under the SLA whose
 * deadline has not passed (GET /api/v1/expert-sla). Otherwise the common text, no date.
 * The bot's hand-over texts in the same conversation say the same.
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { TEAM_REPLY_ANSWERED, TEAM_REPLY_COMMON, TEAM_REPLY_WHO, messagesReplyNote, slaTasksFromResponse } from '@/lib/comm/reply-note'

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: async () => {} }) }))

const NOW = new Date('2026-11-16T09:00:00Z')
const task = (over: Partial<{ source: string; answerDueAt: string; overdue: boolean; inProgress: boolean; receivedAt: string | null }> = {}) => ({
  source: 'case', answerDueAt: '2026-11-18T09:00:00Z', overdue: false, inProgress: false, receivedAt: '2026-11-16T08:00:00Z', ...over,
})
const msg = (direction: 'in' | 'out', authorKind: string, createdAt: string) => ({ direction, authorKind, createdAt })

describe('messagesReplyNote', () => {
  it('an open request under the SLA → «Ответим до <срок>» (Almaty time), the earliest one', () => {
    const n = messagesReplyNote([task({ answerDueAt: '2026-11-19T09:00:00Z' }), task()], NOW)
    expect(n.who).toBe('Ответит команда AIStart360')
    expect(n.text).toBe('Ваше обращение получено. Ответим до 18 ноября, 14:00.')
    expect(n.dueAt).toBe('2026-11-18T09:00:00.000Z')
    expect(messagesReplyNote([task({ inProgress: true })], NOW).text).toBe('Ваше обращение уже в работе. Ответим до 18 ноября, 14:00.')
  })

  it('no task, SLA off (empty list), a failed read, an overdue task, other kinds of work → the common text without a date', () => {
    const common = { who: TEAM_REPLY_WHO, text: TEAM_REPLY_COMMON, dueAt: null, state: 'common' }
    expect(messagesReplyNote(null, NOW)).toEqual(common)
    expect(messagesReplyNote([], NOW)).toEqual(common)
    expect(messagesReplyNote([task({ overdue: true })], NOW)).toEqual(common)
    expect(messagesReplyNote([task({ answerDueAt: '2026-11-16T08:00:00Z' })], NOW)).toEqual(common)
    expect(messagesReplyNote([task({ source: 'plan_prep' }), task({ source: 'pa_ai_review' }), task({ source: 'plan_review' })], NOW)).toEqual(common)
    expect(messagesReplyNote([task({ answerDueAt: 'garbage' })], NOW)).toEqual(common)
    expect(TEAM_REPLY_COMMON).not.toMatch(/\d/)
  })

  // W3B-6: a staff reply in the conversation does not close the request (expert_cases), the task stays open.
  it('the team already answered after the last question (and after the request) → no deadline, an honest line', () => {
    const answered = { who: TEAM_REPLY_WHO, text: TEAM_REPLY_ANSWERED, dueAt: null, state: 'answered' }
    const asked = msg('in', 'user', '2026-11-16T08:00:00Z')
    // staff answered after the question → the deadline is gone
    expect(messagesReplyNote([task()], NOW, [asked, msg('out', 'staff', '2026-11-16T08:30:00Z')])).toEqual(answered)
    // the bot hand-over and a broadcast are not an answer
    expect(messagesReplyNote([task()], NOW, [asked, msg('out', 'bot', '2026-11-16T08:01:00Z'), msg('out', 'system', '2026-11-16T08:40:00Z')]).state).toBe('due')
    // the client asked again after the answer → the deadline is back
    expect(messagesReplyNote([task()], NOW, [asked, msg('out', 'staff', '2026-11-16T08:30:00Z'), msg('in', 'user', '2026-11-16T08:50:00Z')]).state).toBe('due')
    // an old staff message before a NEW request (e.g. an assistant escalation) does not count
    expect(messagesReplyNote([task({ receivedAt: '2026-11-16T08:45:00Z' })], NOW, [asked, msg('out', 'staff', '2026-11-16T08:30:00Z')]).state).toBe('due')
    // no request at all, but the team answered the last question → also said honestly
    expect(messagesReplyNote([], NOW, [asked, msg('out', 'staff', '2026-11-16T08:30:00Z')])).toEqual(answered)
    // a staff message without any question from the client is not «answered your question»
    expect(messagesReplyNote([], NOW, [msg('out', 'staff', '2026-11-16T08:30:00Z')]).state).toBe('common')
    expect(TEAM_REPLY_ANSWERED).not.toMatch(/\d/)
  })

  it('the API body → tasks; anything malformed → none', () => {
    expect(slaTasksFromResponse({ ok: true, data: [{ id: 'x', source: 'case', answerDueAt: '2026-11-18T09:00:00Z', overdue: false, inProgress: true, label: 'Обращение клиента', receivedAt: '2026-11-16T08:00:00Z' }] }))
      .toEqual([{ source: 'case', answerDueAt: '2026-11-18T09:00:00Z', overdue: false, inProgress: true, receivedAt: '2026-11-16T08:00:00Z' }])
    expect(slaTasksFromResponse({ ok: false, error: 'Unauthorized' })).toEqual([])
    expect(slaTasksFromResponse(null)).toEqual([])
    expect(slaTasksFromResponse({ data: [{ source: 1 }, null, 'x'] })).toEqual([])
  })
})

describe('«Сообщения» on screen', () => {
  it('the team, not «эксперт»: header, the reply note, the input', async () => {
    const { default: ClientMessages } = await import('@/components/client/messages/ClientMessages')
    const out = renderToStaticMarkup(React.createElement(ClientMessages))
    expect(out).toContain('Переписка с командой AIStart360')
    expect(out).toContain('Ответит команда AIStart360')
    expect(out).toContain(TEAM_REPLY_COMMON)
    expect(out).toContain('placeholder="Напишите ваш вопрос…"')
    expect(out).not.toMatch(/[Ээ]ксперт/)
  })

  it('the empty conversation promises the team, not an expert', () => {
    const src = readFileSync('components/client/messages/ClientMessages.tsx', 'utf8')
    expect(src).toContain('Здесь будет ваша переписка с командой AIStart360')
    expect(src).toContain('Задайте вопрос — ответит команда AIStart360, здесь же.')
    expect(src).not.toMatch(/эксперт ответит|Напишите эксперту|с экспертом</)
  })

  it('the deadline is shown only from the client SLA endpoint', async () => {
    const { ReplyNote } = await import('@/components/client/messages/ClientMessages')
    const out = renderToStaticMarkup(React.createElement(ReplyNote, { note: messagesReplyNote([task()], NOW) }))
    expect(out).toContain('Ответим до 18 ноября, 14:00.')
    expect(out).toContain('data-reply-due="2026-11-18T09:00:00.000Z"')
    const src = readFileSync('components/client/messages/ClientMessages.tsx', 'utf8')
    expect(src).toContain("fetch('/api/v1/expert-sla'")
    expect(src).toContain('<ReplyNote note={messagesReplyNote(slaTasks, new Date(), messages)} />')
    const answered = renderToStaticMarkup(React.createElement(ReplyNote, { note: messagesReplyNote([task()], NOW, [msg('in', 'user', '2026-11-16T08:00:00Z'), msg('out', 'staff', '2026-11-16T08:30:00Z')]) }))
    expect(answered).toContain(TEAM_REPLY_ANSWERED)
    expect(answered).toContain('data-reply-state="answered"')
    expect(answered).not.toContain('Ответим до')
  })
})

describe('the bot in the same conversation', () => {
  it('hands over to the team AIStart360, not to «эксперт»; the SLA promise says the same', async () => {
    const { HANDOFF_TEXT, CASE_TEXT, CASE_REUSED_TEXT, caseQueuedText } = await import('@/lib/comm/bot-rules')
    const { clientPromiseText } = await import('@/lib/expert-sla/policy')
    for (const t of [HANDOFF_TEXT, CASE_TEXT, CASE_REUSED_TEXT, caseQueuedText(clientPromiseText(48))]) {
      expect(t).toMatch(/[Кк]оманд/)
      expect(t).not.toMatch(/[Ээ]ксперт/)
    }
    expect(clientPromiseText(48)).toBe('Команда AIStart360 ответит в течение 48 часов.')
  })
})
