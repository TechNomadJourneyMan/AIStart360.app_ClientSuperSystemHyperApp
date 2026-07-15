export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { z } from 'zod'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import { isRateLimitedKey } from '@/lib/rate-limit'
import {
  createWhatsAppWebClient,
  getWhatsAppWebBridgeConfigurationHealth,
  type WhatsAppWebControlResult,
  type WhatsAppWebSessionState,
} from '@/lib/omnichannel/whatsapp-web-client'

const actionSchema = z.object({ action: z.enum(['connect', 'logout']) }).strict()

type PublicState =
  | 'disabled'
  | 'idle'
  | 'connecting'
  | 'qr'
  | 'connected'
  | 'logged_out'
  | 'error'

function envFlag(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? '')
}
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await getGigaActor(req)
  if (!actor) return noStore({ error: 'Forbidden' }, 403)

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

  const result = await createWhatsAppWebClient().getStatus()
  return noStore({ configuration, status: await publicStatus(result) })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await getGigaActor(req)
  if (!actor) return noStore({ error: 'Forbidden' }, 403)
  if (
    actor.kind === 'break_glass'
    && !envFlag(process.env.WHATSAPP_WEB_BRIDGE_ALLOW_BREAK_GLASS_PAIRING)
  ) {
    return noStore({
      error: 'Для привязки WhatsApp войдите под личной учётной записью super_admin',
      code: 'personal_super_admin_required',
    }, 403)
  }

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

  const client = createWhatsAppWebClient()
  const idempotencyKey = `omnichannel:bridge:${parsed.data.action}:${randomUUID()}`
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
