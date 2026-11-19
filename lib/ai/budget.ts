/**
 * lib/ai/budget.ts — per-user daily AI spend limit (F-070).
 *
 * `assertAiBudget(userId, feature)` throws `AiBudgetExceededError` when the
 * user has already spent their daily limit (sum of `ai_usage.cost_usd` since
 * local midnight, RPC `ai_usage_user_today`, migration 091). Limits come from
 * settings `ai_daily_budget_usd_{free,pro,staff}`.
 *
 * It also marks the request's AI actor (see `setAiActor`), so every AI call
 * made afterwards in the same request is attributed to this user in ai_usage.
 *
 * When the meter cannot be read (DB down, settings or RPC missing, a value that
 * is not a number) — R-146:
 *   • free tier (and a tier that cannot be read): fail CLOSED —
 *     AiBudgetUnavailableError (503, still an AI-budget error, so every caller
 *     that refuses on isAiBudgetError refuses). Free accounts are the ones anybody
 *     can make many of; an open meter there is unbounded spend;
 *   • pro and staff: fail OPEN with a console.error on every such call. They
 *     pay or work here, are few, and their AI routes are rate-limited; the budget
 *     is a cost guard for them, not an access control — an outage of the meter
 *     must not take their AI down.
 * Who is staff and who is paid comes from the project's resolvers (budgetTierOf):
 * staff — migration 140 (staff_roles, active expert; lib/access/actor.ts), paid —
 * the entitlements incl. overrides and the company's tariff (lib/access/server.ts),
 * never profiles.role / profiles.tier alone (R5 review M-1).
 *
 * Check and record are not one atomic step: concurrent requests of one user all
 * pass the check before their usage is recorded (lib/ai/usage writes ai_usage
 * after each call, its cost known only then). The overshoot is bounded by the
 * calls one user has in flight × the cost of one call, and the per-route rate
 * limits cap those. An atomic reservation would need a cost estimate before the
 * call, a reservation ledger and a reconciliation after it (and a release on
 * failure) — not a small change; not done.
 */

import { NextResponse } from 'next/server'
import type { AccessActor } from '@/lib/access/actor'
import { hasPaidAccess, type Entitlements } from '@/lib/access/entitlements'
import { setAiActor, type AiActor, type AiFeature } from './usage'

export const AI_BUDGET_MESSAGE = 'Дневной лимит ИИ исчерпан, попробуйте завтра'
export const AI_BUDGET_UNAVAILABLE_MESSAGE = 'Не удалось проверить дневной лимит ИИ. Попробуйте через пару минут.'

export type AiBudgetTier = 'free' | 'pro' | 'staff'

export class AiBudgetExceededError extends Error {
  readonly status: 429 | 503 = 429
  readonly code: 'ai_budget_exceeded' | 'ai_budget_unavailable' = 'ai_budget_exceeded'
  constructor(
    readonly feature: AiFeature,
    readonly tier: AiBudgetTier,
    readonly spentUsd: number,
    readonly limitUsd: number,
    message: string = AI_BUDGET_MESSAGE,
  ) {
    super(message)
    this.name = 'AiBudgetExceededError'
  }
}

/**
 * The meter could not be read for a free (or unknown-tier) user: refused like a
 * spent budget (isAiBudgetError is true), but answered 503 «try again», not 429.
 */
export class AiBudgetUnavailableError extends AiBudgetExceededError {
  override readonly status = 503
  override readonly code = 'ai_budget_unavailable'
  constructor(feature: AiFeature, tier: AiBudgetTier) {
    super(feature, tier, Number.NaN, Number.NaN, AI_BUDGET_UNAVAILABLE_MESSAGE)
    this.name = 'AiBudgetUnavailableError'
  }
}

export function isAiBudgetError(err: unknown): err is AiBudgetExceededError {
  return err instanceof AiBudgetExceededError
}

export interface AiBudgetDeps {
  readTier: (userId: string) => Promise<AiBudgetTier>
  readLimitUsd: (tier: AiBudgetTier) => Promise<number>
  readSpentTodayUsd: (userId: string) => Promise<number>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The budget tier from what the project's resolvers say (pure):
 *   • staff — the caller per migration 140 (lib/access/actor.ts): a staff_roles row of an approved
 *     profile, or an active expert. NOT profiles.role: invited staff and roles granted in GIGA keep
 *     profiles.role = 'client', and a legacy profiles.role admin without staff_roles is a client;
 *   • pro — paid access per lib/access/server.ts readEntitlements: own tier, a feature_flags
 *     override, or the tariff of a company the user is an active member of (148, Q3);
 *   • free — neither; null — unknown (the actor could not be read and nothing says «paid»).
 */
export function budgetTierOf(actor: AccessActor | null, ent: Entitlements): AiBudgetTier | null {
  if (actor && actor.kind !== 'client') return 'staff'
  if (hasPaidAccess(ent)) return 'pro'
  return actor ? 'free' : null
}

/** readTier of the real deps: resolveActor + readEntitlements (service role), in parallel. Throws when unknown. */
export async function readBudgetTier(userId: string): Promise<AiBudgetTier> {
  const [{ resolveActor }, { readEntitlements }, { createServiceClient }] = await Promise.all([
    import('@/lib/access/actor'),
    import('@/lib/access/server'),
    import('@/lib/supabase-service'),
  ])
  const [actor, ent] = await Promise.all([resolveActor(userId), readEntitlements(createServiceClient(), userId)])
  const tier = budgetTierOf(actor, ent)
  // An unreadable caller is unknown, not «free with a working meter».
  if (!tier) throw new Error('staff / profile unreadable')
  return tier
}

const defaultDeps: AiBudgetDeps = {
  readTier: readBudgetTier,
  async readLimitUsd(tier) {
    const { getSetting } = await import('@/lib/settings/store')
    const key = tier === 'staff' ? 'ai_daily_budget_usd_staff' : tier === 'pro' ? 'ai_daily_budget_usd_pro' : 'ai_daily_budget_usd_free'
    return Number(await getSetting(key))
  },
  async readSpentTodayUsd(userId) {
    const { createServiceClient } = await import('@/lib/supabase-service')
    const { data, error } = await createServiceClient().rpc('ai_usage_user_today', { p_user: userId })
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
  },
}

let injected: AiBudgetDeps | null = null

/**
 * Test hook: replace the data readers (pass `null` to restore). A reader left out is the real
 * one — e.g. inject the meter only and keep the real tier resolution.
 */
export function __setAiBudgetDeps(deps: Partial<AiBudgetDeps> | null): void {
  injected = deps ? { ...defaultDeps, ...deps } : null
}

/**
 * Throw `AiBudgetExceededError` when `actor` is over today's limit. Also sets
 * the request's AI actor. Call it BEFORE the first AI call of a route.
 */
export async function assertAiBudget(actor: string | AiActor, feature: AiFeature): Promise<void> {
  const a: AiActor = typeof actor === 'string' ? { userId: actor } : actor
  // Synchronous prefix: attributes the rest of the caller's request to this actor.
  setAiActor(a)

  const userId = a.userId && UUID_RE.test(a.userId) ? a.userId : null
  if (!userId) return // staff/system actors without a user id are not metered per day

  // Under the test runner the real readers would talk to the DB from .env —
  // tests that exercise the budget inject deps explicitly.
  const deps = injected ?? (process.env.NODE_ENV === 'test' ? null : defaultDeps)
  if (!deps) return

  let tier: AiBudgetTier
  try {
    tier = await deps.readTier(userId)
  } catch (err) {
    // Who this is is unknown: treated as free — closed.
    console.error('[ai-budget] tier unreadable — refused (fail-closed):', err instanceof Error ? err.message : err)
    throw new AiBudgetUnavailableError(feature, 'free')
  }
  let limit: number
  let spent: number
  try {
    ;[limit, spent] = await Promise.all([deps.readLimitUsd(tier), deps.readSpentTodayUsd(userId)])
  } catch (err) {
    return meterDown(feature, tier, err instanceof Error ? err.message : String(err))
  }
  if (!Number.isFinite(limit) || !Number.isFinite(spent)) return meterDown(feature, tier, 'limit or spend is not a number')
  if (spent >= limit) throw new AiBudgetExceededError(feature, tier, spent, limit)
}

/** The meter is down: free — refuse (throws); pro / staff — let through, loudly. */
function meterDown(feature: AiFeature, tier: AiBudgetTier, why: string): void {
  if (tier === 'free') {
    console.error(`[ai-budget] meter unavailable — free user refused (fail-closed), ${feature}: ${why}`)
    throw new AiBudgetUnavailableError(feature, tier)
  }
  console.error(`[ai-budget] meter unavailable — ${tier} user let through (fail-open), ${feature}: ${why}`)
}

/**
 * The answer every AI route returns when the budget refuses: 429 when the daily
 * budget is spent; with an AiBudgetUnavailableError, 503 «не удалось проверить».
 */
export function aiBudgetExceededResponse(extra: Record<string, unknown> = {}, err?: AiBudgetExceededError): NextResponse {
  const status = err?.status ?? 429
  return NextResponse.json(
    { ok: false, error: err?.message ?? AI_BUDGET_MESSAGE, code: err?.code ?? 'ai_budget_exceeded', ...extra },
    { status },
  )
}

/**
 * Route helper: `const over = await guardAiBudget(user.id, 'ai_chat'); if (over) return over`.
 * Returns the refusal (429 / 503) when the budget says no — including an
 * unexpected error of the check (never «allowed» by accident) — otherwise null.
 */
export async function guardAiBudget(actor: string | AiActor, feature: AiFeature): Promise<NextResponse | null> {
  try {
    await assertAiBudget(actor, feature)
    return null
  } catch (err) {
    if (isAiBudgetError(err)) return aiBudgetExceededResponse({}, err)
    console.error('[ai-budget] check failed — refused:', err instanceof Error ? err.message : err)
    return aiBudgetExceededResponse({}, new AiBudgetUnavailableError(feature, 'free'))
  }
}
