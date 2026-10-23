/**
 * lib/survey/chat/types.ts — shared shapes of the questionnaire AI helper
 * (spec 2026-10-23 §8, phase Ф4). Pure and browser-safe: the chat UI, the
 * server turn loop and the staff transcript read the same types.
 */
import type { SurveyBlockId } from '../questions'

/** What the chat walks through: the express set or the whole questionnaire (PO §18.3 item 1). */
export const CHAT_SCOPES = ['express', 'full'] as const
export type ChatScope = (typeof CHAT_SCOPES)[number]

export function isChatScope(v: unknown): v is ChatScope {
  return typeof v === 'string' && (CHAT_SCOPES as readonly string[]).includes(v)
}

/** The model only names the intent of the client's turn (spec §8.2). */
export const CHAT_INTENTS = ['answer', 'unknown', 'approx', 'vague', 'question', 'switch_block', 'skip', 'escalate', 'off_topic'] as const
export type ChatIntent = (typeof CHAT_INTENTS)[number]

/** Quick buttons above the input; none of them calls the model. */
export const CHAT_QUICK_ACTIONS = ['explain', 'where', 'skip', 'unknown'] as const
export type ChatQuickAction = (typeof CHAT_QUICK_ACTIONS)[number]

/**
 * What an assistant message is (ai_messages.grounding.kind) — the state of the
 * conversation is derived from these marks, there is no extra column.
 */
export type AssistantKind =
  | 'intro'          // the honest first line + the scope question
  | 'question'       // the server asks a registry question
  | 'proposal'       // a «Записать в анкету» card
  | 'clarify'        // the one clarifying question of a field
  | 'vague_buttons'  // second vague answer → «примерно / не знаю / пропустить»
  | 'explain'        // «Объясни вопрос» (registry)
  | 'where'          // «Где взять цифру?» (registry)
  | 'reply'          // an answer to the client's question (model, number-checked)
  | 'skip'           // the question is put aside in this conversation
  | 'switch_block'   // the queue jumps to a block
  | 'escalate'       // «Передать вопрос эксперту?» card
  | 'escalated'      // the question went to «Сообщения»
  | 'off_topic'      // back to the questionnaire
  | 'guard_blocked'  // a number not in the client's words → no card
  | 'form_link'      // tables / files: «удобнее в форме»
  | 'not_understood' // the model failed twice
  | 'unavailable'    // AI error / timeout
  | 'budget'         // the AI budget is spent
  | 'done'           // nothing left to ask in this scope
  | 'saved'          // «Записано» after the card was applied

/** One literal number as the model saw it in the client's words. */
export interface NumberLiteral {
  raw: string
  scale: 'тыс' | 'млн' | 'млрд' | null
  period: 'month' | 'year' | null
}

/** The model's answer for one client turn (validated by model.ts). */
export interface ModelTurn {
  intent: ChatIntent
  numbers: NumberLiteral[]
  options: string[]
  bool: boolean | null
  text: string | null
  clarify: string | null
  reply: string | null
  block: string | null
}

/** A value the server built from the client's words, shown on the card. */
export interface BuiltProposal {
  key: string
  /** The stored envelope (`{ value }`, «не знаю», «примерно»). */
  envelope: Record<string, unknown>
  /** The value as the card shows it: «≈ 5 500 000 ₸ (5 000 000 – 6 000 000 ₸)». */
  display: string
  /** The client's words the value comes from. */
  quote: string
  /** A server conversion the client should see: «пересчитал: 66 млн в год ÷ 12». */
  note?: string
}

/** The card as the client gets it (DB row → DTO). */
export interface ProposalDTO {
  /** ai_pending_actions.id; null for the field helper (the value goes into the form). */
  id: string | null
  key: string
  title: string
  display: string
  quote: string
  note: string | null
  before: string | null
  /** The stored answer was changed by an expert / admin. */
  beforeByStaff: boolean
  envelope: Record<string, unknown>
  status: 'pending' | 'applying' | 'applied' | 'rejected' | 'expired' | 'failed'
  expiresAt: string | null
}

export interface ChatMessageDTO {
  id: string
  role: 'user' | 'assistant'
  content: string
  kind: AssistantKind | 'user'
  /** The question the message is about. */
  key: string | null
  /** The field helper (focus) rather than the chat queue. */
  focus: boolean
  proposal: ProposalDTO | null
  /** Escalation card: the text that would go to the expert. */
  escalate?: { key: string | null; label: string | null; text: string } | null
  /** «Удобнее в форме» link. */
  link?: { href: string; label: string } | null
  /** Buttons the client may press next. */
  buttons?: ChatButton[]
  createdAt: string
}

export type ChatButton =
  | { action: 'approx'; label: string }
  | { action: 'unknown'; label: string }
  | { action: 'skip'; label: string }
  | { action: 'next'; label: string }
  | { action: 'start'; scope: ChatScope; label: string }
  | { action: 'mode'; href: string; label: string }

/** The current question as the side panel shows it. */
export interface ChatQuestionDTO {
  key: string
  label: string
  plain: string | null
  why: string | null
  term: { name: string; text: string } | null
  step: number
  block: SurveyBlockId | 'express'
  type: string
  unit: string | null
  options: Array<{ value: string; label: string }> | null
  allowUnknown: boolean
  allowApprox: boolean
}

export interface ChatProgressDTO {
  minimum: { done: number; total: number }
  depth: { answered: number; total: number; percent: number }
  /** Cards applied in this conversation. */
  savedInChat: number
}

export interface ChatBudgetDTO {
  exhausted: boolean
  reason: 'cap' | 'daily' | null
  message: string | null
}
