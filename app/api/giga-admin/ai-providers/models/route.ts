import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { providerErrorResponse, readBody, toProviderActor } from '@/lib/admin/ai-providers-http'
import { modelInputSchema, upsertModel } from '@/lib/ai/providers/service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/giga-admin/ai-providers/models — add or update a model of a
 * provider (unique by provider + model id + capability): bound key, prices per
 * 1M tokens, enabled. settings.manage.
 */
export async function POST(req: NextRequest) {
  const g = await requireGiga(req, 'settings.manage')
  if (g.response) return g.response
  const body = await readBody(req, modelInputSchema)
  if (!body.ok) return body.response
  try {
    const model = await upsertModel(toProviderActor(g.actor, req), body.data)
    return NextResponse.json({ ok: true, model })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/models', err)
  }
}
