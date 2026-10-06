export const dynamic = 'force-dynamic'

// GET /api/expert/clients/[id]/pulse
// Per-client pulse metrics for the expert Pulse tab: what a source reported
// under the current diagnostic's ai_analysis.pulse, otherwise nulls (the UI
// renders «—» and the expert can still leave comments).

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
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return NextResponse.json({ error: 'bad id' }, { status: 400 })
  const metrics = emptyMetrics()

  const diagRows = await srGet<Array<{ ai_analysis: { pulse?: Partial<PulseMetrics> } | null }>>(
    `diagnostics?user_id=eq.${clientId}&is_current=eq.true&select=ai_analysis&limit=1`,
  )
  const pulseBlock = diagRows?.[0]?.ai_analysis?.pulse ?? null

  // Only metrics a source actually reported. Nothing is derived from the
  // Point A score or the diagnostic date: «риск-скор» is not «100 − индекс»,
  // and the diagnostic date is not «последний заказ».
  if (pulseBlock) {
    const bag = metrics as unknown as Record<string, unknown>
    for (const k of Object.keys(metrics) as Array<keyof PulseMetrics>) {
      const v = pulseBlock[k]
      if (v !== undefined && v !== null) bag[k] = v
    }
  }

  return NextResponse.json({ ok: true, data: metrics })
}
