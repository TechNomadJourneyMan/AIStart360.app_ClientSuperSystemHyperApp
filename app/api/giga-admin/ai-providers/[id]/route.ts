import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { providerErrorResponse, readBody, toProviderActor } from '@/lib/admin/ai-providers-http'
import { deleteProvider, getProvider, providerPatchSchema, updateProvider } from '@/lib/ai/providers/service'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

/** GET /api/giga-admin/ai-providers/:id — one provider (id or key), keys masked. agents.view. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  try {
    const provider = await getProvider(params.id)
    if (!provider) return NextResponse.json({ ok: false, error: 'провайдер не найден', code: 'NOT_FOUND' }, { status: 404 })
    return NextResponse.json({ ok: true, provider })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/[id]', err)
  }
}

/** PATCH /api/giga-admin/ai-providers/:id — change provider settings. settings.manage. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'settings.manage')
  if (g.response) return g.response
  const body = await readBody(req, providerPatchSchema)
  if (!body.ok) return body.response
  try {
    const provider = await updateProvider(toProviderActor(g.actor, req), params.id, body.data)
    return NextResponse.json({ ok: true, provider })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/[id]', err)
  }
}

/** DELETE /api/giga-admin/ai-providers/:id — provider with its keys, models and routes. settings.manage. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'settings.manage')
  if (g.response) return g.response
  try {
    await deleteProvider(toProviderActor(g.actor, req), params.id)
    return NextResponse.json({ ok: true, deleted: true })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/[id]', err)
  }
}
