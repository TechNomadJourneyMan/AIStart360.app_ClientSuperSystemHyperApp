export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The database fast path may wait for a short reply delay and run one job;
// the durable job stays recoverable if this invocation ends first.
export const maxDuration = 300

import { NextResponse, type NextRequest } from 'next/server'
import { runInBackground } from '@/lib/background'
import { webhookRefusal } from '@/lib/runtime/webhook-log'
import { isRateLimitedKey } from '@/lib/rate-limit'
import {
  getTelegramBotWebhookTarget,
  telegramWebhookSecretMatches,
  touchTelegramBotLastUpdate,
} from '@/lib/omnichannel/telegram-connections'
import { ingestTelegramInboxUpdate } from '@/lib/omnichannel/telegram-ingest'
import { parseTelegramInboxUpdate } from '@/lib/omnichannel/telegram-webhook'

/**
 * POST /api/webhooks/telegram-inbox/<connectionId> — updates of the inbox's
 * Telegram business bot (connected in GIGA → «Единый inbox» → Telegram).
 *
 *  - X-Telegram-Bot-Api-Secret-Token must match the per-connection secret
 *    (only its SHA-256 is stored); wrong/missing → 403 before any write.
 *  - Private-chat text, captions and media → omnichannel contact /
 *    conversation / message on channel 'telegram' → the shared processing
 *    queue (AI draft / auto / off, guardrails, lead scoring…).
 *  - Replays: update_id (audit row) and message_id (message row) dedupe.
 *  - Minimal work: one lookup, the idempotent ingest, one enqueue. Everything
 *    else (AI, sendMessage) happens in the queue worker.
 *
 * Responses never echo content. 200 acknowledges (also for ignored updates);
 * 5xx asks Telegram to retry.
 */

const MAX_BODY_BYTES = 256_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function response(status = 200): NextResponse {
  return NextResponse.json(
    { ok: status >= 200 && status < 300 },
    { status, headers: { 'cache-control': 'no-store' } },
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: { connectionId: string } },
): Promise<NextResponse> {
  // R-138: one structured line per refusal / failure; never the update or the chat.
  const refuse = webhookRefusal('webhooks/telegram-inbox', req)
  const connectionId = params?.connectionId ?? ''
  if (!UUID.test(connectionId)) return refuse(404, 'bad_connection_id', response)

  const declaredLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return refuse(413, 'body_too_large', response)

  let target: Awaited<ReturnType<typeof getTelegramBotWebhookTarget>>
  try {
    target = await getTelegramBotWebhookTarget(connectionId)
  } catch (error) {
    return refuse(503, 'target_lookup_failed', response, error)
  }
  if (!target) return refuse(404, 'unknown_connection', response)
  if (!telegramWebhookSecretMatches(target.webhookSecretHash, req.headers.get('x-telegram-bot-api-secret-token'))) {
    return refuse(403, 'bad_secret_token', response)
  }

  let raw: string
  try {
    raw = await req.text()
  } catch {
    return refuse(400, 'body_unreadable', response)
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return refuse(413, 'body_too_large', response)
  let update: unknown
  try {
    update = JSON.parse(raw) as unknown
  } catch {
    return response(200) // malformed but authenticated: acknowledge, nothing to retry
  }

  const parsed = parseTelegramInboxUpdate(update, {
    kind: 'business_bot',
    botId: target.botId,
    botUsername: target.botUsername || null,
  })
  // Groups, channels, bots, service messages: acknowledged and ignored.
  if (!parsed) return response(200)

  // Flood guard per chat (fail-open: a store outage must not drop customers).
  const limited = await isRateLimitedKey(`${target.botId}:${parsed.chatId}`, 'telegram-inbox', {
    max: 30,
    windowMs: 60_000,
    failClosed: false,
  })
  if (limited) return response(200)

  try {
    const result = await ingestTelegramInboxUpdate(parsed)
    if (result.outcome === 'in_flight') return refuse(503, 'claim_in_flight', response)
  } catch (error) {
    return refuse(500, 'ingest_failed', response, error)
  }

  void runInBackground('telegram-inbox-heartbeat', () => touchTelegramBotLastUpdate(target!))
  return response(200)
}
