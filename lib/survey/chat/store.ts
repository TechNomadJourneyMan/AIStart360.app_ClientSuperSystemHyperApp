/**
 * lib/survey/chat/store.ts — where the questionnaire chat lives (spec §8.8):
 * ai_conversations (surface 'survey'; the active one = the latest; «Начать
 * заново» = a new one), ai_messages (marks in `grounding`: kind, question key,
 * intent, number-guard result, scope, block), ai_pending_actions (kind
 * 'set_survey_answer', the «Записать» card). Written by the server (service
 * role) only; read back by the owner and, through the server, by the assigned
 * expert / staff with survey.view.
 *
 * The state of a conversation (scope, the current question, skipped keys, the
 * one clarification per field, the answer texts of a field) is DERIVED from
 * the message marks — no extra column, no second store of answers.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { SURVEY_BLOCK_IDS, type SurveyBlockId } from '../questions'
import { isChatScope, type AssistantKind, type ChatButton, type ChatMessageDTO, type ChatScope, type ProposalDTO } from './types'

type Db = Pick<SupabaseClient, 'from'>

export const SURVEY_SURFACE = 'survey'
export const SURVEY_PERSONA = 'survey_helper'
/** Messages read per conversation (a full questionnaire is ~500 messages). */
export const MESSAGE_LIMIT = 800
/** A card lives 24 h, like every ai_pending_actions row (116). */
export const ACTION_TTL_MS = 24 * 60 * 60 * 1000

export interface ConversationRow { id: string; user_id: string; title?: string | null; created_at?: string | null }

export interface MessageGrounding {
  kind?: AssistantKind | 'user'
  key?: string | null
  focus?: boolean
  intent?: string | null
  /** A user message that answers its question (glued into text answers). */
  answer?: boolean
  scope?: ChatScope
  block?: SurveyBlockId | null
  proposal_id?: string | null
  /** The card as shown (also for the field helper, which has no pending action). */
  proposal?: Omit<ProposalDTO, 'status' | 'expiresAt' | 'id'> | null
  guard?: { reason: string; raw?: string } | null
  buttons?: ChatButton[] | null
  link?: { href: string; label: string } | null
  escalate?: { key: string | null; label: string | null; text: string } | null
  tier?: 'light' | 'standard' | null
  masked?: boolean
}

export interface MessageRow {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  grounding?: MessageGrounding | null
  model?: string | null
  created_at: string
}

export interface ActionRow {
  id: string
  conversation_id?: string | null
  kind: string
  payload: Record<string, unknown>
  preview?: Record<string, unknown> | null
  status: ProposalDTO['status']
  expires_at?: string | null
  decided_at?: string | null
  created_at?: string | null
}

export async function loadActiveConversation(db: Db, userId: string): Promise<ConversationRow | null> {
  const { data, error } = await db.from('ai_conversations')
    .select('id, user_id, title, created_at')
    .eq('user_id', userId).eq('surface', SURVEY_SURFACE)
    .order('created_at', { ascending: false }).limit(1)
  if (error) throw new Error(error.code ?? 'conversation')
  return ((data as ConversationRow[] | null) ?? [])[0] ?? null
}

export async function listConversations(db: Db, userId: string, limit = 5): Promise<ConversationRow[]> {
  const { data, error } = await db.from('ai_conversations')
    .select('id, user_id, title, created_at')
    .eq('user_id', userId).eq('surface', SURVEY_SURFACE)
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.code ?? 'conversation')
  return (data as ConversationRow[] | null) ?? []
}

export async function createConversation(db: Db, userId: string, scope: ChatScope, at = new Date()): Promise<ConversationRow> {
  const row = {
    user_id: userId, surface: SURVEY_SURFACE, persona_id: SURVEY_PERSONA,
    title: scope === 'express' ? 'Анкета · быстрый набор' : 'Анкета · вся анкета',
    created_at: at.toISOString(), updated_at: at.toISOString(),
  }
  const { data, error } = await db.from('ai_conversations').insert(row).select('id, user_id, title, created_at').single()
  if (error || !data) throw new Error((error as { code?: string } | null)?.code ?? 'conversation_insert')
  return data as ConversationRow
}

export async function loadMessages(db: Db, conversationId: string): Promise<MessageRow[]> {
  const { data, error } = await db.from('ai_messages')
    .select('id, conversation_id, role, content, grounding, model, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true }).limit(MESSAGE_LIMIT)
  if (error) throw new Error(error.code ?? 'messages')
  return (data as MessageRow[] | null) ?? []
}

export async function loadActions(db: Db, conversationIds: string[]): Promise<ActionRow[]> {
  if (!conversationIds.length) return []
  const { data, error } = await db.from('ai_pending_actions')
    .select('id, conversation_id, kind, payload, preview, status, expires_at, decided_at, created_at')
    .in('conversation_id', conversationIds)
  if (error) throw new Error(error.code ?? 'actions')
  return ((data as ActionRow[] | null) ?? []).filter((a) => a.kind === 'set_survey_answer')
}

export interface NewMessage { role: 'user' | 'assistant'; content: string; grounding: MessageGrounding; model?: string | null }

/** Insert messages in order (explicit, increasing created_at: one turn may write several). */
export async function insertMessages(db: Db, conversationId: string, list: NewMessage[], at = new Date()): Promise<MessageRow[]> {
  if (!list.length) return []
  // Messages are ordered by created_at: never before the last one already stored
  // (two turns in the same millisecond, a card applied from another tab).
  const { data: last } = await db.from('ai_messages').select('created_at').eq('conversation_id', conversationId)
    .order('created_at', { ascending: false }).limit(1)
  const lastAt = Date.parse(String(((last as Array<{ created_at?: string }> | null) ?? [])[0]?.created_at ?? ''))
  if (Number.isFinite(lastAt) && lastAt >= at.getTime()) at = new Date(lastAt + 1)
  const rows = list.map((m, i) => ({
    conversation_id: conversationId, role: m.role, content: m.content.slice(0, 8000), grounding: m.grounding,
    model: m.model ?? null, created_at: new Date(at.getTime() + i).toISOString(),
  }))
  const { data, error } = await db.from('ai_messages').insert(rows).select('id, conversation_id, role, content, grounding, model, created_at')
  if (error) throw new Error((error as { code?: string }).code ?? 'messages_insert')
  await db.from('ai_conversations').update({ updated_at: new Date(at.getTime() + list.length).toISOString() }).eq('id', conversationId)
  const out = (data as MessageRow[] | null) ?? []
  return out.length ? out : rows.map((r, i) => ({ id: `new-${i}`, ...r }) as MessageRow)
}

export async function insertAction(db: Db, input: {
  userId: string; companyId: string | null; conversationId: string; key: string; envelope: Record<string, unknown>; preview: Record<string, unknown>
}): Promise<ActionRow | null> {
  const { data, error } = await db.from('ai_pending_actions').insert({
    user_id: input.userId, company_id: input.companyId, conversation_id: input.conversationId, kind: 'set_survey_answer',
    payload: { question_key: input.key, envelope: input.envelope, via: 'chat' }, preview: input.preview,
    status: 'pending', expires_at: new Date(Date.now() + ACTION_TTL_MS).toISOString(),
  }).select('id, conversation_id, kind, payload, preview, status, expires_at, created_at').single()
  if (error || !data) {
    console.warn('[survey-chat] card insert failed:', (error as { code?: string; message?: string } | null)?.code ?? 'no row')
    return null
  }
  return data as ActionRow
}

// ─── Derived state ───────────────────────────────────────────────────────────

export interface ChatState {
  scope: ChatScope | null
  /** The key the chat queue asked last (not the field helper). */
  currentKey: string | null
  skipped: Set<string>
  /** Keys that already got their one clarifying question since they were asked. */
  clarified: Set<string>
  formLinksShown: Set<string>
  focusBlock: SurveyBlockId | null
  /** The client's answer texts per key since the key was last asked. */
  answerTexts: Map<string, string[]>
  /** The last messages per key (model context). */
  contextOf: (key: string) => Array<{ role: 'user' | 'assistant'; content: string }>
  /** An open «Записать» card per key (pending action id). */
  lastProposalId: Map<string, string>
}

export function deriveChatState(messages: readonly MessageRow[]): ChatState {
  const state: ChatState = {
    scope: null, currentKey: null, skipped: new Set(), clarified: new Set(), formLinksShown: new Set(), focusBlock: null,
    answerTexts: new Map(), contextOf: () => [], lastProposalId: new Map(),
  }
  const ctx = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>()
  for (const m of messages) {
    const g = m.grounding ?? {}
    const key = typeof g.key === 'string' ? g.key : null
    if (g.scope && isChatScope(g.scope)) state.scope = g.scope
    if (key) {
      const list = ctx.get(key) ?? []
      list.push({ role: m.role, content: m.content })
      ctx.set(key, list.slice(-6))
    }
    if (m.role === 'user') {
      if (key && g.answer) state.answerTexts.set(key, [...(state.answerTexts.get(key) ?? []), m.content])
      continue
    }
    switch (g.kind) {
      case 'question':
        if (key) {
          state.answerTexts.set(key, [])
          state.clarified.delete(key)
          ctx.set(key, [{ role: 'assistant', content: m.content }])
          if (!g.focus) { state.currentKey = key; state.skipped.delete(key) }
        }
        break
      case 'clarify':
        if (key) state.clarified.add(key)
        break
      case 'skip':
        if (key && !g.focus) state.skipped.add(key)
        break
      case 'switch_block':
        state.focusBlock = g.block && (SURVEY_BLOCK_IDS as readonly string[]).includes(g.block) ? g.block : null
        break
      case 'form_link':
        if (g.block) state.formLinksShown.add(g.block)
        break
      case 'proposal':
        if (key && g.proposal_id) state.lastProposalId.set(key, g.proposal_id)
        break
      default:
        break
    }
  }
  state.contextOf = (key) => ctx.get(key) ?? []
  return state
}

// ─── DTO ─────────────────────────────────────────────────────────────────────

export function proposalDTO(g: MessageGrounding, actions: ReadonlyMap<string, ActionRow>): ProposalDTO | null {
  if (!g.proposal) return null
  const action = g.proposal_id ? actions.get(g.proposal_id) : undefined
  const expired = action?.status === 'pending' && action.expires_at && Date.parse(action.expires_at) < Date.now()
  return {
    ...g.proposal,
    id: g.proposal_id ?? null,
    status: action ? (expired ? 'expired' : action.status) : g.proposal_id ? 'expired' : 'pending',
    expiresAt: action?.expires_at ?? null,
  }
}

export function messagesToDTO(messages: readonly MessageRow[], actions: readonly ActionRow[]): ChatMessageDTO[] {
  const byId = new Map(actions.map((a) => [a.id, a]))
  return messages.map((m) => {
    const g = m.grounding ?? {}
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      kind: m.role === 'user' ? 'user' : (g.kind ?? 'reply'),
      key: g.key ?? null,
      focus: g.focus === true,
      proposal: m.role === 'assistant' ? proposalDTO(g, byId) : null,
      escalate: g.escalate ?? null,
      link: g.link ?? null,
      buttons: g.buttons ?? undefined,
      createdAt: m.created_at,
    }
  })
}
