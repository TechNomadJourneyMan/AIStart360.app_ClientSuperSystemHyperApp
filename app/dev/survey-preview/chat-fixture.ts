/**
 * A recorded questionnaire chat for /dev/survey-preview?mode=chat (survey Ф4):
 * no database, no network, no model. The cards are built by the REAL server
 * code (lib/survey/chat/value.ts) from the client's words and a fixed model
 * answer, so they pass the same number guard as in production; the
 * transport answers the quick buttons from the registry (lib/survey/chat/ask.ts).
 */
import { askText, CHAT_HONEST_LINE, explainText, questionDTO, whereText } from '@/lib/survey/chat/ask'
import { buildProposal } from '@/lib/survey/chat/value'
import { SURVEY_QUESTIONS } from '@/lib/survey/questions'
import type { ChatMessageDTO, ChatProgressDTO, ModelTurn, ProposalDTO } from '@/lib/survey/chat/types'
import type { ChatPostData, ChatTransport, ChatViewData } from '@/components/onboarding/chat/useSurveyChat'
import type { TranscriptConversation } from '@/lib/survey/chat/transcript'

const Q = SURVEY_QUESTIONS
const T0 = Date.parse('2026-10-23T10:00:00Z')
let seq = 0
const at = () => new Date(T0 + (seq += 1) * 30_000).toISOString()

const turn = (p: Partial<ModelTurn>): ModelTurn => ({ intent: 'answer', numbers: [], options: [], bool: null, text: null, clarify: null, reply: null, block: null, ...p })

/** A card exactly as the server would build it from these words. */
export function previewProposal(key: string, words: string, model: Partial<ModelTurn>, status: ProposalDTO['status'] = 'pending'): ProposalDTO {
  const q = Q[key]
  const built = buildProposal(q, turn(model), [words])
  if (!built.ok) throw new Error(`preview card ${key}: ${built.reason}`)
  return {
    id: `preview-${key}`, key, title: q.label, display: built.proposal.display, quote: built.proposal.quote,
    note: built.proposal.note ?? null, before: null, beforeByStaff: false, envelope: built.proposal.envelope, status, expiresAt: null,
  }
}

const a = (key: string | null, content: string, extra: Partial<ChatMessageDTO> = {}): ChatMessageDTO =>
  ({ id: `m${seq + 1}`, role: 'assistant', content, kind: 'question', key, focus: false, proposal: null, createdAt: at(), ...extra })
const u = (key: string, content: string): ChatMessageDTO =>
  ({ id: `m${seq + 1}`, role: 'user', content, kind: 'user', key, focus: false, proposal: null, createdAt: at() })

/** The scenario: express scope, a select, a vague answer with one clarification, an approx card, a guard refusal, an open card. */
export function previewChatMessages(): ChatMessageDTO[] {
  seq = 0
  return [
    a(null, CHAT_HONEST_LINE, { kind: 'intro' }),
    a('s1_industry', askText(Q.s1_industry)),
    u('s1_industry', 'у нас розница, магазины одежды'),
    a('s1_industry', 'Записать в анкету?', { kind: 'proposal', proposal: previewProposal('s1_industry', 'у нас розница, магазины одежды', { options: ['Ритейл / E-commerce'] }, 'applied') }),
    a('s1_industry', 'Записано: Отрасль — Ритейл / E-commerce.', { kind: 'saved' }),
    a('s6_main_pain', askText(Q.s6_main_pain)),
    u('s6_main_pain', 'ну всякое'),
    a('s6_main_pain', 'Что мешает больше всего — люди, деньги или продажи?', { kind: 'clarify' }),
    u('s6_main_pain', 'продавцы уходят через пару месяцев, некому работать в сезон'),
    a('s6_main_pain', 'Записать в анкету?', { kind: 'proposal', proposal: previewProposal('s6_main_pain', 'продавцы уходят через пару месяцев, некому работать в сезон', {}, 'applied') }),
    a('s1_current_revenue_month', askText(Q.s1_current_revenue_month)),
    u('s1_current_revenue_month', 'где взять цифру?'),
    a('s1_current_revenue_month', whereText(Q.s1_current_revenue_month), { kind: 'where' }),
    u('s1_current_revenue_month', 'где-то пять-шесть миллионов в месяц'),
    a('s1_current_revenue_month', 'Записать в анкету?', { kind: 'proposal', proposal: previewProposal('s1_current_revenue_month', 'где-то пять-шесть миллионов в месяц', { intent: 'approx', numbers: [{ raw: 'пять', scale: null, period: null }, { raw: 'шесть', scale: 'млн', period: 'month' }] }) }),
  ]
}

export const PREVIEW_PROGRESS: ChatProgressDTO = { minimum: { done: 4, total: 15 }, depth: { answered: 9, total: 171, percent: 5 }, savedInChat: 2 }

/** An in-memory transport: the quick buttons answer from the registry, «Записать» is local. */
export function previewChatTransport(): ChatTransport {
  const current = Q.s1_current_revenue_month
  const view: ChatViewData = {
    conversationId: 'preview', scope: 'express', needsScope: false, messages: previewChatMessages(),
    question: questionDTO(current), progress: PREVIEW_PROGRESS, budget: { exhausted: false, reason: null, message: null },
  }
  const reply = (messages: ChatMessageDTO[]): ChatPostData => ({ conversationId: 'preview', scope: 'express', messages, question: questionDTO(current), progress: PREVIEW_PROGRESS, budget: view.budget })
  return {
    load: async () => view,
    post: async (body) => {
      const key = body.focusKey ?? current.key
      const q = Q[key] ?? current
      const focus = !!body.focusKey
      if (body.action === 'explain') return reply([a(key, explainText(q), { kind: 'explain', focus })])
      if (body.action === 'where') return reply([a(key, whereText(q), { kind: 'where', focus })])
      if (body.action === 'next') return reply([a(key, askText(q), { focus })])
      if (body.action === 'skip') return reply([a(key, 'Хорошо, отложим этот вопрос (превью: дальше вопросов нет).', { kind: 'skip', focus })])
      if (body.action === 'unknown') return reply([a(key, 'Записать «не знаю»?', { kind: 'proposal', focus, proposal: { ...previewProposal(key, 'не знаю', { intent: 'unknown' }), id: focus ? null : `preview-u-${key}` } })])
      if (body.message) return reply([u(key, body.message), a(key, 'В превью ИИ не вызывается — карточки выше построены сервером из слов клиента.', { kind: 'reply', focus })])
      return reply([])
    },
    decide: async (_id, body) => ({ status: body.decision === 'apply' ? 'applied' : 'rejected' }),
    escalate: async () => ({ message: 'Передал вопрос эксперту (превью — ничего не отправлено).' }),
  }
}

/** The same conversation as staff see it. */
export function previewTranscript(): TranscriptConversation[] {
  const messages = previewChatMessages().map((m) => ({ ...m, keyLabel: m.key ? Q[m.key]?.label ?? m.key : null }))
  return [{ id: 'preview', title: 'Анкета · быстрый набор', createdAt: new Date(T0).toISOString(), saved: 2, messages }]
}
