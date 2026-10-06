/**
 * POST /api/giga-admin/integrations/:companyId/:provider/test — «Проверить»
 * with the stored key (company.edit, audited).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { auditUnavailable, checkCompany } from '@/lib/integrations/giga'
import { providerParam, serverError, unknownProvider } from '@/lib/integrations/route-auth'
import { testIntegration } from '@/lib/integrations/service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { companyId: string; provider: string } }) {
  const guard = await requireGiga(req, 'company.edit')
  if (guard.response) return guard.response
  const provider = providerParam(params.provider)
  if (!provider) return unknownProvider()
  const bad = await checkCompany(params.companyId)
  if (bad) return bad
  try {
    const audited = await recordAdminAction(guard.actor, {
      action: 'integration.test', entityType: 'company', entityId: params.companyId, metadata: { provider },
    }, req, { required: true })
    if (!audited) return auditUnavailable()
    const res = await testIntegration({ companyId: params.companyId, provider })
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error, kind: res.kind ?? null }, { status: res.status })
    return NextResponse.json({ ok: true, data: res.data })
  } catch (err) {
    return serverError('giga-admin/integrations test', err)
  }
}
