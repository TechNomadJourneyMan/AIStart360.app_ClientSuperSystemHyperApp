export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { STAFF_ROLE_LABELS } from '@/lib/admin/rbac'

// GET /api/giga-admin/me — who is using the panel and what they may do.
// While a Super Admin views the panel «как роль» (Dev-tools), role and
// permissions are the viewed role's; `realRole` and `viewAs` say so.
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'dashboard.view')
  if (guard.response) return guard.response
  const a = guard.actor
  const realRole = a.realRole ?? a.role
  return NextResponse.json({
    ok: true,
    data: {
      id: a.id, kind: a.kind, email: a.email ?? null, role: a.role, roleLabel: STAFF_ROLE_LABELS[a.role], permissions: a.permissions, clientScope: a.clientScope ?? 'all',
      realRole,
      realRoleLabel: STAFF_ROLE_LABELS[realRole],
      viewAs: a.viewAs ? { role: a.viewAs, label: STAFF_ROLE_LABELS[a.viewAs] } : null,
    },
  })
}
