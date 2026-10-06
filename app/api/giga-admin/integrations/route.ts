/**
 * GET /api/giga-admin/integrations[?companyId=] — every company's integration
 * connections for staff (users.view): status, last sync, sanitised errors;
 * never a credential. Plus the provider catalogue (live / BLOCKED).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { providerCatalog } from '@/lib/integrations/registry'
import { credentialsStorageReady } from '@/lib/integrations/credentials'
import { listConnectionsForStaff } from '@/lib/integrations/store'
import { serverError } from '@/lib/integrations/route-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response
  const companyId = req.nextUrl.searchParams.get('companyId')
  if (companyId && !/^[A-Za-z0-9_-]{1,64}$/.test(companyId)) return NextResponse.json({ ok: false, error: 'Неверный идентификатор компании' }, { status: 400 })
  try {
    const items = await listConnectionsForStaff({ companyId, limit: 300 })
    return NextResponse.json({
      ok: true,
      data: { items, catalog: providerCatalog(), encryptionReady: credentialsStorageReady(), canEdit: guard.actor.permissions.includes('company.edit') },
    })
  } catch (err) {
    return serverError('giga-admin/integrations GET', err)
  }
}
