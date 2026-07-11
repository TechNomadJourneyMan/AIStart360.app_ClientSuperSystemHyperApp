export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authRateLimit } from '@/lib/rate-limit'
import { signGigaRole, GIGA_COOKIE_NAME } from '@/lib/giga-cookie'
import { logAudit } from '@/lib/audit'

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
    // Failed break-glass attempts are security signal — audit them (R6: the
    // panel's highest-privilege auth previously left no trail at all).
    await logAudit({
      entityType: 'system',
      entityId: 'giga_panel',
      action: 'admin.login_failed',
      performedBy: 'giga:anonymous',
      diff: { after: { method: 'break_glass_password' } },
      ipAddress: ip,
    })
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  // Successful shared-password entry = break-glass. Personal super_admin
  // Supabase sessions are the preferred path (lib/admin/giga-actor.ts) and are
  // attributable per action; this login is only attributable to the password
  // holder pool, so the event itself must be on record.
  await logAudit({
    entityType: 'system',
    entityId: 'giga_panel',
    action: 'admin.login',
    performedBy: 'giga:super_admin',
    diff: { after: { method: 'break_glass_password' } },
    ipAddress: ip,
  })

  const response = NextResponse.json({ ok: true })
  // A2b: set an HMAC-SIGNED giga token in a DEDICATED cookie (aistart360_giga).
  // We do NOT reuse the overloaded `aistart360_role` cookie (which carries
  // normal-user roles) — see lib/giga-cookie.ts for the naming rationale.
  response.cookies.set(GIGA_COOKIE_NAME, signGigaRole('super_admin'), {
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    sameSite: 'lax',
    httpOnly: true, // server-only — nothing reads this client-side
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}

/**
 * DELETE /api/giga-admin/auth — giga logout: clears the break-glass cookie.
 * (Personal Supabase sessions sign out through the normal auth flow.)
 */
export async function DELETE(req: NextRequest) {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(GIGA_COOKIE_NAME, '', { path: '/', maxAge: 0 })
  await logAudit({
    entityType: 'system',
    entityId: 'giga_panel',
    action: 'admin.logout',
    performedBy: 'giga:super_admin',
    diff: { after: { method: 'break_glass_cookie_cleared' } },
    ipAddress: clientIp(req),
  })
  return response
}
