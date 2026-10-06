export const dynamic = 'force-dynamic'

// GET /api/expert/clients/[id]/gri
// The client's latest GRI assessment for the expert GRI tab: the 7 category
// scores (0–10) and the overall index, from gri_assessments (the current
// assessment first). A category without an answer is null, and a client
// without any assessment gets nulls and hasAssessment=false — the tab still
// renders every category so the expert can comment, but no score is invented.
// (It used to read diagnostics.ai_analysis.gri, which nothing writes, and
// fell back to fixed sample scores shown as the client's.)

import { NextResponse } from 'next/server'
import { requireExpert, srGet } from '@/lib/expert-auth'
import { CATEGORIES } from '@/lib/gri-calculator/gri-data'

/** Expert tab category → gri_assessments.section_avgs key. */
const GRI_SECTION_BY_CATEGORY: Readonly<Record<(typeof CATEGORIES)[number], string>> = {
  'Product & Demand': 'product-demand',
  'Trust & Positioning': 'trust-positioning',
  'Business Model': 'business-model',
  'Cash Stability': 'cash-stability',
  'Operations': 'operations',
  'Team': 'team',
  'Founder Ready': 'owner-readiness',
}

interface AssessmentRow {
  gri_index: number | string | null
  section_avgs: Record<string, unknown> | null
  updated_at: string | null
  created_at: string | null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const viewer = await requireExpert()
  if (!viewer) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const clientId = params.id
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return NextResponse.json({ error: 'bad id' }, { status: 400 })

  const rows = await srGet<AssessmentRow[]>(
    `gri_assessments?user_id=eq.${clientId}&select=gri_index,section_avgs,updated_at,created_at&order=is_current.desc,created_at.desc&limit=1`,
  )
  const a = rows?.[0] ?? null

  const categoryScores: Record<string, number | null> = {}
  for (const cat of CATEGORIES) categoryScores[cat] = num(a?.section_avgs?.[GRI_SECTION_BY_CATEGORY[cat]])

  return NextResponse.json({
    ok: true,
    data: {
      reportId: null,
      hasAssessment: Boolean(a),
      overall: num(a?.gri_index),
      categoryScores,
      lastCalculatedAt: a ? a.updated_at ?? a.created_at : null,
    },
  })
}
