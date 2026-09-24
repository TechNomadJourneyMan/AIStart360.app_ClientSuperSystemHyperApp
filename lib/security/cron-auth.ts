import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Cron / machine-to-machine auth: `Authorization: Bearer <secret>` ONLY.
 *
 * The secret is never accepted from the query string (it would end up in
 * access logs and Vercel request logs — audit S19). Comparison is constant
 * time: both sides are hashed first so their lengths never leak either.
 * Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically.
 */
export function bearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice('Bearer '.length).trim()
  return token || null
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

export function safeSecretEquals(expected: string, actual: string | null): boolean {
  if (!expected || !actual) return false
  return timingSafeEqual(digest(expected), digest(actual))
}

/** True when the bearer token matches any of the configured (non-empty) secrets. */
export function isBearerAuthorized(req: Request, secrets: Array<string | null | undefined>): boolean {
  const token = bearerToken(req)
  if (!token) return false
  let ok = false
  for (const s of secrets) {
    if (s && safeSecretEquals(s, token)) ok = true
  }
  return ok
}
