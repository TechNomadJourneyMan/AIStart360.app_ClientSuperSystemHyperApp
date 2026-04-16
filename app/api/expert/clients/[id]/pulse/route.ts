export const dynamic = 'force-dynamic'

// GET /api/expert/clients/[id]/pulse
// Per-client pulse metrics for the expert Pulse tab. Reads from the client's
// current diagnostic row (ai_analysis.pulse if present) and falls back to
// nulls so the UI still renders and the expert can leave comments.

import { NextResponse } from 'next/server'
import { requireExpert, srGet } from '@/lib/expert-auth'

interface PulseMetrics {
  avgCheck: number | null
  volumeChange: number | null
  riskScore: number | null
  churnProb: number | null
  daysSince: number | null
  lastOrderAt: string | null
  orderCycle: number | null
  action: string | null
}

function emptyMetrics(): PulseMetrics {
  return {
    avgCheck: null,
    volumeChange: null,
    riskScore: null,
    churnProb: null,
    daysSince: null,
    lastOrderAt: null,
    orderCycle: null,
    action: null,
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const viewer = await requireExpert()
  if (!viewer) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const clientId = params.id
  const metrics = emptyMetrics()

  const diagRows = await srGet<
    Array<{
      ai_analysis: { pulse?: Partial<PulseMetrics> } | null
      overall_score: number | null
      updated_at: string | null
    }>
  >(`diagnostics?user_id=eq.${clientId}&is_current=eq.true&select=ai_analysis,overall_score,updated_at&limit=1`)

  const diag = diagRows?.[0] ?? null
  const pulseBlock = diag?.ai_analysis?.pulse ?? null

  // Explicit metrics take priority
  if (pulseBlock) {
    const bag = metrics as unknown as Record<string, unknown>
    for (const k of Object.keys(metrics) as Array<keyof PulseMetrics>) {
      const v = pulseBlock[k]
      if (v !== undefined && v !== null) {
        bag[k] = v
      }
    }
  }

  // Derive a basic riskScore from overall score if nothing explicit
  if (metrics.riskScore === null && typeof diag?.overall_score === 'number') {
    const normalised = diag.overall_score > 100 ? diag.overall_score / 10 : diag.overall_score
    metrics.riskScore = Math.max(0, Math.min(100, 100 - normalised))
  }

  // Days-since from last diagnostic update
  if (metrics.daysSince === null && diag?.updated_at) {
    const d = new Date(diag.updated_at).getTime()
    if (!Number.isNaN(d)) metrics.daysSince = Math.floor((Date.now() - d) / 86_400_000)
    metrics.lastOrderAt = metrics.lastOrderAt ?? diag.updated_at
  }

  return NextResponse.json({ ok: true, data: metrics })
}
