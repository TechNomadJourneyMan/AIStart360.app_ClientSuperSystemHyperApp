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
  const widgets: string[] = body.widgets ?? []

  // TODO: Persist to DB — e.g. prisma.user.update({ where: { id }, data: { widgetConfig: widgets } })
  // Requires adding a `widgetConfig Json?` field to the User model.

  return NextResponse.json({ success: true, userId: id, widgets })
}
