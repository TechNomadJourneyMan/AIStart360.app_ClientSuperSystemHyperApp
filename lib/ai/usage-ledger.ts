/**
 * lib/ai/usage-ledger.ts — cost control for model calls made outside the agent
 * runtime (lib/ai/openrouter.ts chatWithOpenRouter).
 *
 *   platformBudgetLeft()  today's platform AI spend (agents + ledger) against
 *                         AGENT_PLATFORM_DAILY_BUDGET_USD (default 50)
 *   recordUsage()         append the provider-reported cost to ai_usage_ledger
 *
 * Server-only. Database problems never break the feature: the budget check
 * then allows the call (and logs), recording failures are logged.
 */
const PLATFORM_DAILY_BUDGET_USD = () => Number(process.env.AGENT_PLATFORM_DAILY_BUDGET_USD ?? 50)

export interface UsageRecord {
  source: string
  model: string | null
  tokensIn: number
  tokensOut: number
  costUsd: number
  costSource: 'provider' | 'estimate'
  companyId?: string | null
  ok: boolean
}

/** Remaining platform budget in USD today, or null when it cannot be determined. */
export async function platformBudgetLeft(): Promise<number | null> {
  try {
    const { spendToday } = await import('@/lib/agents/store')
    return PLATFORM_DAILY_BUDGET_USD() - (await spendToday())
  } catch (err) {
    console.warn('[ai-usage] budget check unavailable:', err instanceof Error ? err.message.split('\n')[0] : err)
    return null
  }
}

export async function recordUsage(r: UsageRecord): Promise<void> {
  try {
    const { prisma } = await import('@/lib/db')
    const cost = Number.isFinite(r.costUsd) && r.costUsd > 0 ? r.costUsd.toFixed(6) : '0'
    await prisma.$executeRaw`
      INSERT INTO public.ai_usage_ledger (source, model, tokens_in, tokens_out, cost_usd, cost_source, company_id, ok)
      VALUES (${r.source.slice(0, 120)}, ${r.model}, ${String(Math.max(0, Math.round(r.tokensIn)))}::text::int,
              ${String(Math.max(0, Math.round(r.tokensOut)))}::text::int, ${cost}::text::numeric,
              ${r.costSource}, ${r.companyId ?? null}, ${r.ok})`
  } catch (err) {
    console.warn('[ai-usage] not recorded:', err instanceof Error ? err.message.split('\n')[0] : err)
  }
}
