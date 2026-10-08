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
 * Fail-OPEN: any infrastructure error (DB down, migration not applied) lets the
 * call through — a broken meter must not take the product's AI down.
 */

import { NextResponse } from 'next/server'
import { setAiActor, type AiActor, type AiFeature } from './usage'

export const AI_BUDGET_MESSAGE = 'Дневной лимит ИИ исчерпан, попробуйте завтра'

export type AiBudgetTier = 'free' | 'pro' | 'staff'

export class AiBudgetExceededError extends Error {
  readonly status = 429
  readonly code = 'ai_budget_exceeded'
  constructor(
    readonly feature: AiFeature,
    readonly tier: AiBudgetTier,
    readonly spentUsd: number,
    readonly limitUsd: number,
  ) {
    super(AI_BUDGET_MESSAGE)
    this.name = 'AiBudgetExceededError'
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

// Platform staff (profiles.role) — the staff budget applies.
const STAFF_PROFILE_ROLES = new Set([
  'super_admin', 'admin', 'owner', 'expert', 'manager', 'analyst',
  'super_expert', 'crm_manager', 'content_manager', 'support',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const defaultDeps: AiBudgetDeps = {
  async readTier(userId) {
    const { createServiceClient } = await import('@/lib/supabase-service')
    const { data } = await createServiceClient()
      .from('profiles').select('role, tier').eq('id', userId).maybeSingle()
    const row = data as { role?: unknown; tier?: unknown } | null
    if (typeof row?.role === 'string' && STAFF_PROFILE_ROLES.has(row.role)) return 'staff'
    return row?.tier === 'pro' ? 'pro' : 'free'
  },
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

/** Test hook: replace the data readers (pass `null` to restore). */
export function __setAiBudgetDeps(deps: AiBudgetDeps | null): void {
  injected = deps
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
  let limit: number
  let spent: number
  try {
    tier = await deps.readTier(userId)
    ;[limit, spent] = await Promise.all([deps.readLimitUsd(tier), deps.readSpentTodayUsd(userId)])
  } catch (err) {
    console.warn('[ai-budget] check skipped (fail-open):', err instanceof Error ? err.message : err)
    return
  }
  if (!Number.isFinite(limit) || !Number.isFinite(spent)) return
  if (spent >= limit) throw new AiBudgetExceededError(feature, tier, spent, limit)
}

/** The 429 answer every AI route returns when the daily budget is spent. */
export function aiBudgetExceededResponse(extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json(
    { ok: false, error: AI_BUDGET_MESSAGE, code: 'ai_budget_exceeded', ...extra },
    { status: 429 },
  )
}

/**
 * Route helper: `const over = await guardAiBudget(user.id, 'ai_chat'); if (over) return over`.
 * Returns the 429 response when over budget, otherwise null.
 */
export async function guardAiBudget(actor: string | AiActor, feature: AiFeature): Promise<NextResponse | null> {
  try {
    await assertAiBudget(actor, feature)
    return null
  } catch (err) {
    if (isAiBudgetError(err)) return aiBudgetExceededResponse()
    return null
  }
}
