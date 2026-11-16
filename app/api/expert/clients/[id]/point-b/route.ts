export const dynamic = 'force-dynamic'

// GET /api/expert/clients/[id]/point-b
// Point B of a client for the expert / admin viewer — R3 (M3): the client's own page state
// (lib/point-b/model/load.ts loadPointBState: the model + the APPROVED plan version only), in the
// envelope of GET /api/v1/point-b/state, so the expert sees exactly what the client sees (not V2).
// Reads via service role after the scope check; read-only.
// An expert reaches only the clients assigned to them (guardExpertClient).

import { NextResponse } from 'next/server'
import { expertBlockResponse, guardExpertClient, resolveExpert } from '@/lib/expert-auth'
import { createServiceClient } from '@/lib/supabase-service'
import { loadPointBState } from '@/lib/point-b/model/load'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)

  const clientId = params.id
  if (!clientId) return NextResponse.json({ ok: false, error: 'client id required' }, { status: 400 })
  const denied = await guardExpertClient(auth.viewer, clientId)
  if (denied) return denied

  try {
    return NextResponse.json({ ok: true, data: await loadPointBState(createServiceClient(), clientId) })
  } catch (error) {
    console.error('[expert/point-b] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
