/**
 * /api/integrations — e-commerce integrations of the caller's company (W7).
 *
 *   GET   catalogue of providers (live / exports only, where the key comes
 *         from, BLOCKED reasons) + the company's connections. Never returns a
 *         credential: secrets are encrypted at rest and not selectable.
 *   POST  { provider, fields } — connect. Live providers: the key is checked
 *         with a documented read call BEFORE it is stored (encrypted);
 *         providers without a live adapter: a record «данные выгрузками».
 *
 * Reading needs company read access, connecting needs manage access
 * (owner / company admin) — lib/integrations/route-auth.ts.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { authorizeClient, providerParam, serverError, unknownProvider } from '@/lib/integrations/route-auth'
import { companyIntegrations, connectIntegration } from '@/lib/integrations/service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await authorizeClient(req, 'read')
  if (!auth.ok) return auth.response
  try {
    const data = await companyIntegrations(auth.tenant.companyId)
    return NextResponse.json({ ok: true, data: { ...data, companyId: auth.tenant.companyId, canManage: auth.tenant.canManage } })
  } catch (err) {
    return serverError('api/integrations GET', err)
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorizeClient(req, 'manage')
  if (!auth.ok) return auth.response
  const body = (await req.json().catch(() => null)) as { provider?: unknown; fields?: unknown } | null
  const provider = providerParam(typeof body?.provider === 'string' ? body.provider : '')
  if (!provider) return unknownProvider()
  // Every connect calls the provider: bounded per person.
  const limit = await checkRateLimit(auth.tenant.userId, 'integrations-connect', { max: 10, windowMs: 10 * 60_000 })
  if (limit.limited) return rateLimitResponse(limit)
  try {
    const res = await connectIntegration({ companyId: auth.tenant.companyId, provider, fields: body?.fields ?? {}, actorId: auth.tenant.userId })
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error, field: res.field ?? null, kind: res.kind ?? null }, { status: res.status })
    return NextResponse.json({ ok: true, data: res.data }, { status: 201 })
  } catch (err) {
    return serverError('api/integrations POST', err)
  }
}
