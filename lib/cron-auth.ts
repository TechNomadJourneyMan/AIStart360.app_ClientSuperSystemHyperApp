import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'

/**
 * Authorise a scheduler call: `Authorization: Bearer <CRON_SECRET>` only
 * (Vercel Cron sends exactly this). Constant-time compare; fails closed when
 * the secret is not configured. Secrets in query strings end up in access
 * logs, so they are not accepted here.
 */
export function isAuthorizedCron(req: NextRequest | Request): { ok: true } | { ok: false; status: 401 | 503 } {
  const secret = process.env.CRON_SECRET
  if (!secret) return { ok: false, status: 503 }
  const header = req.headers.get('authorization') ?? ''
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(header)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, status: 401 }
  }
  return { ok: true }
}
