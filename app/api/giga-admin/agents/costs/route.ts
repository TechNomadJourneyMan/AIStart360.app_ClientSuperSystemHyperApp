import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { costSummary } from '@/lib/agents/admin'
import { getBudgets } from '@/lib/ai/providers/service'

export const dynamic = 'force-dynamic'

/**
 * Effective daily budgets: the panel values (ai_budgets, «Провайдеры и ключи»)
 * or env when none is set. Without the 094 tables the env values are shown.
 */
async function effectiveBudgets() {
  try {
    const b = await getBudgets()
    return {
      platformDailyUsd: b.platform.dailyUsd,
      companyDailyUsd: b.company.dailyUsd,
      platformSource: b.platform.source,
      companySource: b.company.source,
    }
  } catch {
    return {
      platformDailyUsd: Number(process.env.AGENT_PLATFORM_DAILY_BUDGET_USD ?? 50),
      companyDailyUsd: Number(process.env.AGENT_COMPANY_DAILY_BUDGET_USD ?? 5),
      platformSource: 'env' as const,
      companySource: 'env' as const,
    }
  }
}

/** GET /api/giga-admin/agents/costs?days=30 — spend and tokens by day, agent, model, company. */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  const days = Number(req.nextUrl.searchParams.get('days') ?? 30) || 30
  const [summary, budgets] = await Promise.all([costSummary(days), effectiveBudgets()])
  return NextResponse.json({ ok: true, ...summary, budgets })
}
