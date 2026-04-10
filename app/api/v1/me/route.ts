export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { auth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/v1/me
 * Returns current user's ID from any auth source:
 * 1. Staff httpOnly cookie (aistart360_user_id)
 * 2. Supabase Auth session (Google OAuth / email login)
 * 3. NextAuth session
 * 4. GigaAccessGuard role cookie (aistart360_role) → synthetic ID
 */
export async function GET() {
  const cookieStore = await cookies()

  // Priority 1: staff login via Prisma (httpOnly cookie)
  const staffUserId = cookieStore.get('aistart360_user_id')?.value
  if (staffUserId) {
    return NextResponse.json({ userId: staffUserId, source: 'staff' })
  }

  // Priority 2: Supabase Auth session
  try {
    const supabase = await createClient()
    const { data: { user: sbUser } } = await supabase.auth.getUser()
    if (sbUser?.id) {
      return NextResponse.json({ userId: sbUser.id, source: 'supabase' })
    }
  } catch {
    // Supabase auth not available
  }

  // Priority 3: NextAuth session
  try {
    const session = await auth()
    if (session?.user?.id) {
      return NextResponse.json({ userId: session.user.id, source: 'nextauth' })
    }
  } catch {
    // ignore auth errors
  }

  // Priority 4: GigaAccessGuard role cookie fallback
  const staffRole = cookieStore.get('aistart360_role')?.value
  if (staffRole) {
    return NextResponse.json({ userId: `giga-${staffRole}`, source: 'giga' })
  }

  return NextResponse.json({ userId: null, source: null })
}
