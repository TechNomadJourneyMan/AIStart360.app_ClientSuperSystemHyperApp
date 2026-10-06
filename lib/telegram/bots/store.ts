/**
 * Persistence of the bots (migration 095): update dedupe per bot and the
 * per-chat conversation state of multi-step inputs.
 *
 * The state is small JSON ({ step, … }) with a short TTL; it never holds a
 * secret (an API key is read from the message, handed to the providers
 * service and the message is deleted — see admin/providers.ts).
 */
import { prisma } from '@/lib/db'
import { firstSeenUpdate } from '@/lib/telegram/staff-updates'
import type { BotId } from './registry'

/** First time this bot sees this update id? (Replays are ignored; tolerant before 095.) */
export async function firstSeenBotUpdate(bot: BotId, updateId: unknown): Promise<boolean> {
  if (bot === 'client') return firstSeenUpdate(updateId)
  if (typeof updateId !== 'number' || !Number.isSafeInteger(updateId)) return true
  try {
    const rows = await prisma.$queryRaw<Array<{ update_id: bigint }>>`
      INSERT INTO public.telegram_bot_updates_seen (bot, update_id) VALUES (${bot}, ${BigInt(updateId)})
      ON CONFLICT (bot, update_id) DO NOTHING RETURNING update_id`
    return rows.length > 0
  } catch {
    return true
  }
}

export type ConversationState = { step: string } & Record<string, unknown>

export interface StateStore {
  get(bot: BotId, chatId: string): Promise<ConversationState | null>
  set(bot: BotId, chatId: string, userId: string | null, state: ConversationState, ttlMinutes?: number): Promise<void>
  clear(bot: BotId, chatId: string): Promise<void>
}

const DEFAULT_TTL_MINUTES = 15

export const dbStateStore: StateStore = {
  async get(bot, chatId) {
    const rows = await prisma.$queryRaw<Array<{ state: ConversationState }>>`
      SELECT state FROM public.telegram_bot_state
      WHERE bot = ${bot} AND chat_id = ${chatId} AND expires_at > now()`
    const s = rows[0]?.state
    return s && typeof s === 'object' && typeof s.step === 'string' ? s : null
  },
  async set(bot, chatId, userId, state, ttlMinutes = DEFAULT_TTL_MINUTES) {
    const expires = new Date(Date.now() + Math.max(1, Math.min(ttlMinutes, 120)) * 60_000)
    await prisma.$executeRaw`
      INSERT INTO public.telegram_bot_state (bot, chat_id, user_id, state, expires_at)
      VALUES (${bot}, ${chatId}, ${userId}::uuid, ${JSON.stringify(state)}::jsonb, ${expires})
      ON CONFLICT (bot, chat_id) DO UPDATE
        SET user_id = EXCLUDED.user_id, state = EXCLUDED.state, expires_at = EXCLUDED.expires_at`
  },
  async clear(bot, chatId) {
    await prisma.$executeRaw`DELETE FROM public.telegram_bot_state WHERE bot = ${bot} AND chat_id = ${chatId}`
  },
}

/** In-memory store for tests and for running without migration 095. */
export function memoryStateStore(): StateStore & { dump(): Map<string, ConversationState> } {
  const m = new Map<string, { state: ConversationState; expires: number }>()
  const k = (bot: BotId, chatId: string) => `${bot}:${chatId}`
  return {
    async get(bot, chatId) {
      const v = m.get(k(bot, chatId))
      return v && v.expires > Date.now() ? v.state : null
    },
    async set(bot, chatId, _userId, state, ttlMinutes = DEFAULT_TTL_MINUTES) {
      m.set(k(bot, chatId), { state, expires: Date.now() + ttlMinutes * 60_000 })
    },
    async clear(bot, chatId) {
      m.delete(k(bot, chatId))
    },
    dump() {
      return new Map([...m.entries()].map(([key, v]) => [key, v.state]))
    },
  }
}

/** Housekeeping: drop expired state and old dedupe rows (called opportunistically). */
export async function purgeBotHousekeeping(): Promise<void> {
  try {
    await prisma.$executeRaw`DELETE FROM public.telegram_bot_state WHERE expires_at < now() - interval '1 day'`
    await prisma.$executeRaw`DELETE FROM public.telegram_bot_updates_seen WHERE received_at < now() - interval '7 days'`
  } catch {
    /* before 095 — nothing to purge */
  }
}
