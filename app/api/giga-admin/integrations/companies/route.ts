/**
 * GET /api/giga-admin/integrations/companies?q= — company picker of the GIGA
 * integrations page (users.view): id and name only.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { filterByScope, scopedCompanyIds } from '@/lib/admin/client-scope'
import { searchCompanies } from '@/lib/integrations/store'
import { serverError } from '@/lib/integrations/route-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response
  try {
    // Client scope 'assigned' (R-047): the actor's clients' companies only.
    const items = filterByScope(await searchCompanies(req.nextUrl.searchParams.get('q') ?? ''), await scopedCompanyIds(guard.actor), (i) => i.id)
    return NextResponse.json({ ok: true, data: { items } })
  } catch (err) {
    return serverError('giga-admin/integrations/companies', err)
  }
}
