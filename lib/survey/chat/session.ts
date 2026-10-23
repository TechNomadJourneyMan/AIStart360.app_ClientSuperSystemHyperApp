/**
 * lib/survey/chat/session.ts — the server side of GET / POST
 * /api/v1/survey/chat (spec §8.2, §12): load the conversation, derive its
 * state, run one client turn (lib/survey/chat/turn.ts), store the messages and
 * the card, ask the next question. The database client (service role) and the
 * model are passed in; the route does auth, limits and the budget.
 *
 * Nothing here writes survey_answers: the card is an ai_pending_actions row
 * (the chat) or an inline proposal the browser puts into the form field (the
 * field helper). The answers are written only by «Записать»
 * (lib/survey/chat/apply.ts) or by the form's own save.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { maskProfanity } from '@/lib/moderation/profanity'
import { fromAnswerEnvelope } from '../answer-value'
import { pointAMinimum, surveyDepth } from '../progress'
import { SURVEY_QUESTIONS, surveyBlock, type SurveyBlockId, type SurveyQuestion } from '../questions'
import { isWizardVisibleKey } from '../steps'
import { askText, CHAT_HONEST_LINE, formatChatValue, questionDTO } from './ask'
import type { SurveyLlm } from './model'
import { isAnsweredForChat, nextChatStep } from './next'
import {
  createConversation, deriveChatState, insertAction, insertMessages, loadActions, loadActiveConversation, loadMessages,
  messagesToDTO, type ActionRow, type ChatState, type ConversationRow, type MessageGrounding, type NewMessage,
} from './store'
import { runTurn, type TurnOutcome } from './turn'
import type { ChatBudgetDTO, ChatButton, ChatMessageDTO, ChatProgressDTO, ChatQuestionDTO, ChatQuickAction, ChatScope } from './types'

type Db = Pick<SupabaseClient, 'from'>

export interface StoredAnswer { value: unknown; byStaff: boolean }

export async function loadChatAnswers(db: Db, userId: string): Promise<Map<string, StoredAnswer>> {
  const { data, error } = await db.from('survey_answers').select('question_key, answer, updated_by_role').eq('user_id', userId)
  if (error) throw new Error((error as { code?: string }).code ?? 'answers')
  const out = new Map<string, StoredAnswer>()
  for (const r of (data ?? []) as Array<{ question_key: string; answer: unknown; updated_by_role?: string | null }>) {
    if (!isWizardVisibleKey(String(r.question_key))) continue
    out.set(r.question_key, { value: fromAnswerEnvelope(r.answer), byStaff: r.updated_by_role === 'expert' || r.updated_by_role === 'admin' })
  }
  return out
}

const flat = (answers: ReadonlyMap<string, StoredAnswer>): Record<string, unknown> =>
  Object.fromEntries(Array.from(answers, ([k, a]) => [k, a.value]))

export function chatProgress(answers: ReadonlyMap<string, StoredAnswer>, actions: readonly ActionRow[]): ChatProgressDTO {
  const f = flat(answers)
  const min = pointAMinimum(f)
  return { minimum: { done: min.answered, total: min.total }, depth: surveyDepth(f), savedInChat: actions.filter((a) => a.status === 'applied').length }
}

export interface ChatView {
  conversationId: string | null
  scope: ChatScope | null
  /** No conversation yet (or no scope): the chat asks «быстрый набор или вся анкета». */
  needsScope: boolean
  messages: ChatMessageDTO[]
  question: ChatQuestionDTO | null
  progress: ChatProgressDTO
  budget: ChatBudgetDTO
}

/** The current question of the chat queue (the one asked last, if it is still open). */
function currentQuestion(state: ChatState, answers: ReadonlyMap<string, StoredAnswer>): SurveyQuestion | null {
  const key = state.currentKey
  if (!key) return null
  const q = SURVEY_QUESTIONS[key]
  if (!q || state.skipped.has(key) || isAnsweredForChat(answers.get(key)?.value)) return null
  return q
}

export async function loadChatView(db: Db, userId: string, budget: ChatBudgetDTO): Promise<ChatView> {
  const [answers, conversation] = await Promise.all([loadChatAnswers(db, userId), loadActiveConversation(db, userId)])
  if (!conversation) return { conversationId: null, scope: null, needsScope: true, messages: [], question: null, progress: chatProgress(answers, []), budget }
  const [messages, actions] = await Promise.all([loadMessages(db, conversation.id), loadActions(db, [conversation.id])])
  const state = deriveChatState(messages)
  const q = currentQuestion(state, answers)
  return {
    conversationId: conversation.id,
    scope: state.scope,
    needsScope: state.scope === null,
    messages: messagesToDTO(messages, actions),
    question: q ? questionDTO(q) : null,
    progress: chatProgress(answers, actions),
    budget,
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────

export type ChatPostAction = ChatQuickAction | 'approx' | 'start' | 'restart' | 'next'

export interface ChatPostInput {
  message?: string | null
  action?: ChatPostAction | null
  scope?: ChatScope | null
  /** The field helper: the turn is about this key; the card goes into the form. */
  focusKey?: string | null
}

export interface ChatPostDeps {
  db: Db
  userId: string
  /** null → the model is not available (budget spent / helper switched off). */
  llm: SurveyLlm | null
  budget: ChatBudgetDTO
  now?: Date
  /** Server events (SURVEY_CHAT_PROPOSAL / _GUARD_BLOCKED); never awaited by the caller's UX. */
  track?: (name: 'SURVEY_CHAT_PROPOSAL' | 'SURVEY_CHAT_GUARD_BLOCKED', metadata: Record<string, unknown>) => void
}

export type ChatPostResult =
  | { ok: true; conversationId: string; messages: ChatMessageDTO[]; question: ChatQuestionDTO | null; progress: ChatProgressDTO; budget: ChatBudgetDTO; scope: ChatScope | null }
  | { ok: false; status: 400 | 404 | 500; error: string }

const ACTION_LABEL: Record<string, string> = {
  explain: 'Объясни вопрос', where: 'Где взять цифру?', skip: 'Пропустить', unknown: 'Не знаю', approx: 'Примерно…',
}

const MODE_BUTTONS: ChatButton[] = [
  { action: 'mode', href: '/client/onboarding/express', label: 'Быстрый старт' },
  { action: 'mode', href: '/client/onboarding?step=1', label: 'Полная анкета' },
]

/** The next registry question (or a link to the form for tables, or «всё»), as messages. */
export function nextQuestionMessages(state: ChatState, answers: ReadonlyMap<string, StoredAnswer>, opts: { focusBlock?: SurveyBlockId | null } = {}): { messages: NewMessage[]; question: SurveyQuestion | null } {
  const scope = state.scope ?? 'express'
  const linked = new Set(state.formLinksShown)
  const out: NewMessage[] = []
  for (let guard = 0; guard < 20; guard += 1) {
    const step = nextChatStep({ answers: flat(answers), scope, skipped: state.skipped, formLinksShown: linked, focusBlock: opts.focusBlock ?? state.focusBlock })
    if (step.kind === 'question') {
      const q = step.question
      out.push({ role: 'assistant', content: askText(q), grounding: { kind: 'question', key: q.key, block: step.block === 'express' ? null : step.block } })
      return { messages: out, question: q }
    }
    if (step.kind === 'form_link') {
      linked.add(step.block)
      const labels = step.keys.map((k) => SURVEY_QUESTIONS[k]?.label ?? k).join(', ')
      out.push({
        role: 'assistant',
        content: `Эти вопросы удобнее заполнить в форме: ${labels}. Откройте их, когда будет удобно, — а мы продолжим здесь.`,
        grounding: { kind: 'form_link', block: step.block === 'express' ? null : step.block, link: { href: `/client/onboarding?step=${step.step}`, label: 'Открыть в анкете' } },
      })
      continue
    }
    out.push(scope === 'express'
      ? { role: 'assistant', content: 'Быстрый набор пройден — спасибо! По этим ответам уже можно посчитать первичную Точку А. Продолжим со всей анкетой?', grounding: { kind: 'done', buttons: [{ action: 'start', scope: 'full', label: 'Продолжить всю анкету' }, { action: 'mode', href: '/client/onboarding/answers', label: 'Мои ответы' }] } }
      : { role: 'assistant', content: 'Все вопросы, которые удобно пройти в беседе, пройдены. Остальное — таблицы и файлы — в форме. Проверить ответы можно в «Мои ответы».', grounding: { kind: 'done', buttons: [{ action: 'mode', href: '/client/onboarding/answers', label: 'Мои ответы' }] } })
    return { messages: out, question: null }
  }
  return { messages: out, question: null }
}

function storedLine(q: SurveyQuestion, a: StoredAnswer | undefined): { stored: string | null; byStaff: boolean } {
  if (!a || !isAnsweredForChat(a.value)) return { stored: null, byStaff: false }
  return { stored: formatChatValue(q, a.value), byStaff: a.byStaff }
}

export async function chatPost(deps: ChatPostDeps, input: ChatPostInput): Promise<ChatPostResult> {
  const { db, userId } = deps
  const now = deps.now ?? new Date()
  const focus = input.focusKey ? SURVEY_QUESTIONS[input.focusKey] ?? null : null
  if (input.focusKey && (!focus || focus.chat !== 'ask')) return { ok: false, status: 400, error: 'Помощник недоступен для этого вопроса' }
  const message = (input.message ?? '').trim()

  const answers = await loadChatAnswers(db, userId)
  let conversation: ConversationRow | null = await loadActiveConversation(db, userId)
  const toWrite: NewMessage[] = []

  // Start / restart: a new conversation with the honest first line.
  if (input.action === 'restart' || (!conversation && (input.action === 'start' || message || focus))) {
    conversation = await createConversation(db, userId, input.scope ?? (focus ? 'full' : 'express'), now)
    toWrite.push({ role: 'assistant', content: CHAT_HONEST_LINE, grounding: { kind: 'intro', ...(input.scope || !focus ? { scope: input.scope ?? 'express' } : {}), focus: !!focus } })
  }
  if (!conversation) return { ok: false, status: 400, error: 'Выберите, с чего начать беседу' }

  const existing = await loadMessages(db, conversation.id)
  // A scope chosen in an existing conversation («Продолжить всю анкету»).
  if (input.action === 'start' && input.scope && !toWrite.length) {
    toWrite.push({ role: 'assistant', content: input.scope === 'full' ? 'Продолжаем всю анкету.' : 'Пройдём быстрый набор.', grounding: { kind: 'intro', scope: input.scope } })
  }
  let state = deriveChatState([...existing, ...toWrite.map((m, i) => ({ id: `pending-${i}`, conversation_id: conversation!.id, role: m.role, content: m.content, grounding: m.grounding, created_at: now.toISOString() }))])
  let asked: SurveyQuestion | null = null

  const queueNext = (focusBlock?: SurveyBlockId | null) => {
    const next = nextQuestionMessages(state, answers, { focusBlock })
    toWrite.push(...next.messages)
    asked = next.question
  }

  // The field helper opens on its question: ask it (with what is stored now).
  if (focus && (input.action === 'next' || (!message && !input.action))) {
    const s = storedLine(focus, answers.get(focus.key))
    toWrite.push({ role: 'assistant', content: askText(focus, { stored: s.stored, storedByStaff: s.byStaff ? 'эксперт' : null }), grounding: { kind: 'question', key: focus.key, focus: true } })
    asked = focus
    return finish()
  }

  const q = focus ?? currentQuestion(state, answers)
  if (!q || input.action === 'next' || input.action === 'start' || input.action === 'restart') {
    if (!message && !(input.action && ['explain', 'where', 'skip', 'unknown', 'approx'].includes(input.action))) {
      if (state.scope === null && !focus) return finish()
      queueNext()
      return finish()
    }
  }
  const question = q ?? (() => { queueNext(); return asked })()
  if (!question) return finish()

  // One turn about `question`.
  const quick = input.action && ['explain', 'where', 'skip', 'unknown', 'approx'].includes(input.action) ? (input.action as ChatQuickAction | 'approx') : null
  const outcome: TurnOutcome = await runTurn({
    question,
    message,
    action: quick,
    earlierAnswers: state.answerTexts.get(question.key) ?? [],
    context: state.contextOf(question.key),
    clarifyUsed: state.clarified.has(question.key),
    llm: deps.llm,
  })
  const isFocus = !!focus
  const userContent = message ? maskProfanity(message) : quick ? ACTION_LABEL[quick] : ''
  if (userContent) {
    toWrite.push({ role: 'user', content: userContent, grounding: { kind: 'user', key: question.key, focus: isFocus, answer: outcome.answerText, intent: outcome.intent } })
  }
  const g: MessageGrounding = { kind: outcome.kind, key: question.key, focus: isFocus, intent: outcome.intent, tier: outcome.tier, masked: outcome.masked }
  if (outcome.guard) {
    g.guard = outcome.guard
    deps.track?.('SURVEY_CHAT_GUARD_BLOCKED', { key: question.key, reason: outcome.guard.reason })
  }
  if (outcome.buttons) g.buttons = outcome.buttons
  if (outcome.kind === 'budget') g.buttons = MODE_BUTTONS
  if (outcome.kind === 'unavailable') g.buttons = MODE_BUTTONS
  if (outcome.kind === 'escalate') g.escalate = { key: question.key, label: question.label, text: message || state.answerTexts.get(question.key)?.slice(-1)[0] || '' }

  if (outcome.kind === 'proposal' && outcome.proposal) {
    const p = outcome.proposal
    const before = storedLine(question, answers.get(question.key))
    const shown = { key: p.key, title: question.label, display: p.display, quote: p.quote, note: p.note ?? null, before: before.stored, beforeByStaff: before.byStaff, envelope: p.envelope }
    g.proposal = shown
    if (!isFocus) {
      const companyId = await companyOf(db, userId)
      const action = await insertAction(db, {
        userId, companyId, conversationId: conversation.id, key: p.key, envelope: p.envelope,
        preview: { title: question.label, after: p.display, before: before.stored, before_by_staff: before.byStaff, note: p.note ?? null, quote: p.quote },
      })
      if (!action) {
        toWrite.push({ role: 'assistant', content: 'Не получилось подготовить запись. Ответ можно ввести в форме — всё сохранится.', grounding: { kind: 'unavailable', key: question.key, buttons: MODE_BUTTONS } })
        return finish()
      }
      g.proposal_id = action.id
    }
    deps.track?.('SURVEY_CHAT_PROPOSAL', { key: p.key, outcome: 'shown', helper: isFocus })
  }
  if (outcome.kind === 'switch_block' && outcome.block) g.block = outcome.block
  const text = outcome.kind === 'budget' && deps.budget.message ? `${deps.budget.message}` : outcome.text
  toWrite.push({ role: 'assistant', content: text, grounding: g })

  // After a skip / a jump the chat moves on (the field helper stays on its field).
  if (!isFocus && (outcome.kind === 'skip' || outcome.kind === 'switch_block')) {
    state = deriveChatState([...existing, ...toWrite.map((m, i) => ({ id: `p${i}`, conversation_id: conversation!.id, role: m.role, content: m.content, grounding: m.grounding, created_at: now.toISOString() }))])
    queueNext(outcome.kind === 'switch_block' ? outcome.block ?? null : undefined)
  }
  if (!asked && !isFocus) asked = question
  if (isFocus) asked = question
  return finish()

  async function finish(): Promise<ChatPostResult> {
    const written = await insertMessages(db, conversation!.id, toWrite, now)
    const actions = await loadActions(db, [conversation!.id])
    const finalState = deriveChatState([...existing, ...written])
    const shownQuestion = asked ?? currentQuestion(finalState, answers)
    return {
      ok: true,
      conversationId: conversation!.id,
      scope: finalState.scope,
      messages: messagesToDTO(written, actions),
      question: shownQuestion ? questionDTO(shownQuestion) : null,
      progress: chatProgress(answers, actions),
      budget: deps.budget,
    }
  }
}

async function companyOf(db: Db, userId: string): Promise<string | null> {
  try {
    const { data } = await db.from('companies').select('id').eq('user_id', userId).maybeSingle()
    const id = (data as { id?: unknown } | null)?.id
    return id != null ? String(id) : null
  } catch {
    return null
  }
}

/** For the escalation: the label of the question the client asks about. */
export function questionLabel(key: string | null | undefined): string | null {
  if (!key) return null
  return SURVEY_QUESTIONS[key]?.label ?? surveyBlock(key)?.title ?? null
}
