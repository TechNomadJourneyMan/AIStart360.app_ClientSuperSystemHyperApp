/**
 * POST /api/giga-admin/integrations/:companyId/:provider/sync — run one
 * synchronisation now (same engine and limits as the integration_sync agent)
 * and recalculate the company's metrics when new facts arrived.
 * company.edit, audited.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { auditUnavailable, checkCompany } from '@/lib/integrations/giga'
import { providerParam, serverError, unknownProvider } from '@/lib/integrations/route-auth'
import { getConnection } from '@/lib/integrations/store'
import { syncConnectionNow } from '@/lib/integrations/sync'
import { refreshCompanyMetrics } from '@/lib/agents/definitions/integration-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: { companyId: string; provider: string } }) {
  const guard = await requireGiga(req, 'company.edit')
  if (guard.response) return guard.response
  const provider = providerParam(params.provider)
  if (!provider) return unknownProvider()
  const bad = await checkCompany(params.companyId)
  if (bad) return bad
  try {
    const conn = await getConnection(params.companyId, provider)
    if (!conn) return NextResponse.json({ ok: false, error: 'Интеграция не подключена' }, { status: 404 })
    const audited = await recordAdminAction(guard.actor, {
      action: 'integration.sync', entityType: 'company', entityId: params.companyId, metadata: { provider },
    }, req, { required: true })
    if (!audited) return auditUnavailable()
    const outcome = await syncConnectionNow(conn.id, { deadlineAt: Date.now() + 40_000 })
    if (!outcome) return NextResponse.json({ ok: false, error: 'Синхронизация уже идёт или подключение неактивно' }, { status: 409 })
    let metricsWritten: number | null = null
    if (outcome.status === 'synced' && outcome.factsWritten > 0) {
      metricsWritten = (await refreshCompanyMetrics(params.companyId)).written
    }
    const { connectionId, status, factsWritten, errorKind, message } = outcome
    return NextResponse.json({ ok: true, data: { connectionId, status, factsWritten, errorKind: errorKind ?? null, message: message ?? null, metricsWritten } })
  } catch (err) {
    return serverError('giga-admin/integrations sync', err)
  }
}
