/**
 * lib/chat/turn-store.ts — writes one chat turn (the question + the assistant's answer) to ai_messages
 * with the SERVICE role (R-228).
 *
 * Migration 141 lets the owner of a conversation insert only role = 'user' (a client could forge «AI said …»
 * history that is fed back to the model). The assistant's reply is therefore written by the server. Before
 * the write the conversation's owner is checked again with the service client — the caller's id must own
 * it — so a forged conversation id never gets a message, whatever the route resolved before.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

type Db = Pick<SupabaseClient, 'from'>

export interface TurnMessage {
  role: 'user' | 'assistant'
  content: string
  created_at?: string
  grounding?: unknown
  validation?: unknown
}

/** true — written; false — the conversation is not the user's (nothing written) or a write failed. */
export async function saveChatTurn(
  service: Db,
  input: { conversationId: string; userId: string; messages: TurnMessage[] },
): Promise<boolean> {
  const { data: conv, error: convError } = await service
    .from('ai_conversations')
    .select('id')
    .eq('id', input.conversationId)
    .eq('user_id', input.userId)
    .maybeSingle()
  if (convError || !conv) {
    if (convError) console.error('[chat/turn-store] conversation not checked', convError.code ?? '')
    return false
  }
  const rows = input.messages.map((m) => {
    const row: Record<string, unknown> = { conversation_id: input.conversationId, role: m.role, content: m.content }
    if (m.created_at !== undefined) row.created_at = m.created_at
    if (m.grounding !== undefined) row.grounding = m.grounding
    if (m.validation !== undefined) row.validation = m.validation
    return row
  })
  const { error } = await service.from('ai_messages').insert(rows)
  if (error) {
    console.error('[chat/turn-store] messages not saved', error.code ?? '')
    return false
  }
  await service.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', input.conversationId)
  return true
}
