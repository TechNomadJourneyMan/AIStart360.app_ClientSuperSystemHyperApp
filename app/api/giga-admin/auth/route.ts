export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { password } = await req.json() as { password: string }

  const adminPassword = process.env.GIGA_ADMIN_PASSWORD
  if (!adminPassword) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  if (password !== adminPassword) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set('aistart360_role', 'super_admin', {
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    sameSite: 'lax',
    httpOnly: false, // must be readable by JS (GigaSidebar re-pins it)
  })
  return response
}
