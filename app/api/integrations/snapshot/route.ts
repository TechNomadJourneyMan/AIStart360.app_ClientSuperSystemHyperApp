/**
 * GET /api/integrations/snapshot — what the e-commerce dashboard shows from
 * connected integrations: the connections, the per-provider summary of the
 * last 30 complete days (lib/integrations/signals.ts — the same rules that
 * feed the metrics) and the current values of the integration-fed metrics
 * from public.metrics (lib/metrics/company-metrics.ts, the single source).
 * Facts and metrics are read with the caller's session (RLS).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { authorizeClient, serverError } from '@/lib/integrations/route-auth'
import { integrationsSnapshot } from '@/lib/integrations/service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await authorizeClient(req, 'read')
  if (!auth.ok) return auth.response
  try {
    const data = await integrationsSnapshot(auth.supabase, auth.tenant.companyId)
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    return serverError('api/integrations/snapshot', err)
  }
}
