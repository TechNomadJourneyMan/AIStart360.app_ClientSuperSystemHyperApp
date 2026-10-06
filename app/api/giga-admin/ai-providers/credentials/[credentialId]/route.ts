import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { providerErrorResponse, readBody, toProviderActor } from '@/lib/admin/ai-providers-http'
import { deleteCredential, updateCredential } from '@/lib/ai/providers/service'

export const dynamic = 'force-dynamic'

type Ctx = { params: { credentialId: string } }

const Patch = z.object({
  label: z.string().optional(),
  enabled: z.boolean({ invalid_type_error: 'enabled — true или false' }).optional(),
}).passthrough().superRefine((v, ctx) => {
  if ('secret' in v) ctx.addIssue({ code: 'custom', path: ['secret'], message: 'ключ меняется только через «Сменить ключ» (rotate)' })
  const extra = Object.keys(v).filter((k) => k !== 'label' && k !== 'enabled' && k !== 'secret')
  if (extra.length) ctx.addIssue({ code: 'custom', path: [extra[0]], message: 'неизвестное поле' })
})

/** PATCH /api/giga-admin/ai-providers/credentials/:credentialId — label / enabled. settings.manage. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'settings.manage')
  if (g.response) return g.response
  const body = await readBody(req, Patch)
  if (!body.ok) return body.response
  try {
    const credential = await updateCredential(toProviderActor(g.actor, req), params.credentialId, {
      ...(body.data.label !== undefined ? { label: body.data.label } : {}),
      ...(body.data.enabled !== undefined ? { enabled: body.data.enabled } : {}),
    })
    return NextResponse.json({ ok: true, credential })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/credentials/[id]', err)
  }
}

/** DELETE /api/giga-admin/ai-providers/credentials/:credentialId — remove a key. settings.manage. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'settings.manage')
  if (g.response) return g.response
  try {
    await deleteCredential(toProviderActor(g.actor, req), params.credentialId)
    return NextResponse.json({ ok: true, deleted: true })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/credentials/[id]', err)
  }
}
