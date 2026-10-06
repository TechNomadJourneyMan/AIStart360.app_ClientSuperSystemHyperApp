/**
 * lib/whatsapp/links.ts — a person's WhatsApp number per audience (104 whatsapp_links).
 *
 * Linking: the person enters a number (normalizePhone → E.164) and agrees to
 * receive notifications → we send the phone_verification template with a
 * 6-digit code (only an HMAC of it is stored; 10 min TTL; 5 wrong tries burn
 * the code) → the person types the code → number verified + opt-in recorded.
 * Opt-out any time (the verified number is kept, so opting in again needs no
 * new code); «Удалить номер» forgets it.
 *
 * Rate limits (lib/rate-limit, fail-closed buckets):
 *   whatsapp-verify-send     3 codes / 10 min per person
 *   whatsapp-verify-phone    5 codes / 24 h per number (no SMS-bombing a stranger)
 *   whatsapp-verify-confirm  10 tries / 10 min per person
 */
import { createHmac, randomInt } from 'node:crypto'
import { prisma } from '@/lib/db'
import { normalizePhone } from '@/lib/crm/phone'
import { checkRateLimit } from '@/lib/rate-limit'
import type { OrderedLevel } from '@/lib/notifications/levels'
import { maskPhone, verifySecret, whatsappTransportAvailable, type WhatsAppEnv } from './config'
import { enqueueWhatsApp, outboxKey, sendWhatsAppNow, type DrainOptions, type RecipientKind } from './outbox'
import { phoneVerificationTemplate } from './templates'

export const VERIFY_TTL_MINUTES = 10
export const VERIFY_MAX_ATTEMPTS = 5
export const VERIFY_LIMITS = {
  send: { bucket: 'whatsapp-verify-send', max: 3, windowMs: 10 * 60_000 },
  phone: { bucket: 'whatsapp-verify-phone', max: 5, windowMs: 24 * 60 * 60_000 },
  confirm: { bucket: 'whatsapp-verify-confirm', max: 10, windowMs: 10 * 60_000 },
} as const

const DEFAULT_MIN_LEVEL: Record<RecipientKind, OrderedLevel> = { staff: 'WARNING', expert: 'INFO', client: 'INFO' }

export interface LinkStatus {
  kind: RecipientKind
  /** The person's own verified number (shown only to them). */
  phone: string | null
  verified: boolean
  optedIn: boolean
  minLevel: OrderedLevel
  mutedUntil: string | null
  pending: { phoneMasked: string; expiresAt: string } | null
  /** WhatsApp can actually send for this audience on this deployment. */
  available: boolean
  /** Prefill for clients: profiles.phone normalized to E.164. */
  suggestedPhone: string | null
}

interface LinkRow {
  phone_e164: string | null
  verified_at: Date | null
  opt_in_at: Date | null
  opt_out_at: Date | null
  min_level: OrderedLevel
  muted_until: Date | null
  pending_phone_e164: string | null
  verify_expires_at: Date | null
}

async function readLink(userId: string, kind: RecipientKind): Promise<LinkRow | null> {
  const rows = await prisma.$queryRaw<LinkRow[]>`
    SELECT phone_e164, verified_at, opt_in_at, opt_out_at, min_level, muted_until, pending_phone_e164, verify_expires_at
    FROM public.whatsapp_links WHERE user_id = ${userId}::uuid AND recipient_kind = ${kind}`
  return rows[0] ?? null
}

async function profilePhone(userId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ phone: string | null }>>`SELECT phone FROM public.profiles WHERE id = ${userId}::uuid`
  return rows[0]?.phone ? normalizePhone(rows[0].phone).e164 : null
}

export async function getLinkStatus(userId: string, kind: RecipientKind, opts: { now?: Date; env?: WhatsAppEnv } = {}): Promise<LinkStatus> {
  const now = opts.now ?? new Date()
  const l = await readLink(userId, kind)
  const pendingLive = l?.pending_phone_e164 && l.verify_expires_at && l.verify_expires_at > now
  return {
    kind,
    phone: l?.verified_at ? l.phone_e164 : null,
    verified: Boolean(l?.verified_at),
    optedIn: Boolean(l?.opt_in_at && !l.opt_out_at && l.verified_at),
    minLevel: l?.min_level ?? DEFAULT_MIN_LEVEL[kind],
    mutedUntil: l?.muted_until && l.muted_until > now ? l.muted_until.toISOString() : null,
    pending: pendingLive ? { phoneMasked: maskPhone(l!.pending_phone_e164), expiresAt: l!.verify_expires_at!.toISOString() } : null,
    available: whatsappTransportAvailable(kind, opts.env),
    suggestedPhone: kind === 'client' ? await profilePhone(userId) : null,
  }
}

function codeHash(secret: string, userId: string, kind: RecipientKind, phone: string, code: string): string {
  return createHmac('sha256', secret).update(`wa-verify:v1:${userId}:${kind}:${phone}:${code}`).digest('hex')
}

export type StartResult =
  | { ok: true; expiresAt: string; phoneMasked: string; delivery: 'sent' | 'queued' | 'unknown' }
  | { ok: false; code: 'invalid_phone' | 'consent_required' | 'not_configured' | 'rate_limited' | 'send_failed'; retryAfterSeconds?: number }

export interface StartOptions extends Pick<DrainOptions, 'meta' | 'bridge'> {
  now?: Date
  env?: WhatsAppEnv
}

export async function startVerification(userId: string, kind: RecipientKind, rawPhone: string, consent: boolean, opts: StartOptions = {}): Promise<StartResult> {
  if (!consent) return { ok: false, code: 'consent_required' }
  const phone = normalizePhone(rawPhone).e164
  if (!phone) return { ok: false, code: 'invalid_phone' }
  const env = opts.env ?? process.env
  const secret = verifySecret(env)
  if (!secret || !whatsappTransportAvailable(kind, env)) return { ok: false, code: 'not_configured' }

  for (const [identifier, l] of [[`${userId}`, VERIFY_LIMITS.send], [phone, VERIFY_LIMITS.phone]] as const) {
    const rl = await checkRateLimit(identifier, l.bucket, { max: l.max, windowMs: l.windowMs })
    if (rl.limited) return { ok: false, code: 'rate_limited', retryAfterSeconds: rl.retryAfterSeconds }
  }

  const now = opts.now ?? new Date()
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const hash = codeHash(secret, userId, kind, phone, code)
  const expires = new Date(now.getTime() + VERIFY_TTL_MINUTES * 60_000)
  await prisma.$executeRaw`
    INSERT INTO public.whatsapp_links (user_id, recipient_kind, pending_phone_e164, verify_code_hash, verify_expires_at, verify_attempts, verify_sent_at, min_level)
    VALUES (${userId}::uuid, ${kind}, ${phone}, ${hash}, ${expires}, 0, ${now}, ${DEFAULT_MIN_LEVEL[kind]})
    ON CONFLICT (user_id, recipient_kind) DO UPDATE
      SET pending_phone_e164 = EXCLUDED.pending_phone_e164, verify_code_hash = EXCLUDED.verify_code_hash,
          verify_expires_at = EXCLUDED.verify_expires_at, verify_attempts = 0, verify_sent_at = EXCLUDED.verify_sent_at`

  const row = await enqueueWhatsApp({
    idempotencyKey: outboxKey('verify', kind, userId, hash.slice(0, 16)),
    kind,
    userId,
    phoneE164: phone,
    payload: phoneVerificationTemplate(code),
    maxAttempts: 2,
    env,
  })
  const res = await sendWhatsAppNow([row.id], { now, env, meta: opts.meta, bridge: opts.bridge })
  if (res && (res.failed > 0 || res.skipped > 0)) {
    await prisma.$executeRaw`
      UPDATE public.whatsapp_links SET pending_phone_e164 = NULL, verify_code_hash = NULL, verify_expires_at = NULL
      WHERE user_id = ${userId}::uuid AND recipient_kind = ${kind} AND verify_code_hash = ${hash}`
    return { ok: false, code: 'send_failed' }
  }
  return {
    ok: true,
    expiresAt: expires.toISOString(),
    phoneMasked: maskPhone(phone),
    delivery: res?.sent ? 'sent' : res?.unknown ? 'unknown' : 'queued',
  }
}

export type ConfirmResult =
  | { ok: true; phone: string }
  | { ok: false; code: 'invalid_code' | 'expired' | 'too_many_attempts' | 'rate_limited' | 'not_configured'; retryAfterSeconds?: number }

export async function confirmVerification(userId: string, kind: RecipientKind, code: string, opts: { now?: Date; env?: WhatsAppEnv } = {}): Promise<ConfirmResult> {
  const secret = verifySecret(opts.env ?? process.env)
  if (!secret) return { ok: false, code: 'not_configured' }
  const rl = await checkRateLimit(userId, VERIFY_LIMITS.confirm.bucket, { max: VERIFY_LIMITS.confirm.max, windowMs: VERIFY_LIMITS.confirm.windowMs })
  if (rl.limited) return { ok: false, code: 'rate_limited', retryAfterSeconds: rl.retryAfterSeconds }

  const now = opts.now ?? new Date()
  const l = await readLink(userId, kind)
  if (!l?.pending_phone_e164 || !l.verify_expires_at || l.verify_expires_at <= now) return { ok: false, code: 'expired' }
  const clean = String(code ?? '').replace(/\D/g, '')
  const hash = /^\d{6}$/.test(clean) ? codeHash(secret, userId, kind, l.pending_phone_e164, clean) : 'x'

  // Consume atomically: only the current, unexpired, not-burnt code matches.
  const done = await prisma.$queryRaw<Array<{ phone_e164: string }>>`
    UPDATE public.whatsapp_links
       SET phone_e164 = pending_phone_e164, verified_at = ${now}, opt_in_at = ${now}, opt_out_at = NULL,
           pending_phone_e164 = NULL, verify_code_hash = NULL, verify_expires_at = NULL, verify_attempts = 0
     WHERE user_id = ${userId}::uuid AND recipient_kind = ${kind}
       AND verify_code_hash = ${hash} AND verify_expires_at > ${now} AND verify_attempts < ${VERIFY_MAX_ATTEMPTS}
    RETURNING phone_e164`
  if (done[0]) return { ok: true, phone: done[0].phone_e164 }

  const burnt = await prisma.$queryRaw<Array<{ verify_attempts: number }>>`
    UPDATE public.whatsapp_links SET verify_attempts = verify_attempts + 1
     WHERE user_id = ${userId}::uuid AND recipient_kind = ${kind} AND verify_code_hash IS NOT NULL
    RETURNING verify_attempts::int`
  if ((burnt[0]?.verify_attempts ?? VERIFY_MAX_ATTEMPTS) >= VERIFY_MAX_ATTEMPTS) {
    await prisma.$executeRaw`
      UPDATE public.whatsapp_links SET pending_phone_e164 = NULL, verify_code_hash = NULL, verify_expires_at = NULL
      WHERE user_id = ${userId}::uuid AND recipient_kind = ${kind}`
    return { ok: false, code: 'too_many_attempts' }
  }
  return { ok: false, code: 'invalid_code' }
}

/** Stop messages; the verified number is kept for a later opt-in. */
export async function optOut(userId: string, kind: RecipientKind, now = new Date()): Promise<void> {
  await prisma.$executeRaw`
    UPDATE public.whatsapp_links SET opt_in_at = NULL, opt_out_at = ${now}
    WHERE user_id = ${userId}::uuid AND recipient_kind = ${kind}`
}

/** Opt in again on the already verified number. false when there is none. */
export async function optIn(userId: string, kind: RecipientKind, now = new Date()): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE public.whatsapp_links SET opt_in_at = ${now}, opt_out_at = NULL
    WHERE user_id = ${userId}::uuid AND recipient_kind = ${kind} AND verified_at IS NOT NULL AND phone_e164 IS NOT NULL`
  return n > 0
}

export async function updatePreferences(userId: string, kind: RecipientKind, p: { minLevel?: OrderedLevel; mutedUntil?: Date | null }): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE public.whatsapp_links
       SET min_level = COALESCE(${p.minLevel ?? null}, min_level),
           muted_until = CASE WHEN ${p.mutedUntil !== undefined} THEN ${p.mutedUntil ?? null}::timestamptz ELSE muted_until END
     WHERE user_id = ${userId}::uuid AND recipient_kind = ${kind}`
  return n > 0
}

export async function removeLink(userId: string, kind: RecipientKind): Promise<void> {
  await prisma.$executeRaw`DELETE FROM public.whatsapp_links WHERE user_id = ${userId}::uuid AND recipient_kind = ${kind}`
}

export interface WhatsAppRecipient { userId: string; phone: string; minLevel: OrderedLevel; mutedUntil: Date | null; role: string | null; staffRole: string | null }

/**
 * Opted-in, verified recipients of an audience whose profile is approved.
 * `verifiedBefore`: only numbers verified before that moment (a resumed
 * fan-out of an old event does not reach a number linked later).
 */
export async function optedInRecipients(kind: RecipientKind, filter: { userIds?: string[]; verifiedBefore?: Date | null } = {}): Promise<WhatsAppRecipient[]> {
  const ids = filter.userIds && filter.userIds.length > 0 ? filter.userIds : null
  const before = filter.verifiedBefore ?? null
  const rows = await prisma.$queryRaw<Array<{ user_id: string; phone_e164: string; min_level: OrderedLevel; muted_until: Date | null; role: string | null; staff_role: string | null }>>`
    SELECT l.user_id::text, l.phone_e164, l.min_level, l.muted_until, p.role, s.role AS staff_role
    FROM public.whatsapp_links l
    JOIN public.profiles p ON p.id = l.user_id AND p.status = 'approved'
    LEFT JOIN public.staff_roles s ON s.user_id = l.user_id
    WHERE l.recipient_kind = ${kind} AND l.opt_in_at IS NOT NULL AND l.opt_out_at IS NULL
      AND l.verified_at IS NOT NULL AND l.phone_e164 IS NOT NULL
      AND (${ids}::uuid[] IS NULL OR l.user_id = ANY (${ids}::uuid[]))
      AND (${before}::timestamptz IS NULL OR l.verified_at <= ${before}::timestamptz)`
  return rows.map((r) => ({ userId: r.user_id, phone: r.phone_e164, minLevel: r.min_level, mutedUntil: r.muted_until, role: r.role, staffRole: r.staff_role }))
}
