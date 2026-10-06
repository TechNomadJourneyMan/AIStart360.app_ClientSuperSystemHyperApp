/**
 * lib/payments/billing.ts — the only writer of a client's plan (W8).
 *
 * Every plan change — the trial checkout, the Kaspi webhook, the GIGA editor,
 * the expiry job — goes through setPlan(), which calls the SQL function
 * billing_set_plan() (migration 106). That function changes `subscriptions`
 * and `profiles.tier` in ONE transaction, so the access gate and Settings ›
 * Биллинг always agree.
 *
 * Audit (admin_audit_log, lib/admin/audit.ts):
 *   - admin and system changes are journalled BEFORE the write with
 *     required:true — no journal, no change;
 *   - trial / kaspi / stub changes are journalled after the write, best
 *     effort: a confirmed payment must not be lost because the journal is down.
 *
 * Server-only: uses the service-role client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase-service'
import { recordAdminAction, type AuditActor } from '@/lib/admin/audit'
import type { AcquiringProviderName } from './types'
import {
  accessTierFor,
  effectivePlan,
  isPlanSource,
  isPlanTier,
  pickSubscription,
  toSubscriptionRecord,
  utcIso,
  type EffectivePlan,
  type PlanSource,
  type PlanTier,
  type SubscriptionRecord,
} from './plan-state'

export * from './plan-state'

export type BillingActor = AuditActor

/** The expiry job's identity in the journal. */
export const SYSTEM_EXPIRY_ACTOR: BillingActor = { id: 'system:billing-expiry', kind: 'system' }
/** The Kaspi payment callback's identity in the journal. */
export const KASPI_WEBHOOK_ACTOR: BillingActor = { id: 'kaspi:webhook', kind: 'system' }

export type BillingErrorCode = 'invalid' | 'not_found' | 'migration_106_required' | 'audit_unavailable' | 'db_error'

export class BillingError extends Error {
  constructor(public readonly code: BillingErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'BillingError'
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUB_COLUMNS = 'orgId,tier,status,provider,trialEndsAt,currentPeriodEnd,source,note,assignedBy,updatedAt'
const LEGACY_SUB_COLUMNS = 'orgId,tier,status,provider,trialEndsAt,currentPeriodEnd,updatedAt'
export const NOTE_MAX = 500

type Svc = SupabaseClient

export interface Tenant {
  /** profiles id of the person, when known. */
  userId: string | null
  /** subscriptions.orgId the write goes to. */
  orgId: string
  subscription: SubscriptionRecord | null
  profileTier: unknown
  profileFound: boolean
}

/** PostgREST / Postgres: the function or column does not exist yet. */
function isMissingSchema(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  return err.code === 'PGRST202' || err.code === '42883' || err.code === '42703' || err.code === 'PGRST204'
    || /billing_set_plan|billing_due_expirations|column .* does not exist/i.test(err.message ?? '')
}

async function readSubscriptions(svc: Svc, orgIds: string[]): Promise<SubscriptionRecord[]> {
  if (orgIds.length === 0) return []
  const read = (columns: string) =>
    svc.from('subscriptions').select(columns).in('orgId', orgIds).order('updatedAt', { ascending: false }).limit(5)
  let res: { data: unknown[] | null; error: { code?: string; message: string } | null } = await read(SUB_COLUMNS)
  // Before migration 106 the source/note columns are absent: read what exists.
  if (res.error && isMissingSchema(res.error)) res = await read(LEGACY_SUB_COLUMNS)
  if (res.error) throw new BillingError('db_error', res.error.message)
  return ((res.data ?? []) as unknown[]).map(toSubscriptionRecord).filter((r): r is SubscriptionRecord => r !== null)
}

async function readProfileTier(svc: Svc, userId: string): Promise<{ found: boolean; tier: unknown }> {
  const { data, error } = await svc.from('profiles').select('id, tier').eq('id', userId).maybeSingle()
  if (error) throw new BillingError('db_error', error.message)
  return { found: Boolean(data), tier: (data as { tier?: unknown } | null)?.tier }
}

/**
 * Resolve the billing tenant. `subscriptions.orgId` is companies.id (the
 * per-user tenant) or the auth user id — see app/api/checkout.
 *  - by orgId: that exact row; the person is companies.user_id, else the key
 *    itself when it is a profile id;
 *  - by userId: the person's live row under either key, else their first
 *    company id, else their user id (same choice as the checkout).
 */
export async function resolveTenant(svc: Svc, ref: { userId?: string | null; orgId?: string | null }): Promise<Tenant> {
  if (ref.orgId) {
    const orgId = ref.orgId
    let userId = ref.userId ?? null
    if (!userId) {
      const { data } = await svc.from('companies').select('user_id').eq('id', orgId).maybeSingle()
      userId = (data as { user_id?: string | null } | null)?.user_id ?? (UUID_RE.test(orgId) ? orgId : null)
    }
    const [subs, profile] = await Promise.all([
      readSubscriptions(svc, [orgId]),
      userId ? readProfileTier(svc, userId) : Promise.resolve({ found: false, tier: null }),
    ])
    return {
      userId: profile.found ? userId : ref.userId ?? null,
      orgId,
      subscription: subs[0] ?? null,
      profileTier: profile.tier,
      profileFound: profile.found,
    }
  }
  const userId = ref.userId
  if (!userId || !UUID_RE.test(userId)) throw new BillingError('invalid', 'user id required')
  const { data: company } = await svc
    .from('companies')
    .select('id')
    .eq('user_id', userId)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  const companyId = (company as { id?: string } | null)?.id ?? null
  const keys = [companyId, userId].filter((k): k is string => Boolean(k))
  const [subs, profile] = await Promise.all([readSubscriptions(svc, keys), readProfileTier(svc, userId)])
  const subscription = pickSubscription(subs)
  return {
    userId,
    orgId: subscription?.orgId ?? companyId ?? userId,
    subscription,
    profileTier: profile.tier,
    profileFound: profile.found,
  }
}

/** The effective plan of a person (Settings › Биллинг, GIGA user card). */
export async function getEffectivePlan(ref: { userId?: string | null; orgId?: string | null }, svc: Svc = createServiceClient()): Promise<EffectivePlan & { userId: string | null }> {
  const t = await resolveTenant(svc, ref)
  return { ...effectivePlan(t.subscription, t.profileTier), userId: t.userId }
}

export interface SetPlanInput {
  userId?: string | null
  orgId?: string | null
  tier: PlanTier
  /** End of the trial / paid period; null = no end date. Required for 'pilot'. */
  periodEnd?: Date | null
  source: PlanSource
  actor: BillingActor
  note?: string | null
  provider?: AcquiringProviderName | null
  /** Expiry job: apply only while the row is still expired (re-checked under lock). */
  onlyIfExpired?: boolean
  /** Request of the staff action, for the journal (ip / user agent). */
  req?: Request | null
  /**
   * Payment callback: payment_transactions.id marked succeeded atomically with
   * the plan change; a payment that is already final applies nothing
   * (reason 'payment_already_final').
   */
  paymentTransactionId?: string | null
  /** Extra journal metadata (transaction id, months added, …). */
  meta?: Record<string, unknown>
}

export interface SetPlanResult {
  applied: boolean
  reason?: string
  orgId: string
  userId: string | null
  before: EffectivePlan
  after: EffectivePlan | null
}

interface RpcResult {
  applied: boolean
  reason?: string
  after?: unknown
  profile_tier?: string | null
  kept_access?: boolean
}

function journalValue(input: SetPlanInput) {
  return {
    tier: input.tier,
    access_tier: accessTierFor(input.tier),
    period_end: input.periodEnd ? input.periodEnd.toISOString() : null,
    source: input.source,
    provider: input.provider ?? null,
    note: input.note ?? null,
  }
}

export async function setPlan(input: SetPlanInput, svc: Svc = createServiceClient()): Promise<SetPlanResult> {
  if (!isPlanTier(input.tier)) throw new BillingError('invalid', 'unknown tier')
  if (!isPlanSource(input.source)) throw new BillingError('invalid', 'unknown source')
  if (input.periodEnd && Number.isNaN(input.periodEnd.getTime())) throw new BillingError('invalid', 'bad period end')
  if (input.tier === 'pilot' && !input.periodEnd) throw new BillingError('invalid', 'a trial needs an end date')
  const note = input.note ? input.note.trim().slice(0, NOTE_MAX) || null : null

  const tenant = await resolveTenant(svc, { userId: input.userId, orgId: input.orgId })
  if (input.userId && !tenant.profileFound) throw new BillingError('not_found', 'profile not found')
  const before = effectivePlan(tenant.subscription, tenant.profileTier)

  // Idempotent expiry: nothing to do (and nothing to journal) unless still expired.
  if (input.onlyIfExpired && before.status !== 'expired') {
    return { applied: false, reason: 'not_expired', orgId: tenant.orgId, userId: tenant.userId, before, after: null }
  }

  const strict = input.source === 'admin' || input.source === 'system'
  const entry = {
    action: input.source === 'system' ? 'billing.plan_expired' : 'billing.plan_changed',
    entityType: tenant.userId ? 'user' : 'system',
    entityId: tenant.userId ?? tenant.orgId,
    targetUserId: tenant.userId,
    oldValue: before,
    newValue: { ...journalValue({ ...input, note }) },
    metadata: { org_id: tenant.orgId, source: input.source, ...(input.meta ?? {}) },
  }
  if (strict) {
    try {
      await recordAdminAction(input.actor, entry, input.req ?? null, { required: true })
    } catch {
      throw new BillingError('audit_unavailable', 'Журнал действий недоступен — изменение тарифа не выполнено')
    }
  }

  const { data, error } = await svc.rpc('billing_set_plan', {
    p_org_id: tenant.orgId,
    p_user_id: tenant.profileFound ? tenant.userId : null,
    p_tier: input.tier,
    p_period_end: input.periodEnd ? input.periodEnd.toISOString() : null,
    p_source: input.source,
    p_provider: input.provider ?? null,
    p_note: note,
    p_actor: input.actor.id,
    p_only_if_expired: input.onlyIfExpired === true,
    ...(input.paymentTransactionId ? { p_payment_tx: input.paymentTransactionId } : {}),
  })
  if (error) {
    const code: BillingErrorCode = isMissingSchema(error)
      ? 'migration_106_required'
      : error.code === 'P0002' ? 'not_found' : error.code === '22023' ? 'invalid' : 'db_error'
    if (strict) {
      void recordAdminAction(input.actor, { ...entry, action: 'billing.plan_change_failed', metadata: { ...entry.metadata, error: code } }, input.req ?? null)
    }
    throw new BillingError(code, error.message)
  }

  const res = (data ?? { applied: false }) as RpcResult
  if (!res.applied) {
    if (strict) {
      void recordAdminAction(input.actor, { ...entry, action: 'billing.plan_change_skipped', metadata: { ...entry.metadata, reason: res.reason ?? null } }, input.req ?? null)
    }
    return { applied: false, reason: res.reason, orgId: tenant.orgId, userId: tenant.userId, before, after: null }
  }

  const after = effectivePlan(toSubscriptionRecord(res.after), res.profile_tier ?? tenant.profileTier)
  if (!strict) {
    await recordAdminAction(input.actor, { ...entry, newValue: after }, input.req ?? null)
  }
  return { applied: true, orgId: tenant.orgId, userId: tenant.userId, before, after }
}

/** Add whole months to a date (end-of-month clamps: 31 Jan + 1 → 28/29 Feb). */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime())
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d
}

export interface ExpiryReport {
  due: number
  downgraded: number
  skipped: number
  failed: number
}

/**
 * Downgrade every trial / paid period that has ended to free. Idempotent: a
 * downgraded row is 'canceled' and no longer due; each row is re-checked under
 * its lock, so an extension made meanwhile wins.
 */
export async function expireDuePlans(opts: { now?: Date; limit?: number } = {}, svc: Svc = createServiceClient()): Promise<ExpiryReport> {
  const now = opts.now ?? new Date()
  const { data, error } = await svc.rpc('billing_due_expirations', { p_now: now.toISOString(), p_limit: opts.limit ?? 500 })
  if (error) {
    throw new BillingError(isMissingSchema(error) ? 'migration_106_required' : 'db_error', error.message)
  }
  const rows = (data ?? []) as Array<{ org_id: string; user_id: string | null; tier: string; status: string; ends_at: string | null }>
  const report: ExpiryReport = { due: rows.length, downgraded: 0, skipped: 0, failed: 0 }
  for (const row of rows) {
    try {
      const r = await setPlan({
        orgId: row.org_id,
        userId: row.user_id,
        tier: 'free',
        source: 'system',
        actor: SYSTEM_EXPIRY_ACTOR,
        onlyIfExpired: true,
        note: row.status === 'trialing' ? 'Пробный период закончился' : 'Оплаченный период закончился',
        meta: { expired_tier: row.tier, expired_status: row.status, ends_at: row.ends_at },
      }, svc)
      if (r.applied) report.downgraded++
      else report.skipped++
    } catch (err) {
      report.failed++
      console.error('[billing/expiry] downgrade failed:', row.org_id, err instanceof Error ? err.message : err)
    }
  }
  return report
}

/** Payment history of a person (both tenant keys), newest first. Read-only. */
export interface PaymentRecord {
  id: string
  provider: string
  amount: number
  currency: string
  planKey: string | null
  status: string
  externalId: string | null
  createdAt: string | null
  amountKzt: number | null
}

export async function listPayments(userId: string, svc: Svc = createServiceClient(), limit = 50): Promise<PaymentRecord[]> {
  const t = await resolveTenant(svc, { userId })
  const { data: company } = await svc.from('companies').select('id').eq('user_id', userId).limit(5)
  const keys = Array.from(new Set([t.orgId, userId, ...((company ?? []) as Array<{ id: string }>).map((c) => c.id)]))
  const { data, error } = await svc
    .from('payment_transactions')
    .select('id,provider,amount,currency,planKey,status,externalId,createdAt,metadata')
    .in('orgId', keys)
    .order('createdAt', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)))
  if (error) throw new BillingError('db_error', error.message)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const meta = (r.metadata ?? null) as { amountKzt?: unknown } | null
    return {
      id: String(r.id),
      provider: String(r.provider),
      amount: Number(r.amount) || 0,
      currency: typeof r.currency === 'string' ? r.currency : 'USD',
      planKey: typeof r.planKey === 'string' ? r.planKey : null,
      status: String(r.status),
      externalId: typeof r.externalId === 'string' ? r.externalId : null,
      createdAt: utcIso(r.createdAt),
      amountKzt: typeof meta?.amountKzt === 'number' ? meta.amountKzt : null,
    }
  })
}
