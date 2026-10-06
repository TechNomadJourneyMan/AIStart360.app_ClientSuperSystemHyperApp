/**
 * lib/ai/usage-ledger.ts — cost control for model calls made outside the agent
 * runtime (lib/ai/openrouter.ts chatWithOpenRouter / embedWithOpenRouter).
 *
 *   platformBudgetLeft()  today's platform AI spend (agents + ledger) against
 *                         the platform daily budget: the runtime-editable
 *                         ai_budgets row (094), else AGENT_PLATFORM_DAILY_BUDGET_USD
 *                         (default 50)
 *   recordUsage()         append the call's cost and provider to ai_usage_ledger
 *
 * Server-only. Database problems never break the feature: the budget check
 * then allows the call (and logs), recording failures are logged.
 */
import type { CostSource } from './providers/types'

export interface UsageRecord {
  source: string
  model: string | null
  tokensIn: number
  tokensOut: number
  costUsd: number
  costSource: CostSource
  companyId?: string | null
  /** ai_providers.key of the provider that served the call (094). */
  providerKey?: string | null
  ok: boolean
}

/** Remaining platform budget in USD today, or null when it cannot be determined. */
export async function platformBudgetLeft(): Promise<number | null> {
  try {
    const [{ spendToday }, { effectiveBudgets }] = await Promise.all([
      import('@/lib/agents/store'),
      import('./providers/router'),
    ])
    const [{ platformDailyUsd }, spent] = await Promise.all([effectiveBudgets(), spendToday()])
    return platformDailyUsd - spent
  } catch (err) {
    console.warn('[ai-usage] budget check unavailable:', err instanceof Error ? err.message.split('\n')[0] : err)
    return null
  }
}

export async function recordUsage(r: UsageRecord): Promise<void> {
  try {
    const { prisma } = await import('@/lib/db')
    const cost = Number.isFinite(r.costUsd) && r.costUsd > 0 ? r.costUsd.toFixed(6) : '0'
    const tokensIn = String(Math.max(0, Math.round(r.tokensIn)))
    const tokensOut = String(Math.max(0, Math.round(r.tokensOut)))
    try {
      await prisma.$executeRaw`
        INSERT INTO public.ai_usage_ledger (source, model, tokens_in, tokens_out, cost_usd, cost_source, company_id, ok, provider_key)
        VALUES (${r.source.slice(0, 120)}, ${r.model}, ${tokensIn}::text::int, ${tokensOut}::text::int, ${cost}::text::numeric,
                ${r.costSource}, ${r.companyId ?? null}, ${r.ok}, ${r.providerKey ?? null})`
    } catch (err) {
      // Before migration 094: no provider_key column and no 'model_price' source.
      if (!/provider_key|cost_source/.test(err instanceof Error ? err.message : '')) throw err
      await prisma.$executeRaw`
        INSERT INTO public.ai_usage_ledger (source, model, tokens_in, tokens_out, cost_usd, cost_source, company_id, ok)
        VALUES (${r.source.slice(0, 120)}, ${r.model}, ${tokensIn}::text::int, ${tokensOut}::text::int, ${cost}::text::numeric,
                ${r.costSource === 'provider' ? 'provider' : 'estimate'}, ${r.companyId ?? null}, ${r.ok})`
    }
  } catch (err) {
    console.warn('[ai-usage] not recorded:', err instanceof Error ? err.message.split('\n')[0] : err)
  }
}
