/**
 * lib/whatsapp/outbox.ts — durable, idempotent WhatsApp sender (migration 104).
 *
 *   enqueueWhatsApp     one row per idempotency key (a repeat returns the row)
 *   drainWhatsAppOutbox claim (FOR UPDATE SKIP LOCKED, SECURITY DEFINER
 *                       claim_whatsapp_outbox) → authorize (opt-in, verified
 *                       number, mute, quiet hours) → fence
 *                       (start_whatsapp_outbox_send) → send → finish
 *   applyWhatsAppOutboxStatus  Meta status webhook → delivered / read / failed
 *
 * Transport:
 *   Cloud API template message (createMetaClient().sendWhatsAppTemplate,
 *   POST /{Version}/{Phone-Number-ID}/messages, type "template"; Meta docs:
 *   https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
 *   and …/whatsapp/templates/overview). Graph version: the single constant
 *   DEFAULT_META_GRAPH_API_VERSION in lib/omnichannel/meta-client.ts. Не проверено вживую.
 *   WhatsApp Web bridge (lib/omnichannel/whatsapp-web-client.ts sendText) —
 *   staff rows only, only with WHATSAPP_WEB_BRIDGE_FALLBACK=1, when Cloud API
 *   is not configured or rejected the message permanently. The bridge
 *   deduplicates by our idempotency key ('wa-outbox:<row id>'), so retrying a
 *   bridge send is safe. Clients and experts never go through the bridge
 *   (unofficial transport).
 *
 * Outcomes: a provider error response → retry with exponential backoff up to
 * max_attempts, then failed; a permanent error → failed; a timeout or network
 * error after the fence (the request may have reached Meta) → delivery_unknown,
 * never resent automatically. A worker that dies after the fence leaves a
 * lease that the next claim turns into delivery_unknown as well.
 *
 * Phone numbers never reach logs (maskPhone) and are stripped from stored errors.
 */
import { hostname } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { inQuietHours, isLevel, routingConfig, type NotificationLevel } from '@/lib/notifications/levels'
import { createMetaClient, type MetaClientOptions, type MetaSendFailure } from '@/lib/omnichannel/meta-client'
import { createWhatsAppWebClient, getWhatsAppWebBridgeConfig, type WhatsAppWebClientOptions } from '@/lib/omnichannel/whatsapp-web-client'
import { normalizePhone } from '@/lib/crm/phone'
import { bridgeFallbackEnabled, cloudApiConfigured, maskPhone, templateLanguage, type WhatsAppEnv } from './config'
import type { TemplatePayload } from './templates'

export type RecipientKind = 'staff' | 'expert' | 'client'
export type OutboxStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'delivery_unknown' | 'skipped'

export interface EnqueueWhatsAppInput {
  /** Stable per message; repeated calls with the same key enqueue nothing new. */
  idempotencyKey: string
  kind: RecipientKind
  /** The person (whatsapp_links owner). null only for operator-configured team numbers. */
  userId: string | null
  phoneE164: string
  payload: TemplatePayload
  level?: NotificationLevel | null
  /** notification_deliveries row mirrored by the outcome. */
  deliveryId?: string | null
  maxAttempts?: number
  env?: WhatsAppEnv
}

export interface EnqueueWhatsAppResult { id: string; status: OutboxStatus; created: boolean }

const KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/
const E164_RE = /^\+[1-9][0-9]{7,14}$/

/** Map an arbitrary dedupe key onto the column's alphabet without losing uniqueness. */
export function outboxKey(...parts: Array<string | number>): string {
  const raw = parts.map(String).join(':')
  if (KEY_RE.test(raw)) return raw
  // Rewritten or too long: a readable prefix + a hash of the original keeps keys unique.
  const safe = raw.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 150).padEnd(8, '_')
  return `${safe}:${createHash('sha256').update(raw).digest('hex').slice(0, 32)}`
}

export async function enqueueWhatsApp(input: EnqueueWhatsAppInput): Promise<EnqueueWhatsAppResult> {
  if (!KEY_RE.test(input.idempotencyKey)) throw new Error('whatsapp outbox: invalid idempotency key')
  if (!E164_RE.test(input.phoneE164)) throw new Error('whatsapp outbox: phone is not E.164')
  if (input.userId === null && input.kind === 'client') throw new Error('whatsapp outbox: client rows need a user')
  const params = { body: input.payload.body, buttons: input.payload.buttons }
  // Plain-text fallback is stored only where the bridge may be used.
  const fallback = input.kind === 'staff' ? input.payload.fallbackText.slice(0, 4096) : null
  const rows = await prisma.$queryRaw<Array<{ outbox_id: string; outbox_status: OutboxStatus; created: boolean }>>`
    SELECT outbox_id::text, outbox_status, created FROM public.enqueue_whatsapp_outbox(
      ${input.idempotencyKey}, ${input.kind}, ${input.userId}::uuid, ${input.phoneE164},
      ${input.payload.template}, ${templateLanguage(input.env)}, ${JSON.stringify(params)}::jsonb,
      ${fallback}, ${input.level ?? null}, ${input.deliveryId ?? null}::uuid, ${input.maxAttempts ?? 5}::int)`
  const r = rows[0]
  if (!r) throw new Error('whatsapp outbox: enqueue returned nothing')
  return { id: r.outbox_id, status: r.outbox_status, created: r.created }
}

// ── Drain ───────────────────────────────────────────────────────────────────

interface OutboxRow {
  id: string
  recipient_kind: RecipientKind
  user_id: string | null
  phone_e164: string
  template_name: string
  template_lang: string
  params: { body?: unknown; buttons?: unknown }
  fallback_text: string | null
  level: string | null
  attempts: number
  max_attempts: number
  lease_token: string
}

export interface DrainOptions {
  /** Max rows this call claims (default 25, max 200). */
  limit?: number
  /** Only these rows (an inline "send now" right after enqueue). */
  ids?: string[]
  owner?: string
  now?: Date
  env?: WhatsAppEnv
  /** Injected for tests: Cloud API fetch / env. */
  meta?: MetaClientOptions
  /** Injected for tests: bridge fetch / env. */
  bridge?: WhatsAppWebClientOptions
  leaseSeconds?: number
  /** Stop claiming new rows after this many ms (default 30 000). */
  budgetMs?: number
}

/** Rows claimed per round: a short lease never covers rows still waiting their turn. */
const CLAIM_BATCH = 5

export interface DrainResult {
  claimed: number
  sent: number
  retried: number
  deferred: number
  failed: number
  unknown: number
  skipped: number
  viaBridge: number
}

type Decision = { ok: true } | { ok: false; skip: string } | { ok: false; deferSeconds: number }

/** Team numbers configured by the operator (WHATSAPP_EXPERTS_TO), normalized to E.164. */
export function operatorExpertNumbers(env: WhatsAppEnv = process.env): string[] {
  return (env.WHATSAPP_EXPERTS_TO ?? '')
    .split(/[,;\s]+/)
    .map((s) => normalizePhone(s).e164)
    .filter((p): p is string => Boolean(p))
}

async function authorize(row: OutboxRow, now: Date, env: WhatsAppEnv): Promise<Decision> {
  if (row.template_name === 'phone_verification') {
    if (!row.user_id) return { ok: false, skip: 'verification_without_user' }
    const v = await prisma.$queryRaw<Array<{ pending_phone_e164: string | null; verify_expires_at: Date | null }>>`
      SELECT pending_phone_e164, verify_expires_at FROM public.whatsapp_links
      WHERE user_id = ${row.user_id}::uuid AND recipient_kind = ${row.recipient_kind}`
    const l = v[0]
    if (!l || l.pending_phone_e164 !== row.phone_e164 || !l.verify_expires_at || l.verify_expires_at <= now) {
      return { ok: false, skip: 'verification_expired' }
    }
    return { ok: true }
  }

  if (!row.user_id) {
    // Only operator-configured expert numbers may have no person behind them.
    return row.recipient_kind === 'expert' && operatorExpertNumbers(env).includes(row.phone_e164)
      ? { ok: true }
      : { ok: false, skip: 'recipient_not_configured' }
  }

  const links = await prisma.$queryRaw<Array<{ phone_e164: string | null; verified_at: Date | null; opt_in_at: Date | null; opt_out_at: Date | null; muted_until: Date | null }>>`
    SELECT phone_e164, verified_at, opt_in_at, opt_out_at, muted_until FROM public.whatsapp_links
    WHERE user_id = ${row.user_id}::uuid AND recipient_kind = ${row.recipient_kind}`
  const l = links[0]
  if (!l || !l.opt_in_at || l.opt_out_at || !l.verified_at) return { ok: false, skip: 'not_opted_in' }
  if (l.phone_e164 !== row.phone_e164) return { ok: false, skip: 'phone_changed' }
  const level = isLevel(row.level) ? row.level : null
  const urgent = level === 'CRITICAL' || level === 'APPROVAL_REQUIRED'
  if (l.muted_until && l.muted_until > now && !urgent) return { ok: false, skip: 'muted' }
  if (level && row.recipient_kind !== 'client' && inQuietHours(level, routingConfig(), now)) {
    return { ok: false, deferSeconds: 30 * 60 }
  }
  return { ok: true }
}

function backoffSeconds(attempts: number, status: number | null): number {
  const base = status === 429 ? 120 : 30
  return Math.min(3600, base * 2 ** Math.max(0, attempts - 1))
}

/** Provider messages may echo a number; keep stored errors phone-free. */
function safeError(f: Pick<MetaSendFailure, 'code' | 'message' | 'status'>): string {
  const text = `${f.code ?? 'error'}${f.status ? ` (HTTP ${f.status})` : ''}: ${f.message}`
  return text.replace(/\+?\d[\d\s()-]{7,18}\d/g, '[phone]').slice(0, 300)
}

type SendOutcome =
  | { outcome: 'sent'; providerMessageId: string }
  | { outcome: 'retry' | 'failed' | 'delivery_unknown'; error: string; status: number | null }

/** Classify a Cloud API / bridge failure. `idempotentTransport`: a retry cannot duplicate (bridge key). */
export function classifyFailure(f: MetaSendFailure, idempotentTransport: boolean): SendOutcome {
  const error = safeError(f)
  const ambiguous = f.status === null && (f.code === 'timeout' || f.code === 'network_error') && f.requestSent !== false
  if (ambiguous) return idempotentTransport ? { outcome: 'retry', error, status: null } : { outcome: 'delivery_unknown', error, status: null }
  if (f.requestSent === false && f.code === 'network_error') return { outcome: 'retry', error, status: null }
  return { outcome: f.retryable ? 'retry' : 'failed', error, status: f.status }
}

async function finish(row: OutboxRow, outcome: 'sent' | 'retry' | 'defer' | 'failed' | 'delivery_unknown' | 'skipped', extra: {
  providerMessageId?: string | null; error?: string | null; retryAfter?: number; transport?: 'cloud_api' | 'web_bridge' | null
} = {}): Promise<OutboxStatus | null> {
  const rows = await prisma.$queryRaw<Array<{ accepted: boolean; outbox_status: OutboxStatus | null }>>`
    SELECT accepted, outbox_status FROM public.finish_whatsapp_outbox(
      ${row.id}::uuid, ${row.lease_token}::uuid, ${outcome}, ${extra.providerMessageId ?? null},
      ${extra.error ?? null}, ${Math.max(1, Math.min(86_400, Math.round(extra.retryAfter ?? 60)))}::int, ${extra.transport ?? null})`
  return rows[0]?.accepted ? rows[0].outbox_status : null
}

async function fence(row: OutboxRow, transport: 'cloud_api' | 'web_bridge'): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT public.start_whatsapp_outbox_send(${row.id}::uuid, ${row.lease_token}::uuid, ${transport}) AS ok`
  return rows[0]?.ok === true
}

function bodyParams(row: OutboxRow): string[] {
  return Array.isArray(row.params?.body) ? row.params.body.map((v) => String(v)) : []
}

function buttonParams(row: OutboxRow): Array<{ index: number; text: string }> {
  if (!Array.isArray(row.params?.buttons)) return []
  return row.params.buttons
    .map((b) => (b && typeof b === 'object' ? (b as { index?: unknown; text?: unknown }) : null))
    .filter((b): b is { index: number; text: string } => !!b && typeof b.index === 'number' && typeof b.text === 'string')
}

async function sendViaBridge(row: OutboxRow, opts: DrainOptions, env: WhatsAppEnv): Promise<SendOutcome> {
  const config = getWhatsAppWebBridgeConfig(opts.bridge?.env ?? env)
  if (!config || !row.fallback_text) return { outcome: 'failed', error: 'bridge_not_configured', status: null }
  const client = createWhatsAppWebClient({ ...opts.bridge, env: opts.bridge?.env ?? env })
  const res = await client.sendText({
    recipientId: `${row.phone_e164.slice(1)}@s.whatsapp.net`,
    text: row.fallback_text,
    accountExternalId: config.accountExternalId,
    idempotencyKey: `wa-outbox:${row.id}`,
  })
  if (res.ok) return { outcome: 'sent', providerMessageId: res.externalMessageId }
  return classifyFailure(res, true)
}

async function processRow(row: OutboxRow, opts: DrainOptions, env: WhatsAppEnv, now: Date, out: DrainResult): Promise<void> {
  const decision = await authorize(row, now, env)
  if (!decision.ok) {
    if ('deferSeconds' in decision) {
      if (await finish(row, 'defer', { retryAfter: decision.deferSeconds, error: 'quiet_hours' })) out.deferred += 1
    } else if (await finish(row, 'skipped', { error: decision.skip })) {
      out.skipped += 1
    }
    return
  }

  const metaEnv = opts.meta?.env ?? env
  const cloud = cloudApiConfigured(metaEnv)
  const bridgeAllowed = row.recipient_kind === 'staff' && bridgeFallbackEnabled(opts.bridge?.env ?? env)

  if (!cloud && !bridgeAllowed) {
    if (await finish(row, 'failed', { error: 'not_configured' })) out.failed += 1
    return
  }

  let result: SendOutcome
  let transport: 'cloud_api' | 'web_bridge' = cloud ? 'cloud_api' : 'web_bridge'
  if (!(await fence(row, transport))) return // lease lost: another worker / the reaper owns it now

  if (cloud) {
    const client = createMetaClient({ ...opts.meta, env: metaEnv })
    const res = await client.sendWhatsAppTemplate({
      recipientId: row.phone_e164.slice(1),
      templateName: row.template_name,
      languageCode: row.template_lang,
      bodyParameters: bodyParams(row),
      buttonParameters: buttonParams(row),
    })
    result = res.ok ? { outcome: 'sent', providerMessageId: res.externalMessageId } : classifyFailure(res, false)
    // Permanent Cloud API refusal for a staff alert → the bridge, if allowed.
    if (result.outcome === 'failed' && bridgeAllowed) {
      transport = 'web_bridge'
      result = await sendViaBridge(row, opts, env)
      if (result.outcome === 'sent') out.viaBridge += 1
    }
  } else {
    result = await sendViaBridge(row, opts, env)
    if (result.outcome === 'sent') out.viaBridge += 1
  }

  if (result.outcome === 'sent') {
    if (await finish(row, 'sent', { providerMessageId: result.providerMessageId, transport })) out.sent += 1
    return
  }
  const status = await finish(row, result.outcome, {
    error: result.error,
    retryAfter: backoffSeconds(row.attempts, result.status),
    transport,
  })
  if (!status) return
  if (status === 'queued') out.retried += 1
  else if (status === 'delivery_unknown') out.unknown += 1
  else out.failed += 1
  console.warn('[whatsapp/outbox]', row.id, maskPhone(row.phone_e164), status, result.error.slice(0, 120))
}

/**
 * Claim and send due rows, in small batches, until `limit` rows or the time
 * budget is used up (rows are claimed only when there is time to send them).
 * Never throws for a single row's failure; a database error propagates.
 */
export async function drainWhatsAppOutbox(opts: DrainOptions = {}): Promise<DrainResult> {
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date()
  const limit = Math.max(1, Math.min(200, opts.limit ?? 25))
  const deadline = Date.now() + Math.max(1_000, opts.budgetMs ?? 30_000)
  const owner = (opts.owner ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`).slice(0, 200)
  const ids = opts.ids && opts.ids.length > 0 ? opts.ids : null
  const out: DrainResult = { claimed: 0, sent: 0, retried: 0, deferred: 0, failed: 0, unknown: 0, skipped: 0, viaBridge: 0 }
  while (out.claimed < limit && Date.now() < deadline) {
    const batch = Math.min(CLAIM_BATCH, limit - out.claimed)
    const rows = await prisma.$queryRaw<OutboxRow[]>`
      SELECT id::text, recipient_kind, user_id::text, phone_e164, template_name, template_lang, params,
             fallback_text, level, attempts::int, max_attempts::int, lease_token::text
      FROM public.claim_whatsapp_outbox(${owner}, ${batch}::int, ${opts.leaseSeconds ?? 120}::int, ${ids}::uuid[])`
    out.claimed += rows.length
    for (const row of rows) {
      try {
        await processRow(row, opts, env, now, out)
      } catch (err) {
        // The lease expires and the reaper decides (queued before the fence, unknown after).
        console.error('[whatsapp/outbox] row failed', row.id, err instanceof Error ? err.message.split('\n')[0] : 'error')
      }
    }
    if (rows.length < batch) break
  }
  return out
}

/** Fire-and-forget "send now" after an enqueue; the cron drain is the safety net. */
export async function sendWhatsAppNow(ids: string[], opts: Omit<DrainOptions, 'ids'> = {}): Promise<DrainResult | null> {
  if (ids.length === 0) return null
  try {
    return await drainWhatsAppOutbox({ ...opts, ids, limit: Math.min(200, ids.length) })
  } catch (err) {
    console.error('[whatsapp/outbox] inline send failed:', err instanceof Error ? err.message.split('\n')[0] : 'error')
    return null
  }
}

// ── Status webhook ──────────────────────────────────────────────────────────

export interface OutboxStatusUpdate {
  providerMessageId: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  occurredAt: string | null
  errorCode?: string | null
}

export async function applyWhatsAppOutboxStatus(u: OutboxStatusUpdate): Promise<{ matched: boolean; status: OutboxStatus | null }> {
  const at = u.occurredAt && Number.isFinite(Date.parse(u.occurredAt)) ? new Date(u.occurredAt) : null
  const rows = await prisma.$queryRaw<Array<{ matched: boolean; outbox_status: OutboxStatus | null }>>`
    SELECT matched, outbox_status FROM public.apply_whatsapp_outbox_status(
      ${u.providerMessageId}, ${u.status}, ${at}::timestamptz, ${u.errorCode ?? null})`
  return { matched: rows[0]?.matched === true, status: rows[0]?.outbox_status ?? null }
}
