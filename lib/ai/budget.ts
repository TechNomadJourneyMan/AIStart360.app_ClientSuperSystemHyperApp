/**
 * Daily AI budget guard — prevents runaway Claude / OpenAI spend.
 *
 * Budget state is derived from ai_runs.total_cost_usd summed for the
 * current UTC calendar day. When spend exceeds AI_DAILY_BUDGET_USD
 * (default $50), subsequent orchestrate() calls throw
 * BudgetExceededError before any LLM request is made.
 *
 * The check runs at orchestrate() entry; in-flight runs continue.
 *
 * Server-only.
 */

export class BudgetExceededError extends Error {
  constructor(
    public readonly spent: number,
    public readonly limit: number
  ) {
    super(`AI daily budget exceeded: $${spent.toFixed(4)} / $${limit.toFixed(2)}`)
    this.name = 'BudgetExceededError'
  }
}

export interface BudgetState {
  /** Calendar-day start (UTC midnight). */
  since: string
  /** Sum of ai_runs.total_cost_usd for today. */
  spent_usd: number
  /** Configured daily limit. */
  limit_usd: number
  /** true → new orchestrations should be blocked. */
  blocked: boolean
  /** 0..1 ratio. */
  utilization: number
}

function getServiceRole(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[budget] Supabase creds missing')
  return { url, key }
}

function parseLimit(): number {
  const raw = process.env.AI_DAILY_BUDGET_USD
  const n = raw ? parseFloat(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : 50
}

/** Compute current budget state from the DB (no caching — query is cheap). */
export async function getBudgetState(): Promise<BudgetState> {
  const { url, key } = getServiceRole()
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const sinceIso = since.toISOString()

  const res = await fetch(
    `${url}/rest/v1/ai_runs?select=total_cost_usd&started_at=gte.${sinceIso}`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cache: 'no-store',
    }
  )
  if (!res.ok) {
    // Fail-open: if the query fails, don't block production
    // eslint-disable-next-line no-console
    console.warn('[budget] state query failed — defaulting to {blocked:false}:', res.status)
    return {
      since: sinceIso,
      spent_usd: 0,
      limit_usd: parseLimit(),
      blocked: false,
      utilization: 0,
    }
  }

  const rows = (await res.json()) as Array<{ total_cost_usd: number | null }>
  const spent = rows.reduce((s, r) => s + (r.total_cost_usd ?? 0), 0)
  const limit = parseLimit()

  return {
    since: sinceIso,
    spent_usd: Number(spent.toFixed(4)),
    limit_usd: limit,
    blocked: spent >= limit,
    utilization: limit > 0 ? Math.min(1, spent / limit) : 0,
  }
}

/**
 * Throw BudgetExceededError if today's spend >= limit. Call this at the
 * start of orchestrate() and any expensive admin-triggered re-extraction.
 */
export async function assertBudgetAvailable(): Promise<void> {
  const state = await getBudgetState()
  if (state.blocked) {
    throw new BudgetExceededError(state.spent_usd, state.limit_usd)
  }
}
