/**
 * lib/payments/plan-state.ts — the effective plan of a client, as one value.
 *
 * Pure and client-safe (no server imports): Settings › Биллинг, the GIGA user
 * card and the billing service all describe a plan with these types, so the
 * client sees the same plan the access gate enforces.
 *
 * Sources of truth (migration 106): `subscriptions` (tier, status, dates, how
 * the plan was obtained) and `profiles.tier` (what the access gate reads).
 * lib/payments/billing.ts writes both in one transaction.
 */

export const PLAN_TIERS = ['free', 'pilot', 'pro', 'enterprise'] as const
export type PlanTier = (typeof PLAN_TIERS)[number]

/** Who set the current plan (subscriptions.source). */
export const PLAN_SOURCES = ['admin', 'trial', 'kaspi', 'stub', 'system'] as const
export type PlanSource = (typeof PLAN_SOURCES)[number]

/** Access tier of profiles.tier (migration 048). */
export type AccessTier = 'free' | 'pro'

export type PlanStatus = 'active' | 'trialing' | 'past_due' | 'expired' | 'canceled' | 'free'

export function isPlanTier(v: unknown): v is PlanTier {
  return typeof v === 'string' && (PLAN_TIERS as readonly string[]).includes(v)
}

export function isPlanSource(v: unknown): v is PlanSource {
  return typeof v === 'string' && (PLAN_SOURCES as readonly string[]).includes(v)
}

/** subscriptions.tier → profiles.tier: every paid or trial tier opens Pro access. */
export function accessTierFor(tier: PlanTier): AccessTier {
  return tier === 'free' ? 'free' : 'pro'
}

/** A subscriptions row as the service reads it; timestamps are ISO UTC strings. */
export interface SubscriptionRecord {
  orgId: string
  tier: string
  status: string
  provider: string | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  source: string | null
  note: string | null
  assignedBy: string | null
  updatedAt: string | null
}

export interface EffectivePlan {
  tier: PlanTier
  status: PlanStatus
  /** End of the trial (trialing) or of the paid period; null = no end date. */
  periodEnd: string | null
  source: PlanSource | null
  provider: string | null
  note: string | null
  /** profiles.tier — what the access gate grants right now. */
  accessTier: AccessTier
  /** Billing tenant key of the subscription row, when there is one. */
  orgId: string | null
}

const LIVE_STATUSES = new Set(['trialing', 'active', 'past_due'])

/**
 * PostgREST and to_jsonb() return TIMESTAMP(3) WITHOUT TIME ZONE as
 * "2026-11-06T10:00:00" — UTC by Prisma convention, but `new Date()` would read
 * it as local time. Normalise to an ISO string with an explicit Z.
 */
export function utcIso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  if (typeof v !== 'string') return null
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(v.trim())
  const d = new Date(hasZone ? v : `${v.trim().replace(' ', 'T')}Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Normalise a raw subscriptions row (PostgREST or to_jsonb) into a record. */
export function toSubscriptionRecord(raw: unknown): SubscriptionRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.orgId !== 'string' || typeof r.tier !== 'string' || typeof r.status !== 'string') return null
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)
  return {
    orgId: r.orgId,
    tier: r.tier,
    status: r.status,
    provider: str(r.provider),
    trialEndsAt: utcIso(r.trialEndsAt),
    currentPeriodEnd: utcIso(r.currentPeriodEnd),
    source: str(r.source),
    note: str(r.note),
    assignedBy: str(r.assignedBy),
    updatedAt: utcIso(r.updatedAt),
  }
}

/** Source of a row written before migration 106 named it. */
function inferSource(sub: SubscriptionRecord): PlanSource | null {
  if (isPlanSource(sub.source)) return sub.source
  if (sub.provider === 'kaspi') return 'kaspi'
  if (sub.provider) return 'stub'
  if (sub.status === 'trialing') return 'trial'
  return null
}

/** Of a person's rows (company key + user key), the one that describes them. */
export function pickSubscription(rows: SubscriptionRecord[]): SubscriptionRecord | null {
  const byRecent = [...rows].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  return byRecent.find((r) => LIVE_STATUSES.has(r.status)) ?? byRecent[0] ?? null
}

/**
 * The plan a client actually has.
 *  - a live subscription row → its tier, status and end date; past its end it
 *    is 'expired' until the expiry job downgrades it;
 *  - Pro access without a live row → Pro assigned by an administrator (the GIGA
 *    editor before migration 106 wrote profiles.tier only);
 *  - otherwise free ('canceled' when a plan existed and ended).
 */
export function effectivePlan(
  sub: SubscriptionRecord | null,
  profileTier: unknown,
  now: Date = new Date(),
): EffectivePlan {
  const accessTier: AccessTier = profileTier === 'pro' ? 'pro' : 'free'
  if (sub && LIVE_STATUSES.has(sub.status) && isPlanTier(sub.tier)) {
    const end = sub.status === 'trialing' ? sub.trialEndsAt : sub.currentPeriodEnd
    const expired = end !== null && new Date(end).getTime() <= now.getTime()
    return {
      tier: sub.tier,
      status: expired ? 'expired' : (sub.status as PlanStatus),
      periodEnd: end,
      source: inferSource(sub),
      provider: sub.provider,
      note: sub.note,
      accessTier,
      orgId: sub.orgId,
    }
  }
  if (accessTier === 'pro') {
    return {
      tier: 'pro',
      status: 'active',
      periodEnd: null,
      source: 'admin',
      provider: null,
      note: null,
      accessTier,
      orgId: sub?.orgId ?? null,
    }
  }
  return {
    tier: 'free',
    status: sub ? 'canceled' : 'free',
    periodEnd: null,
    source: sub ? inferSource(sub) : null,
    provider: null,
    note: sub?.note ?? null,
    accessTier,
    orgId: sub?.orgId ?? null,
  }
}

// ─── Russian labels shared by Settings › Биллинг and GIGA ───────────────────

export const PLAN_TIER_LABEL: Record<PlanTier, string> = {
  free: 'Бесплатный',
  pilot: 'Пилот',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

export const PLAN_SOURCE_LABEL: Record<PlanSource, string> = {
  admin: 'назначен администратором',
  trial: 'пробный',
  kaspi: 'оплачен',
  stub: 'демо-оплата, без списания',
  system: 'срок закончился',
}

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  active: 'Активен',
  trialing: 'Пробный период',
  past_due: 'Просрочен',
  expired: 'Срок истёк',
  canceled: 'Завершён',
  free: 'Бесплатный доступ',
}
