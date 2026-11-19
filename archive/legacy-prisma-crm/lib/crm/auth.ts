import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

/**
 * Auth guard for the CRM routes.
 *
 * Previously these used lib/api-utils.requireAuth() → NextAuth `auth()`, which
 * is always null (no NextAuth sign-in exists), so every CRM call returned 401
 * and the Settings → Integrations tab silently never worked. This resolves the
 * caller from the Supabase session instead (real 401 for anonymous requests,
 * important because middleware does NOT guard /api/*).
 *
 * CRM integrations are Prisma-org-scoped (`crmIntegration.orgId`), and there is
 * no Supabase-user → Prisma-org bridge, so `orgId` is null: callers then return
 * the handled 403 "No organization" state (Settings shows "обратитесь к
 * администратору"). Wire the bridge here if staff orgs are introduced.
 */
export async function requireCrmOrg(): Promise<
  | { userId: string; orgId: string | null; error: null }
  | { userId: null; orgId: null; error: NextResponse }
> {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user?.id) {
    return { userId: null, orgId: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { userId: user.id, orgId: null, error: null }
}
