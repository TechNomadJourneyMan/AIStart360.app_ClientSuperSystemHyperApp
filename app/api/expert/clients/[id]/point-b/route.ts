export const dynamic = 'force-dynamic'

// GET /api/expert/clients/[id]/point-b
// Goal-driven Point B for a specific client, for the expert/admin viewer.
// Reads via service role (RLS bypass) through the SAME loader as the client's own
// page (lib/point-b/inputs.ts), so the expert sees the numbers the client sees.
// Read-only: computes on the fly, does not persist (the client's own page owns persistence).
// An expert reaches only the clients assigned to them (guardExpertClient).

import { NextResponse } from 'next/server'
import { expertBlockResponse, guardExpertClient, resolveExpert } from '@/lib/expert-auth'
import { createServiceClient } from '@/lib/supabase-service'
import { loadPointBInputs } from '@/lib/point-b/inputs'
import { computePointB } from '@/lib/point-b/compute'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)

  const clientId = params.id
  if (!clientId) return NextResponse.json({ ok: false, error: 'client id required' }, { status: 400 })
  const denied = await guardExpertClient(auth.viewer, clientId)
  if (denied) return denied

  try {
    const inputs = await loadPointBInputs(createServiceClient(), clientId)
    const pointB = computePointB(inputs)
    if (!pointB) return NextResponse.json({ ok: true, data: null, reason: 'no_diagnostic' })
    return NextResponse.json({ ok: true, data: pointB })
  } catch (error) {
    console.error('[expert/point-b] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
