/**
 * lib/survey/chat/transcript.ts — the questionnaire chat as the expert sees it
 * (spec §8.8, §10): read-only, every conversation of the client (latest first),
 * the cards with their outcome (записано / пропущено / устарело), the field
 * helper turns marked with their field, escalations. The caller has already
 * checked the access (GIGA survey.view + client scope, or the assigned expert);
 * this reads with the service client.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { surveyQuestion } from '../questions'
import { listConversations, loadActions, loadMessages, messagesToDTO } from './store'
import type { ChatMessageDTO } from './types'

export interface TranscriptConversation {
  id: string
  title: string | null
  createdAt: string | null
  messages: Array<ChatMessageDTO & { keyLabel: string | null }>
  /** Cards applied in this conversation. */
  saved: number
}

export async function loadSurveyChatTranscript(db: Pick<SupabaseClient, 'from'>, userId: string, limit = 5): Promise<TranscriptConversation[]> {
  const conversations = await listConversations(db, userId, limit)
  if (!conversations.length) return []
  const actions = await loadActions(db, conversations.map((c) => c.id))
  const out: TranscriptConversation[] = []
  for (const c of conversations) {
    const messages = await loadMessages(db, c.id)
    const own = actions.filter((a) => a.conversation_id === c.id)
    out.push({
      id: c.id,
      title: c.title ?? null,
      createdAt: c.created_at ?? null,
      messages: messagesToDTO(messages, own).map((m) => ({ ...m, buttons: undefined, keyLabel: m.key ? surveyQuestion(m.key)?.label ?? m.key : null })),
      saved: own.filter((a) => a.status === 'applied').length,
    })
  }
  return out
}
