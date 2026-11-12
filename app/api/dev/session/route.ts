export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { isStaffRole, type StaffRole } from '@/lib/admin/rbac'
import { devAccessEnabledForRequest, devModeOnForRequest, devNotFound } from '@/lib/dev/dev-access'
import { DEV_ROLES, DEV_ROLE_LABELS } from '@/lib/dev/dev-accounts'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/dev/session — what the developer panel (components/dev/DevPanel)
 * shows: whether dev mode is on, the roles one can enter as and who is signed
 * in. Dev-only: 404 unless lib/dev/dev-access.ts allows the request, and in a
 * production build that guard is the constant `false`.
 */

interface CurrentAccount {
  email: string | null
  role: string | null
  staffRole: StaffRole | null
}

/**
 * The signed-in account, read with its own session: a profile row and a
 * staff_roles row are readable by their owner, so showing the panel needs no
 * service-role key. Any failure reads as "nobody".
 */
async function currentAccount(): Promise<CurrentAccount | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const [profile, staff] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
      supabase.from('staff_roles').select('role').eq('user_id', user.id).maybeSingle(),
    ])
    const role = (profile.data as { role?: unknown } | null)?.role
    const staffRole = (staff.data as { role?: unknown } | null)?.role
    return {
      email: user.email ?? null,
      role: typeof role === 'string' ? role : null,
      staffRole: isStaffRole(staffRole) ? staffRole : null,
    }
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  if (!devAccessEnabledForRequest(request)) return devNotFound()

  return NextResponse.json({
    enabled: true,
    devMode: devModeOnForRequest(request),
    roles: DEV_ROLES.map((role) => ({ role, label: DEV_ROLE_LABELS[role] })),
    current: await currentAccount(),
  })
}

// Any other method: there is no such route (Next.js would answer 405 / 204).
export { devNotFound as POST, devNotFound as PUT, devNotFound as PATCH, devNotFound as DELETE, devNotFound as OPTIONS }
