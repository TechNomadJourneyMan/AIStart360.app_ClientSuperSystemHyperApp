import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { providerErrorResponse, readBody, toProviderActor } from '@/lib/admin/ai-providers-http'
import { discoverModels } from '@/lib/ai/providers/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const Body = z.object({
  /** One key; else every key of `providerId`; else every enabled key. */
  credentialId: z.string().uuid('ожидается UUID').nullable().optional(),
  providerId: z.string().uuid('ожидается UUID').nullable().optional(),
}).strict()

/**
 * POST /api/giga-admin/ai-providers/discover — «Обнаружить модели»: GET /models
 * with the key(s), new models are added (source = discovered), the owner's
 * models are not changed (lib/ai/providers/discovery.ts). A key whose provider
 * has no /models is a normal 200 answer with ok = false for that key.
 * settings.manage; audited (ai.models.discover).
 */
export async function POST(req: NextRequest) {
  const g = await requireGiga(req, 'settings.manage')
  if (g.response) return g.response
  const body = await readBody(req, Body)
  if (!body.ok) return body.response
  try {
    const results = await discoverModels(toProviderActor(g.actor, req), {
      credentialId: body.data.credentialId ?? null,
      providerId: body.data.providerId ?? null,
    })
    return NextResponse.json({ ok: true, results })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/discover', err)
  }
}
