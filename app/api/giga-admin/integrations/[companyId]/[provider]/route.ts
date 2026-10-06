/**
 * /api/giga-admin/integrations/:companyId/:provider — staff connect (POST)
 * and disconnect (DELETE) a client's integration. company.edit; the action
 * is audited before it runs; keys are checked with the provider, stored only
 * encrypted and never written to the audit log.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { auditUnavailable, checkCompany } from '@/lib/integrations/giga'
import { providerParam, serverError, unknownProvider } from '@/lib/integrations/route-auth'
import { connectIntegration, disconnectIntegration } from '@/lib/integrations/service'

export const dynamic = 'force-dynamic'

type Params = { params: { companyId: string; provider: string } }

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireGiga(req, 'company.edit')
  if (guard.response) return guard.response
  const provider = providerParam(params.provider)
  if (!provider) return unknownProvider()
  const bad = await checkCompany(params.companyId)
  if (bad) return bad
  const body = (await req.json().catch(() => null)) as { fields?: unknown } | null
  try {
    const audited = await recordAdminAction(guard.actor, {
      action: 'integration.connect', entityType: 'company', entityId: params.companyId,
      metadata: { provider },
    }, req, { required: true })
    if (!audited) return auditUnavailable()
    const res = await connectIntegration({ companyId: params.companyId, provider, fields: body?.fields ?? {}, actorId: guard.actor.id })
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error, field: res.field ?? null, kind: res.kind ?? null }, { status: res.status })
    return NextResponse.json({ ok: true, data: res.data }, { status: 201 })
  } catch (err) {
    return serverError('giga-admin/integrations POST', err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await requireGiga(req, 'company.edit')
  if (guard.response) return guard.response
  const provider = providerParam(params.provider)
  if (!provider) return unknownProvider()
  const bad = await checkCompany(params.companyId)
  if (bad) return bad
  try {
    const audited = await recordAdminAction(guard.actor, {
      action: 'integration.disconnect', entityType: 'company', entityId: params.companyId, metadata: { provider },
    }, req, { required: true })
    if (!audited) return auditUnavailable()
    const res = await disconnectIntegration({ companyId: params.companyId, provider })
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status })
    return NextResponse.json({ ok: true, data: res.data })
  } catch (err) {
    return serverError('giga-admin/integrations DELETE', err)
  }
}
