export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { auth } from '@/lib/auth'

/**
 * GET /api/v1/me
 * Returns current user's ID from any auth source:
 * 1. Staff httpOnly cookie (aistart360_user_id)
 * 2. GigaAccessGuard role cookie (aistart360_role) → synthetic ID
 * 3. NextAuth / Supabase session
 */
export async function GET() {
  const cookieStore = await cookies()

  // Priority 1: staff login via Prisma (httpOnly cookie)
  const staffUserId = cookieStore.get('aistart360_user_id')?.value
  if (staffUserId) {
    return NextResponse.json({ userId: staffUserId, source: 'staff' })
  }

  // Priority 2: GigaAccessGuard super_admin (non-httpOnly role cookie)
  const staffRole = cookieStore.get('aistart360_role')?.value
  if (staffRole) {
    return NextResponse.json({ userId: `giga-${staffRole}`, source: 'giga' })
  }

  // Priority 3: NextAuth / Supabase session
  try {
    const session = await auth()
    if (session?.user?.id) {
      return NextResponse.json({ userId: session.user.id, source: 'session' })
    }
  } catch {
    // ignore auth errors
  }

  return NextResponse.json({ userId: null, source: null })
}
