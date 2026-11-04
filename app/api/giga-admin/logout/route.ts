export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { GIGA_COOKIE_NAME } from '@/lib/giga-auth'

/**
 * POST /api/giga-admin/logout
 * Clears the signed giga super-admin cookie (and the legacy role cookie).
 */
export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(GIGA_COOKIE_NAME, '', { path: '/', maxAge: 0 })
  response.cookies.set('aistart360_role', '', { path: '/', maxAge: 0 })
  return response
}
