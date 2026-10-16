export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import { isEncryptionConfigured } from '@/lib/crypto/secrets'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { botToken, botUsernameOf, botWebhookSecret } from '@/lib/telegram/bots/registry'
import { isClientBotInboxEnabled } from '@/lib/omnichannel/telegram-client-bot'
import {
  getTelegramBotConnection,
  resolveTelegramInboxWebhookOrigin,
  toPublicTelegramBotConnection,
} from '@/lib/omnichannel/telegram-connections'
import {
  connectTelegramInboxBot,
  disconnectTelegramInboxBot,
  verifyTelegramInboxBotWebhook,
} from '@/lib/omnichannel/telegram-bot-service'

/**
 * GIGA → «Единый inbox» → Telegram.
 *   GET            status: business bot (@username, webhook, last update) and
 *                  the platform client bot source. `?verify=1` asks Telegram
 *                  (getWebhookInfo) and refreshes the webhook flag.
 *   POST {token}   connect the business bot (BotFather token).
 *   DELETE         disconnect it (deleteWebhook + remove the stored token).
 * The token is accepted once and never returned.
 */

const connectSchema = z.object({ token: z.string().trim().min(10).max(200) }).strict()

function noStore<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache' },
  })
}

function clientBotStatus() {
  const configured = Boolean(botToken('client') && botWebhookSecret('client'))
  return {
    configured,
    username: botUsernameOf('client'),
    inbox_enabled: configured && isClientBotInboxEnabled(),
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireGiga(req, 'inbox.view')
  if (guard.response) return guard.response

  const verify = req.nextUrl.searchParams.get('verify') === '1'
  try {
    const connection = verify
      ? await verifyTelegramInboxBotWebhook(resolveTelegramInboxWebhookOrigin(req.headers, req.url))
      : await getTelegramBotConnection()
    return noStore({
      connection: toPublicTelegramBotConnection(connection),
      encryption_configured: isEncryptionConfigured(),
      client_bot: clientBotStatus(),
    })
  } catch {
    return noStore({
      connection: null,
      encryption_configured: isEncryptionConfigured(),
      client_bot: clientBotStatus(),
      error: 'Не удалось загрузить подключение Telegram (применена ли миграция 124?)',
    }, 500)
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireGiga(req, 'inbox.manage')
  if (guard.response) return guard.response
  const actor = guard.actor

  const parsed = connectSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return noStore({ error: 'Вставьте токен бота из @BotFather' }, 400)

  if (await isRateLimitedKey(actor.id, 'telegram-inbox-connect', { max: 5, windowMs: 15 * 60_000 })) {
    return noStore({ error: 'Слишком много попыток. Повторите позже.' }, 429)
  }

  const result = await connectTelegramInboxBot({
    token: parsed.data.token,
    webhookOrigin: resolveTelegramInboxWebhookOrigin(req.headers, req.url),
    actorId: actor.id,
  })
  if (!result.ok) return noStore({ error: result.message, code: result.code }, result.status)

  await logAudit({
    entityType: 'system',
    entityId: `omnichannel:telegram:${result.connection.botId}`,
    action: 'omnichannel.telegram_bot_connected',
    performedBy: actor.id,
    diff: { after: { bot_username: result.connection.botUsername, actorKind: actor.kind } },
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  })
  return noStore({
    connection: toPublicTelegramBotConnection(result.connection),
    encryption_configured: true,
    client_bot: clientBotStatus(),
  })
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const guard = await requireGiga(req, 'inbox.manage')
  if (guard.response) return guard.response
  const actor = guard.actor

  const result = await disconnectTelegramInboxBot()
  if (!result.ok) return noStore({ error: result.message }, result.status)

  if (result.botUsername) {
    await logAudit({
      entityType: 'system',
      entityId: 'omnichannel:telegram',
      action: 'omnichannel.telegram_bot_disconnected',
      performedBy: actor.id,
      diff: { after: { bot_username: result.botUsername, webhook_deleted: result.webhookDeleted, actorKind: actor.kind } },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })
  }
  return noStore({
    connection: null,
    webhook_deleted: result.webhookDeleted,
    encryption_configured: isEncryptionConfigured(),
    client_bot: clientBotStatus(),
  })
}
