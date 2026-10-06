import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { costSummary } from '@/lib/agents/admin'

export const dynamic = 'force-dynamic'

/** GET /api/giga-admin/agents/costs?days=30 — spend and tokens by day, agent, model, company. */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  const days = Number(req.nextUrl.searchParams.get('days') ?? 30) || 30
  const summary = await costSummary(days)
  return NextResponse.json({
    ok: true,
    ...summary,
    budgets: {
      platformDailyUsd: Number(process.env.AGENT_PLATFORM_DAILY_BUDGET_USD ?? 50),
      companyDailyUsd: Number(process.env.AGENT_COMPANY_DAILY_BUDGET_USD ?? 5),
    },
  })
}
