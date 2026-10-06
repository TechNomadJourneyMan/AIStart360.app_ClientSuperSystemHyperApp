/**
 * GET /api/giga-admin/integrations/companies?q= — company picker of the GIGA
 * integrations page (users.view): id and name only.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { searchCompanies } from '@/lib/integrations/store'
import { serverError } from '@/lib/integrations/route-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response
  try {
    const items = await searchCompanies(req.nextUrl.searchParams.get('q') ?? '')
    return NextResponse.json({ ok: true, data: { items } })
  } catch (err) {
    return serverError('giga-admin/integrations/companies', err)
  }
}
