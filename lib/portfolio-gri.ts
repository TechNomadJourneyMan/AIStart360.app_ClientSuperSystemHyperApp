import { createServerClient } from '@/lib/supabase-server'

export interface PortfolioGRI {
  overall:      number
  product:      number
  trust:        number
  bizmodel:     number
  cash:         number
  ops:          number
  team:         number
  founder:      number
  reportCount:  number
}

/**
 * Computes portfolio-level GRI averages by reading all diagnostics from Supabase
 * and mapping Point A's 5 blocks (finance, sales, operations, marketing, strategy)
 * to the 7-domain GRI model (approximate mapping).
 *
 * Returns `null` if no diagnostics exist or on DB error.
 * Scores are on 0–10 scale (converted from 0–100 stored values).
 *
 * @param companyId Optional. When provided, only diagnostics for that company
 *   are aggregated (so an owner sees their own portfolio, not every org's).
 *   Omitting it preserves the original "all orgs" behaviour.
 */
export async function getPortfolioGRI(companyId?: string | null): Promise<PortfolioGRI | null> {
  try {
    const sb = createServerClient()

    let query = sb
      .from('diagnostics')
      .select('overall_score, finance_score, sales_score, operations_score, marketing_score, strategy_score')
      .not('overall_score', 'is', null)
      .gt('overall_score', 0)

    if (companyId) {
      query = query.eq('company_id', companyId)
    }

    const { data: diagnostics } = await query

    if (!diagnostics?.length) return null

    const getScore = (d: Record<string, unknown>, key: string): number => {
      const block = d[key] as { score?: number } | null
      return (block?.score ?? 0) / 10 // 0-100 → 0-10
    }

    const avgField = (extractor: (d: Record<string, unknown>) => number): number => {
      const vals = diagnostics.map(d => extractor(d as Record<string, unknown>)).filter(v => v > 0)
      return vals.length > 0
        ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
        : 0
    }

    return {
      overall:     avgField(d => (d.overall_score as number ?? 0) / 10),
      product:     avgField(d => getScore(d, 'marketing_score')),    // Marketing → Product & Demand
      trust:       avgField(d => getScore(d, 'strategy_score')),     // Strategy → Trust & Positioning
      bizmodel:    avgField(d => getScore(d, 'sales_score')),        // Sales → Business Model
      cash:        avgField(d => getScore(d, 'finance_score')),      // Finance → Cash
      ops:         avgField(d => getScore(d, 'operations_score')),   // Operations → Operations
      team:        avgField(d => getScore(d, 'operations_score')),   // Operations → Team (proxy)
      founder:     avgField(d => getScore(d, 'strategy_score')),     // Strategy → Founder (proxy)
      reportCount: diagnostics.length,
    }
  } catch (error) {
    console.error('[portfolio-gri] Failed to load diagnostics:', error)
    return null
  }
}
