export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { summarizeAiUsage, type AiUsageSummaryRow } from '@/lib/ai/usage-summary'

/**
 * GET /api/giga-admin/ai/usage?days=7|30 — AI cost by feature (F-070).
 * Reads RPC ai_usage_summary (migration 091). Permission: analytics.view.
 *
 * → { ok, data: { days, total_cost_usd, total_calls, cache_hits,
 *                 features: [{ feature, label, calls, failed_calls, cache_hits,
 *                              prompt_tokens, completion_tokens, cost_usd, models[] }] } }
 */
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'analytics.view')
  if (guard.response) return guard.response
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get('days')) || 30))
  const { data, error } = await createServiceClient().rpc('ai_usage_summary', { p_days: days })
  if (error) {
    return NextResponse.json({ ok: false, error: 'Учёт AI недоступен — примените миграцию 091' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, data: { days, ...summarizeAiUsage((data ?? []) as AiUsageSummaryRow[]) } })
}
