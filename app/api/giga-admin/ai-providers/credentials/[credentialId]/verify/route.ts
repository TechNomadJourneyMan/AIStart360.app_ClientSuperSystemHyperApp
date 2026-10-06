import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { providerErrorResponse, toProviderActor } from '@/lib/admin/ai-providers-http'
import { verifyCredential } from '@/lib/ai/providers/service'

export const dynamic = 'force-dynamic'

type Ctx = { params: { credentialId: string } }

/**
 * POST /api/giga-admin/ai-providers/credentials/:credentialId/verify — a
 * minimal real call with the key (1-token chat, one embedding or GET /models);
 * the outcome is stored on the key. A failed check is a normal 200 answer with
 * result.ok = false and a sanitised error. settings.manage (it spends money).
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'settings.manage')
  if (g.response) return g.response
  try {
    const result = await verifyCredential(toProviderActor(g.actor, req), params.credentialId)
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/credentials/verify', err)
  }
}
