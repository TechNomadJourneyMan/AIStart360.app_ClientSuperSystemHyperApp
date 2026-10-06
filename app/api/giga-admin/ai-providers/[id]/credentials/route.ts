import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { providerErrorResponse, readBody, toProviderActor } from '@/lib/admin/ai-providers-http'
import { addCredential } from '@/lib/ai/providers/service'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

const Body = z.object({
  label: z.string({ required_error: 'укажите название', invalid_type_error: 'название — строка' }),
  secret: z.string({ required_error: 'введите ключ', invalid_type_error: 'ключ — строка' }),
}).strict()

/**
 * POST /api/giga-admin/ai-providers/:id/credentials — add an API key. The
 * secret is accepted only here and in «rotate»; it is encrypted by the service
 * and the response carries only the masked view («••••abcd»). settings.manage.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'settings.manage')
  if (g.response) return g.response
  const body = await readBody(req, Body)
  if (!body.ok) return body.response
  try {
    const credential = await addCredential(toProviderActor(g.actor, req), params.id, body.data.label, body.data.secret)
    return NextResponse.json({ ok: true, credential }, { status: 201 })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/credentials', err, [body.data.secret])
  }
}
