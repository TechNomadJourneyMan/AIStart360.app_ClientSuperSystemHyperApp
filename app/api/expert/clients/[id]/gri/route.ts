export const dynamic = 'force-dynamic'

// GET /api/expert/clients/[id]/gri
// Returns the latest GRI report for the specified client (7 category scores
// + total). Data comes from Prisma `gri_reports` table. If no report exists,
// returns default scores so the GRI tab can still render commentable items.

import { NextResponse } from 'next/server'
import { requireExpert, srGet } from '@/lib/expert-auth'
import { CATEGORIES, DEFAULT_SCORES } from '@/lib/gri-calculator/gri-data'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const viewer = await requireExpert()
  if (!viewer) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const clientId = params.id

  // Derive GRI category scores from the diagnostics row. The client's
  // current diagnostic holds the 5 Point A block scores; we extrapolate
  // per-GRI-category scores from `diagnostic.ai_analysis.gri` if present,
  // otherwise fall back to default seed scores so the UI still renders.
  const diagRows = await srGet<
    Array<{ ai_analysis: { gri?: { overall?: number; categoryScores?: Record<string, number> } } | null; updated_at: string }>
  >(`diagnostics?user_id=eq.${clientId}&is_current=eq.true&select=ai_analysis,updated_at&limit=1`)

  const diag = diagRows?.[0] ?? null
  const griBlock = diag?.ai_analysis?.gri ?? null

  const categoryScores: Record<string, number> = { ...DEFAULT_SCORES }
  for (const cat of CATEGORIES) {
    const v = griBlock?.categoryScores?.[cat]
    if (typeof v === 'number') categoryScores[cat] = v
  }

  return NextResponse.json({
    ok: true,
    data: {
      reportId: null,
      overall: typeof griBlock?.overall === 'number' ? griBlock.overall : 0,
      categoryScores,
      lastCalculatedAt: diag?.updated_at ?? null,
    },
  })
}
