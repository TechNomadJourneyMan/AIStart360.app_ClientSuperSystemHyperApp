import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { providerErrorResponse, readBody, toProviderActor } from '@/lib/admin/ai-providers-http'
import { rotateCredential } from '@/lib/ai/providers/service'

export const dynamic = 'force-dynamic'

type Ctx = { params: { credentialId: string } }

const Body = z.object({
  secret: z.string({ required_error: 'введите новый ключ', invalid_type_error: 'ключ — строка' }),
}).strict()

/**
 * POST /api/giga-admin/ai-providers/credentials/:credentialId/rotate — replace
 * the secret of a key (label, models and routes stay). Response: masked only.
 * settings.manage.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'settings.manage')
  if (g.response) return g.response
  const body = await readBody(req, Body)
  if (!body.ok) return body.response
  try {
    const credential = await rotateCredential(toProviderActor(g.actor, req), params.credentialId, body.data.secret)
    return NextResponse.json({ ok: true, credential })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/credentials/rotate', err, [body.data.secret])
  }
}
