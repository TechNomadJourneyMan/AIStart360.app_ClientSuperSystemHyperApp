/**
 * POST /api/integrations/:provider/test — «Проверить»: one documented read
 * call with the stored key. A rejected key (401) marks the connection
 * needs_reauth. Needs manage access (it uses the company's credentials).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { authorizeClient, providerParam, serverError, unknownProvider } from '@/lib/integrations/route-auth'
import { testIntegration } from '@/lib/integrations/service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { provider: string } }) {
  const provider = providerParam(params.provider)
  if (!provider) return unknownProvider()
  const auth = await authorizeClient(req, 'manage')
  if (!auth.ok) return auth.response
  const limit = await checkRateLimit(auth.tenant.userId, 'integrations-test', { max: 10, windowMs: 10 * 60_000 })
  if (limit.limited) return rateLimitResponse(limit)
  try {
    const res = await testIntegration({ companyId: auth.tenant.companyId, provider })
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error, kind: res.kind ?? null }, { status: res.status })
    return NextResponse.json({ ok: true, data: res.data })
  } catch (err) {
    return serverError('api/integrations test', err)
  }
}
