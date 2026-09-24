export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { STAFF_ROLE_LABELS } from '@/lib/admin/rbac'

// GET /api/giga-admin/me — who is using the panel and what they may do.
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'dashboard.view')
  if (guard.response) return guard.response
  const a = guard.actor
  return NextResponse.json({
    ok: true,
    data: { id: a.id, kind: a.kind, email: a.email ?? null, role: a.role, roleLabel: STAFF_ROLE_LABELS[a.role], permissions: a.permissions, clientScope: a.clientScope ?? 'all' },
  })
}
