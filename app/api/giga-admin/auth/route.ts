export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { signGigaCookie, GIGA_COOKIE_NAME, GIGA_COOKIE_OPTIONS } from '@/lib/giga-auth'

/**
 * POST /api/giga-admin/auth
 * Verifies the shared GIGA_ADMIN_PASSWORD and, on success, sets a SIGNED,
 * httpOnly cookie that cannot be forged client-side. (Previously this set a
 * plain, JS-readable `aistart360_role=super_admin` cookie — a trivial bypass.)
 */
export async function POST(req: NextRequest) {
  const { password } = (await req.json()) as { password?: string }

  const adminPassword = process.env.GIGA_ADMIN_PASSWORD
  if (!adminPassword) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  if (!password || password !== adminPassword) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const token = await signGigaCookie()
  if (!token) {
    // No signing secret configured on the server.
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(GIGA_COOKIE_NAME, token, GIGA_COOKIE_OPTIONS)
  return response
}
