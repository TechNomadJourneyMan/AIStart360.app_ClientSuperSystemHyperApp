/**
 * DELETE /api/integrations/:provider — disconnect: the stored credentials are
 * deleted at once (the connection row stays as «disconnected» so the history
 * and the facts already synced remain; an exports-only record is removed).
 * Needs manage access to the company.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { authorizeClient, providerParam, serverError, unknownProvider } from '@/lib/integrations/route-auth'
import { disconnectIntegration } from '@/lib/integrations/service'

export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest, { params }: { params: { provider: string } }) {
  const provider = providerParam(params.provider)
  if (!provider) return unknownProvider()
  const auth = await authorizeClient(req, 'manage')
  if (!auth.ok) return auth.response
  try {
    const res = await disconnectIntegration({ companyId: auth.tenant.companyId, provider })
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status })
    return NextResponse.json({ ok: true, data: res.data })
  } catch (err) {
    return serverError('api/integrations DELETE', err)
  }
}
