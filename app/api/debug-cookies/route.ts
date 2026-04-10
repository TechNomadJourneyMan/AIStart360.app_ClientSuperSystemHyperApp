export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = cookies()

  const allCookies = cookieStore.getAll().map(c => ({
    name: c.name,
    value: c.name.includes('secret') || c.name.includes('token')
      ? c.value.substring(0, 8) + '...'
      : c.value,
  }))

  const userId = cookieStore.get('aistart360_user_id')?.value ?? null
  const role = cookieStore.get('aistart360_role')?.value ?? null

  return NextResponse.json({
    userId,
    role,
    cookieCount: allCookies.length,
    cookieNames: allCookies.map(c => c.name),
    cookies: allCookies,
  })
}
