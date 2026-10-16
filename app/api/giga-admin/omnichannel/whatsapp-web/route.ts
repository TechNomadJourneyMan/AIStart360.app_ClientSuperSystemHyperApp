export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import { isRateLimitedKey } from '@/lib/rate-limit'
import {
  createWhatsAppWebClient,
  getWhatsAppWebBridgeConfigurationHealth,
  type WhatsAppWebBridgeConfigurationHealth,
  type WhatsAppWebControlResult,
  type WhatsAppWebSessionState,
} from '@/lib/omnichannel/whatsapp-web-client'
import {
  createSupabaseBridgeControlStore,
  issueBridgeCommand,
  readBridgeControlSnapshot,
  type BridgeControlSnapshot,
} from '@/lib/omnichannel/whatsapp-bridge-control'

const actionSchema = z.object({ action: z.enum(['connect', 'logout']) }).strict()

type PublicState =
  | 'disabled'
  | 'idle'
  | 'connecting'
  | 'qr'
  | 'connected'
  | 'logged_out'
  | 'error'
  /** Pull control only: the bridge has not pushed a status for > 90 s (or ever). */
  | 'offline'

function noStore<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      'cache-control': 'no-store, max-age=0',
      pragma: 'no-cache',
    },
  })
}

function publicState(state: WhatsAppWebSessionState): PublicState {
  return state === 'disconnected' ? 'idle' : state
}

async function publicStatus(
  result: WhatsAppWebControlResult,
  stateOverride?: PublicState,
): Promise<{
  state: PublicState
  connected: boolean
  qr_data_url: string | null
  updated_at: string
  error_code: string | null
}> {
  const now = new Date().toISOString()
  if (!result.ok) {
    return {
      state: 'error',
      connected: false,
      qr_data_url: null,
      updated_at: now,
      error_code: result.code ?? 'bridge_unavailable',
    }
  }

  let qrDataUrl: string | null = null
  if (result.status.state === 'qr' && result.status.qr) {
    try {
      qrDataUrl = await QRCode.toDataURL(result.status.qr, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 320,
      })
    } catch {
      return {
        state: 'error',
        connected: false,
        qr_data_url: null,
        updated_at: now,
        error_code: 'qr_render_failed',
      }
    }
  }
  return {
    state: stateOverride ?? publicState(result.status.state),
    connected: result.status.connected,
    qr_data_url: qrDataUrl,
    updated_at: result.status.updatedAt ?? now,
    error_code: result.status.errorCode,
  }
}

// ─── Pull control (WHATSAPP_WEB_BRIDGE_CONTROL=pull) ─────────────────────────
// The bridge sits behind NAT: status comes from its last push, commands are
// recorded for the bridge to claim. See lib/omnichannel/whatsapp-bridge-control.ts.

function pullSessionId(configuration: WhatsAppWebBridgeConfigurationHealth): string | null {
  const account = configuration.accountExternalId
  return account?.startsWith('waweb:') ? account.slice('waweb:'.length) : null
}

async function pullPayload(
  configuration: WhatsAppWebBridgeConfigurationHealth,
  snapshot: BridgeControlSnapshot,
) {
  const now = new Date().toISOString()
  const { view, pendingCommand } = snapshot
  let qrDataUrl: string | null = null
  let state: PublicState = view.state === 'never_seen' || view.state === 'offline'
    ? 'offline'
    : publicState(view.state)
  let errorCode = view.state === 'never_seen' ? 'bridge_never_seen' : view.errorCode
  if (state === 'qr' && view.qr) {
    try {
      qrDataUrl = await QRCode.toDataURL(view.qr, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 320,
      })
    } catch {
      state = 'error'
      errorCode = 'qr_render_failed'
    }
  }
  return {
    configuration,
    status: {
      state,
      connected: view.connected,
      qr_data_url: qrDataUrl,
      updated_at: view.updatedAt ?? view.lastSeenAt ?? now,
      error_code: errorCode,
    },
    bridge: {
      control: 'pull' as const,
      online: view.online,
      last_seen_at: view.lastSeenAt,
      pending_command: pendingCommand
        ? {
            action: pendingCommand.action,
            status: pendingCommand.status,
            created_at: pendingCommand.createdAt,
          }
        : null,
    },
  }
}

function pullUnavailable(configuration: WhatsAppWebBridgeConfigurationHealth) {
  return {
    configuration,
    status: {
      state: 'error' as PublicState,
      connected: false,
      qr_data_url: null,
      updated_at: new Date().toISOString(),
      error_code: 'bridge_status_unavailable',
    },
    bridge: { control: 'pull' as const, online: false, last_seen_at: null, pending_command: null },
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireGiga(req, 'inbox.view')
  if (guard.response) return guard.response
  const actor = guard.actor

  const configuration = getWhatsAppWebBridgeConfigurationHealth()
  if (!configuration.enabled) {
    return noStore({
      configuration,
      status: {
        state: 'disabled',
        connected: false,
        qr_data_url: null,
        updated_at: new Date().toISOString(),
        error_code: null,
      },
    })
  }
  if (!configuration.configured) {
    return noStore({
      configuration,
      status: {
        state: 'idle',
        connected: false,
        qr_data_url: null,
        updated_at: new Date().toISOString(),
        error_code: 'bridge_not_configured',
      },
    })
  }

  if (configuration.controlMode === 'pull') {
    const sessionId = pullSessionId(configuration)
    if (!sessionId) return noStore(pullUnavailable(configuration))
    try {
      const snapshot = await readBridgeControlSnapshot(createSupabaseBridgeControlStore(), sessionId)
      return noStore(await pullPayload(configuration, snapshot))
    } catch {
      return noStore(pullUnavailable(configuration))
    }
  }

  const result = await createWhatsAppWebClient().getStatus()
  return noStore({ configuration, status: await publicStatus(result) })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireGiga(req, 'inbox.manage')
  if (guard.response) return guard.response
  const actor = guard.actor

  const parsed = actionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return noStore({ error: 'Некорректное действие' }, 400)

  const limited = await isRateLimitedKey(
    actor.id,
    `whatsapp-web-${parsed.data.action}`,
    parsed.data.action === 'connect'
      ? { max: 3, windowMs: 15 * 60_000 }
      : { max: 5, windowMs: 15 * 60_000 },
  )
  if (limited) return noStore({ error: 'Слишком много попыток. Повторите позже.' }, 429)

  const configuration = getWhatsAppWebBridgeConfigurationHealth()
  if (!configuration.configured) {
    return noStore({
      error: 'WhatsApp Web bridge выключен или не настроен',
      configuration,
    }, 409)
  }

  const idempotencyKey = `omnichannel:bridge:${parsed.data.action}:${randomUUID()}`

  if (configuration.controlMode === 'pull') {
    const sessionId = pullSessionId(configuration)
    if (!sessionId) {
      return noStore({ error: 'WhatsApp Web bridge не настроен', configuration }, 409)
    }
    const store = createSupabaseBridgeControlStore()
    let snapshot: BridgeControlSnapshot
    try {
      const issued = await issueBridgeCommand(store, {
        sessionId,
        action: parsed.data.action,
        idempotencyKey,
        requestedBy: actor.id,
      })
      if (issued.kind === 'busy') {
        return noStore({
          error: 'Bridge ещё выполняет предыдущую команду. Повторите через минуту.',
          code: 'bridge_command_in_flight',
          configuration,
        }, 409)
      }
      snapshot = await readBridgeControlSnapshot(store, sessionId)
    } catch {
      return noStore({
        error: 'Не удалось записать команду для bridge',
        code: 'bridge_command_failed',
        configuration,
      }, 503)
    }

    await logAudit({
      entityType: 'system',
      entityId: configuration.accountExternalId ?? 'waweb:unknown',
      action: parsed.data.action === 'connect'
        ? 'omnichannel.whatsapp_web_connect_requested'
        : 'omnichannel.whatsapp_web_logout_requested',
      performedBy: actor.id,
      diff: { after: { actorKind: actor.kind, action: parsed.data.action, control: 'pull' } },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })

    const payload = await pullPayload(configuration, snapshot)
    return noStore({
      ...payload,
      ...(snapshot.view.online
        ? {}
        : { warning: 'Bridge сейчас не на связи: команда подождёт его 2 минуты.' }),
    })
  }

  const client = createWhatsAppWebClient()
  const result = parsed.data.action === 'connect'
    ? await client.connect(idempotencyKey)
    : await client.logout(idempotencyKey)
  if (!result.ok) {
    const status = result.code === 'timeout' ? 504 : result.status === 429 ? 429 : 502
    return noStore({
      error: result.message,
      code: result.code ?? 'bridge_control_failed',
      configuration,
    }, status)
  }

  await logAudit({
    entityType: 'system',
    entityId: configuration.accountExternalId ?? 'waweb:unknown',
    action: parsed.data.action === 'connect'
      ? 'omnichannel.whatsapp_web_connect_requested'
      : 'omnichannel.whatsapp_web_logout_requested',
    performedBy: actor.id,
    diff: { after: { actorKind: actor.kind, action: parsed.data.action } },
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return noStore({
    configuration,
    status: await publicStatus(
      result,
      parsed.data.action === 'logout' ? 'logged_out' : undefined,
    ),
  })
}
