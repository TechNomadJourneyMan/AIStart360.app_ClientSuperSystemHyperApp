/**
 * Webhook front door shared by /api/telegram/admin and /api/telegram/expert.
 *
 *   • fail closed: without the bot's token AND webhook secret nothing is
 *     processed (503);
 *   • X-Telegram-Bot-Api-Secret-Token compared in constant time (401 on
 *     mismatch — the only non-200 Telegram ever sees from a configured bot);
 *   • update_id dedupe per bot (replays are acknowledged and dropped);
 *   • handler errors are logged and acknowledged with 200, so Telegram does
 *     not retry the same update forever.
 */
import { timingSafeEqual } from 'node:crypto'
import { handleUpdate, type BotDeps, type Outcome, type Router, type TgUpdate } from './dispatcher'
import { botToken, botWebhookSecret, type BotId } from './registry'
import { firstSeenBotUpdate } from './store'

export function secretMatches(expected: string, got: string | null): boolean {
  if (!got) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(got)
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface WebhookResult {
  status: number
  outcome: Outcome | 'not_configured' | 'bad_secret' | 'bad_json' | 'duplicate'
}

export async function processWebhook<P>(args: {
  bot: BotId
  headers: Headers
  body: () => Promise<unknown>
  router: () => Router<P>
  deps: BotDeps
  seen?: (bot: BotId, updateId: unknown) => Promise<boolean>
}): Promise<WebhookResult> {
  const secret = botWebhookSecret(args.bot)
  if (!secret || !botToken(args.bot)) return { status: 503, outcome: 'not_configured' }
  if (!secretMatches(secret, args.headers.get('x-telegram-bot-api-secret-token'))) return { status: 401, outcome: 'bad_secret' }

  let update: TgUpdate | null
  try {
    update = (await args.body()) as TgUpdate | null
  } catch {
    return { status: 200, outcome: 'bad_json' }
  }
  if (!update || typeof update !== 'object') return { status: 200, outcome: 'bad_json' }
  if (!(await (args.seen ?? firstSeenBotUpdate)(args.bot, update.update_id))) return { status: 200, outcome: 'duplicate' }

  try {
    return { status: 200, outcome: await handleUpdate(args.router(), update, args.deps) }
  } catch (err) {
    console.error(`[telegram/${args.bot}] update failed:`, err instanceof Error ? err.message.split('\n')[0] : err)
    return { status: 200, outcome: 'error' }
  }
}
