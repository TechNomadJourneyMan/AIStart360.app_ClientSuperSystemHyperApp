export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authRateLimit } from '@/lib/rate-limit'

// Brute-force protection for the single shared super-admin password.
// Uses Upstash when configured; otherwise a small in-memory fallback so the
// endpoint is never completely unprotected. See audit A2.
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 8
const memHits = new Map<string, { count: number; resetAt: number }>()

function memoryLimited(ip: string): boolean {
  const now = Date.now()
  const cur = memHits.get(ip)
  if (!cur || cur.resetAt < now) {
    memHits.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  cur.count += 1
  return cur.count > MAX_ATTEMPTS
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  // Rate limit before any password comparison.
  if (authRateLimit) {
    const { success } = await authRateLimit.limit(`giga-auth:${ip}`)
    if (!success) {
      return NextResponse.json({ error: 'Too many attempts' }, { status: 429 })
    }
  } else if (memoryLimited(ip)) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 })
  }

  const { password } = (await req.json()) as { password?: string }

  const adminPassword = process.env.GIGA_ADMIN_PASSWORD
  if (!adminPassword) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  if (!password || password !== adminPassword) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set('aistart360_role', 'super_admin', {
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    sameSite: 'lax',
    httpOnly: true, // server-only — nothing reads this client-side
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}
