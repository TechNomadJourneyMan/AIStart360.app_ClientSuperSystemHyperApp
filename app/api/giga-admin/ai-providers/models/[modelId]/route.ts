import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { providerErrorResponse, toProviderActor } from '@/lib/admin/ai-providers-http'
import { deleteModel } from '@/lib/ai/providers/service'

export const dynamic = 'force-dynamic'

type Ctx = { params: { modelId: string } }

/** DELETE /api/giga-admin/ai-providers/models/:modelId — the model and the routes pointing at it. settings.manage. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'settings.manage')
  if (g.response) return g.response
  try {
    await deleteModel(toProviderActor(g.actor, req), params.modelId)
    return NextResponse.json({ ok: true, deleted: true })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/models/[id]', err)
  }
}
