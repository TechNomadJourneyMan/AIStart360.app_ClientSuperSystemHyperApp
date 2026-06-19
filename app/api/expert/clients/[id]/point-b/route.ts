export const dynamic = 'force-dynamic'

// GET /api/expert/clients/[id]/point-b
// Goal-driven Point B for a specific client, for the expert/admin viewer.
// Reads via service role (RLS bypass) — experts see ALL client data. Read-only:
// computes on the fly, does not persist (the client's own page owns persistence).

import { NextResponse } from 'next/server'
import { requireExpert, srGet } from '@/lib/expert-auth'
import { calculatePointBV2, type PointBOptions } from '@/lib/point-b/engine'
import type { PointA, BlockScore } from '@/types/onboarding'

const EMPTY_BLOCK: BlockScore = { score: 0, status: 'critical', top_issues: [], recommendations: [] }

function diagToPointA(diag: Record<string, unknown>): PointA {
  const block = (k: string): BlockScore => {
    const v = diag[k] as BlockScore | null
    return v && typeof v === 'object' ? v : EMPTY_BLOCK
  }
  return {
    overall_score: (diag.overall_score as number) ?? 0,
    health_index: (diag.health_index as number) ?? 0,
    stage: ((diag.stage as PointA['stage']) ?? 'seed'),
    blocks: {
      finance: block('finance_score'),
      marketing: block('marketing_score'),
      operations: block('operations_score'),
      strategy: block('strategy_score'),
      sales: block('sales_score'),
    },
    risks: (diag.risks as PointA['risks']) ?? [],
    insights: (diag.insights as PointA['insights']) ?? [],
    quick_wins: (diag.quick_wins as PointA['quick_wins']) ?? [],
    data_gaps: (diag.data_gaps as PointA['data_gaps']) ?? [],
  }
}

function mapGriTop5(raw: unknown): PointBOptions['griTop5'] {
  if (!Array.isArray(raw)) return undefined
  return raw
    .map((item, i) => {
      if (!item || typeof item !== 'object') return null
      const o = item as Record<string, unknown>
      const title = String(o.title ?? o.label ?? o.name ?? o.criterion ?? '').trim()
      if (!title) return null
      return {
        rank: typeof o.rank === 'number' ? o.rank : i + 1,
        title,
        block: String(o.block ?? o.section ?? o.sectionId ?? ''),
        severity: String(o.severity ?? o.level ?? 'high'),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const viewer = await requireExpert()
  if (!viewer) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  const clientId = params.id
  if (!clientId) return NextResponse.json({ ok: false, error: 'client id required' }, { status: 400 })

  const diagRows = await srGet<Array<Record<string, unknown>>>(
    `diagnostics?user_id=eq.${clientId}&is_current=eq.true&select=*&limit=1`,
  )
  const diag = diagRows?.[0] ?? null
  if (!diag) return NextResponse.json({ ok: true, data: null, reason: 'no_diagnostic' })

  const surveyRows = await srGet<Array<{ question_key: string; answer: unknown }>>(
    `survey_answers?user_id=eq.${clientId}&select=question_key,answer`,
  )
  const answers: Record<string, unknown> = {}
  for (const row of surveyRows ?? []) {
    const a = row.answer as { value?: unknown } | unknown
    answers[row.question_key] = a && typeof a === 'object' && 'value' in a ? (a as { value?: unknown }).value : a
  }

  const griRows = await srGet<Array<{ top_5_limits: unknown }>>(
    `gri_assessments?user_id=eq.${clientId}&is_current=eq.true&select=top_5_limits&limit=1`,
  )
  const griTop5 = mapGriTop5(griRows?.[0]?.top_5_limits)

  let currentRevenueYear: number | null = null
  const companyId = (diag.company_id as string | null) ?? null
  if (companyId) {
    const revRows = await srGet<Array<{ metric_value: number }>>(
      `metrics?company_id=eq.${encodeURIComponent(companyId)}&metric_key=eq.revenue&metric_value=gt.0&select=metric_value&order=period_year.desc&limit=1`,
    )
    const v = revRows?.[0]?.metric_value
    if (v != null && Number.isFinite(Number(v))) currentRevenueYear = Number(v)
  }

  // Goals from the Point A widget (companies.target_*) — canonical, in sync with Точка А.
  let goal12mYear: number | null = null
  let goal3yYear: number | null = null
  const compRows = await srGet<Array<{ target_revenue_12m_kzt: number | null; target_revenue_3y_kzt: number | null }>>(
    `companies?user_id=eq.${clientId}&select=target_revenue_12m_kzt,target_revenue_3y_kzt&limit=1`,
  )
  const comp = compRows?.[0]
  if (comp?.target_revenue_12m_kzt != null && Number.isFinite(Number(comp.target_revenue_12m_kzt))) goal12mYear = Number(comp.target_revenue_12m_kzt)
  if (comp?.target_revenue_3y_kzt != null && Number.isFinite(Number(comp.target_revenue_3y_kzt))) goal3yYear = Number(comp.target_revenue_3y_kzt)

  const pointB = calculatePointBV2(diagToPointA(diag), answers, {
    diagnosticId: diag.id as string,
    griTop5,
    currentRevenueYear,
    goal12mYear,
    goal3yYear,
  })

  return NextResponse.json({ ok: true, data: pointB })
}
