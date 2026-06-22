export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { GIGA_COOKIE_NAME, verifyGigaRole } from '@/lib/giga-cookie'

// A2b: verify the HMAC-SIGNED giga cookie, not an unsigned static string.
function isSuperAdmin(req: NextRequest): boolean {
  return verifyGigaRole(req.cookies.get(GIGA_COOKIE_NAME)?.value) === 'super_admin'
}

/**
 * POST /api/giga-admin/users/:id/widgets
 * Body: { widgets: string[] }
 *
 * Saves the admin-configured widget visibility for a user.
 * In production: store in a UserPreferences table or JSON column on User.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = params
  const body = await req.json()
  const widgets: string[] = Array.isArray(body.widgets) ? body.widgets : []

  // Persist to profiles.widget_config via the Supabase service-role REST API.
  // The giga panel's users come from `profiles` (Supabase), not Prisma `users`,
  // so we PATCH the profile row by id. REST (not Prisma) keeps this off the
  // pgBouncer pooler, consistent with lib/share/tokens.ts.
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) {
    return NextResponse.json({ error: 'Persistence not configured' }, { status: 500 })
  }
  try {
    const res = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ widget_config: widgets }),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[giga-admin/widgets] persist failed', res.status, await res.text().catch(() => ''))
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }
  } catch (err) {
    console.error('[giga-admin/widgets] persist error', err)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }

  return NextResponse.json({ success: true, userId: id, widgets })
}
