export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { authRateLimit } from '@/lib/rate-limit'
import {
  signGigaRole,
  GIGA_COOKIE_NAME,
  GIGA_TOKEN_MAX_AGE_SECONDS,
} from '@/lib/giga-cookie'
import { logAudit } from '@/lib/audit'

// Brute-force protection for the single shared super-admin password.
// Uses Upstash when configured; otherwise a small in-memory fallback so the
// endpoint is never completely unprotected. See audit A2.
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 8
const MAX_MEMORY_RATE_LIMIT_KEYS = 10_000
const MAX_AUTH_BODY_BYTES = 2_048
const MAX_PASSWORD_CHARACTERS = 512
const MAX_PASSWORD_UTF8_BYTES = 1_024
const memHits = new Map<string, { count: number; resetAt: number }>()

function memoryLimited(ip: string): boolean {
  const now = Date.now()
  const cur = memHits.get(ip)
  if (!cur || cur.resetAt <= now) {
    if (!cur && memHits.size >= MAX_MEMORY_RATE_LIMIT_KEYS) {
      for (const [key, entry] of memHits) {
        if (entry.resetAt <= now) memHits.delete(key)
      }
      // Under a high-cardinality flood, fail closed instead of letting the
      // process-local fallback map grow without bound.
      if (memHits.size >= MAX_MEMORY_RATE_LIMIT_KEYS) return true
    }
    memHits.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  cur.count += 1
  return cur.count > MAX_ATTEMPTS
}

function clientIp(req: NextRequest): string {
  const value = (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  ).trim()
  return value.length > 0 && value.length <= 64 ? value : 'unknown'
}

type PasswordBodyResult =
  | { ok: true; password: string }
  | { ok: false; status: 400 | 413 | 415; error: string }

async function readPasswordBody(req: NextRequest): Promise<PasswordBodyResult> {
  const contentType = req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    return { ok: false, status: 415, error: 'Content-Type must be application/json' }
  }

  const declaredLength = req.headers.get('content-length')
  if (declaredLength !== null) {
    if (!/^\d{1,10}$/.test(declaredLength)) {
      return { ok: false, status: 400, error: 'Invalid request' }
    }
    if (Number(declaredLength) > MAX_AUTH_BODY_BYTES) {
      return { ok: false, status: 413, error: 'Payload too large' }
    }
  }

  const reader = req.body?.getReader()
  if (!reader) return { ok: false, status: 400, error: 'Invalid request' }

  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    byteLength += value.byteLength
    if (byteLength > MAX_AUTH_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      return { ok: false, status: 413, error: 'Payload too large' }
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  let parsed: unknown
  try {
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    parsed = JSON.parse(body)
  } catch {
    return { ok: false, status: 400, error: 'Invalid request' }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: 'Invalid request' }
  }
  const keys = Object.keys(parsed)
  if (keys.length !== 1 || keys[0] !== 'password') {
    return { ok: false, status: 400, error: 'Invalid request' }
  }

  const password = (parsed as { password?: unknown }).password
  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > MAX_PASSWORD_CHARACTERS ||
    new TextEncoder().encode(password).byteLength > MAX_PASSWORD_UTF8_BYTES
  ) {
    return { ok: false, status: 400, error: 'Invalid request' }
  }

  return { ok: true, password }
}

/** Compare fixed-size SHA-256 digests with Node's constant-time primitive. */
function passwordMatches(candidate: string, expected: string): boolean {
  const candidateDigest = createHash('sha256').update(candidate, 'utf8').digest()
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(candidateDigest, expectedDigest)
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

  const body = await readPasswordBody(req)
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status })
  }

  const adminPassword = process.env.GIGA_ADMIN_PASSWORD
  if (
    !adminPassword ||
    adminPassword.length > MAX_PASSWORD_CHARACTERS ||
    new TextEncoder().encode(adminPassword).byteLength > MAX_PASSWORD_UTF8_BYTES
  ) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  if (!passwordMatches(body.password, adminPassword)) {
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
    maxAge: GIGA_TOKEN_MAX_AGE_SECONDS,
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
