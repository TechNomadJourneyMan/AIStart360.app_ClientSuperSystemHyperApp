export const dynamic = 'force-dynamic'

// GET /api/gri/baseline?userId=<id>
// Returns a client's REAL current GRI from the 62-criteria assessment
// (gri_assessments) so the GRI forecast calculator (/ai-scanner) is anchored to
// the same data the GRI test produced — instead of a disconnected score.
// Expert/admin/super_admin only (service-role read).

import { NextRequest, NextResponse } from 'next/server'
import { requireExpert, srGet } from '@/lib/expert-auth'

export async function GET(req: NextRequest) {
  const viewer = await requireExpert()
  if (!viewer) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  const userId = req.nextUrl.searchParams.get('userId')
  if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 })

  const rows = await srGet<Array<{ gri_index: number | null; section_avgs: unknown; top_5_limits: unknown }>>(
    `gri_assessments?user_id=eq.${encodeURIComponent(userId)}&is_current=eq.true&select=gri_index,section_avgs,top_5_limits&limit=1`,
  )
  const a = rows?.[0]
  if (!a) return NextResponse.json({ ok: true, data: { has_assessment: false } })

  const idx = Number(a.gri_index)
  return NextResponse.json({
    ok: true,
    data: {
      has_assessment: true,
      gri_index: Number.isFinite(idx) ? idx : null, // 0–10 scale (same as the test)
      section_avgs: a.section_avgs ?? {},
      top_5_limits: Array.isArray(a.top_5_limits) ? a.top_5_limits : [],
    },
  })
}
