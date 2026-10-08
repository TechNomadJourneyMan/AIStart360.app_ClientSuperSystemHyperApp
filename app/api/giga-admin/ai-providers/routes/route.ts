import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { providerErrorResponse, readBody, toProviderActor } from '@/lib/admin/ai-providers-http'
import { listRoutes, setRoute } from '@/lib/ai/providers/service'
import { ALL_CAPABILITIES, CHAT_TIERS } from '@/lib/ai/providers/types'

export const dynamic = 'force-dynamic'

/** GET /api/giga-admin/ai-providers/routes — capability (+ chat tier) → model. agents.view. */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  try {
    return NextResponse.json({ ok: true, routes: await listRoutes() })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/routes', err)
  }
}

const Body = z.object({
  capability: z.enum(ALL_CAPABILITIES, { errorMap: () => ({ message: 'возможность: chat, embeddings, rerank, ocr или transcribe' }) }),
  tier: z.enum(CHAT_TIERS, { errorMap: () => ({ message: 'уровень: light, standard или premium' }) }).nullable().default(null),
  /** null = remove the route (back to the built-in OpenRouter fallback). */
  modelRowId: z.string().nullable(),
}).strict()

/** PUT /api/giga-admin/ai-providers/routes — set one route or reset it (modelRowId null). settings.manage. */
export async function PUT(req: NextRequest) {
  const g = await requireGiga(req, 'settings.manage')
  if (g.response) return g.response
  const body = await readBody(req, Body)
  if (!body.ok) return body.response
  try {
    const route = await setRoute(toProviderActor(g.actor, req), body.data.capability, body.data.tier, body.data.modelRowId)
    return NextResponse.json({ ok: true, route, routes: await listRoutes() })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/routes', err)
  }
}
