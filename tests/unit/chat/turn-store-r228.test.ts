/**
 * R-228 (I1): the assistant's reply is written with the SERVICE role.
 *   • saveChatTurn writes the pair only into a conversation the caller owns (re-checked with the service client);
 *   • POST /api/v1/ai/assistant and /api/v1/ai/chat no longer insert ai_messages with the user's session —
 *     with migration 141 the user's client may insert only role = 'user', so the old two-row insert would fail.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { memoryClient } from '../data-layer/memory-client'
import { saveChatTurn } from '@/lib/chat/turn-store'

const ROOT = join(__dirname, '..', '..', '..')

let mem: ReturnType<typeof memoryClient>
beforeEach(() => {
  mem = memoryClient({
    ai_conversations: [{ id: 'c-1', user_id: 'u-1', updated_at: '2026-01-01T00:00:00Z' }, { id: 'c-2', user_id: 'u-2' }],
    ai_messages: [],
  })
})

describe('saveChatTurn', () => {
  it('writes the question and the answer into the caller’s conversation and bumps updated_at', async () => {
    const ok = await saveChatTurn(mem.client as never, {
      conversationId: 'c-1', userId: 'u-1',
      messages: [{ role: 'user', content: 'Вопрос' }, { role: 'assistant', content: 'Ответ', grounding: { tools: [] } }],
    })
    expect(ok).toBe(true)
    expect(mem.db.ai_messages.map((m) => [m.conversation_id, m.role, m.content])).toEqual([['c-1', 'user', 'Вопрос'], ['c-1', 'assistant', 'Ответ']])
    expect(mem.db.ai_messages[1].grounding).toEqual({ tools: [] })
    expect(mem.db.ai_conversations[0].updated_at).not.toBe('2026-01-01T00:00:00Z')
  })

  it('someone else’s conversation → nothing written', async () => {
    const ok = await saveChatTurn(mem.client as never, { conversationId: 'c-2', userId: 'u-1', messages: [{ role: 'assistant', content: 'Подделка' }] })
    expect(ok).toBe(false)
    expect(mem.db.ai_messages).toHaveLength(0)
  })

  it('an unknown conversation → nothing written', async () => {
    expect(await saveChatTurn(mem.client as never, { conversationId: 'nope', userId: 'u-1', messages: [{ role: 'user', content: 'x' }] })).toBe(false)
    expect(mem.db.ai_messages).toHaveLength(0)
  })
})

describe('routes: no ai_messages insert with the user session', () => {
  it.each(['app/api/v1/ai/assistant/route.ts', 'app/api/v1/ai/chat/route.ts'])('%s', (file) => {
    const src = readFileSync(join(ROOT, file), 'utf8')
    expect(src).not.toMatch(/sb\s*\.from\('ai_messages'\)\s*\.insert/)
    expect(src).toMatch(/saveChatTurn\(/)
  })
})

describe('the 141 migration is in the applied set', () => {
  it('supabase/migrations/141_ai_messages_client_insert_user_only.sql exists (not pending)', () => {
    const src = readFileSync(join(ROOT, 'supabase/migrations/141_ai_messages_client_insert_user_only.sql'), 'utf8')
    expect(src).toMatch(/ai_messages_owner_insert_user/)
    expect(src).toMatch(/role = 'user'/)
  })
})

