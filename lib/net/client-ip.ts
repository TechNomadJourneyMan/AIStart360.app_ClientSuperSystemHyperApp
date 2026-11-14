/**
 * lib/net/client-ip.ts — the visitor's IP address, taken only from headers our own proxies set (R-049).
 *
 * The portal runs behind Railway's edge proxy (and, historically, Vercel's). A client can send any
 * `X-Forwarded-For` it likes; a proxy APPENDS the address it saw to the right of it. So the LEFTMOST
 * entry is attacker-controlled and must never key a rate limit, a geo lookup or an audit record.
 *
 * Order:
 *   1. `X-Real-IP` — Railway's edge sets it to the client's remote IP ("X-Real-IP for identifying
 *      client's remote IP", docs.railway.com → Networking → Specs & Limits); Vercel's edge sets it too.
 *      One address only; anything else in it is ignored.
 *   2. `X-Forwarded-For` — the entry `TRUSTED_PROXY_HOPS` positions from the right (default 1: the
 *      address our single trusted proxy appended). With fewer entries than hops, the leftmost one.
 *   3. null — no usable address. Callers that need a key use `clientIpOrUnknown`.
 *
 * `TRUSTED_PROXY_HOPS=0` means "no proxy in front of us": forwarding headers are not trusted at all
 * (every request is 'unknown'; use it only when the app is reachable directly, which it is not today).
 *
 * Edge-safe: no node: imports, so middleware may use it as well.
 */

type HeaderBag = { get(name: string): string | null }

const DEFAULT_HOPS = 1
const MAX_HOPS = 10
const MAX_LEN = 64

/** Number of trusted proxies that append to X-Forwarded-For (env TRUSTED_PROXY_HOPS, default 1, max 10). */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const raw = env.TRUSTED_PROXY_HOPS?.trim()
  if (!raw) return DEFAULT_HOPS
  if (!/^\d+$/.test(raw)) return DEFAULT_HOPS
  return Math.min(MAX_HOPS, Number(raw))
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

function isIpv6(s: string): boolean {
  if (!s.includes(':') || !/^[0-9a-f:.]+$/.test(s)) return false
  const doubles = s.split('::').length - 1
  if (doubles > 1) return false
  const groups = s.split(':')
  // An embedded IPv4 tail (::ffff:1.2.3.4) counts as two groups.
  const last = groups[groups.length - 1]
  if (last.includes('.') && !IPV4.test(last)) return false
  const count = groups.filter((g) => g !== '').length + (last.includes('.') ? 1 : 0)
  if (doubles === 0 && count !== 8) return false
  if (count > 8) return false
  return groups.every((g) => g === '' || g.includes('.') || /^[0-9a-f]{1,4}$/.test(g))
}

/**
 * One header entry → a bare, lower-cased IP address, or null. Whitespace, an IPv4 `:port`, IPv6
 * brackets (with or without a port) and an IPv6 zone id are dropped.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s || s.length > MAX_LEN) return null
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s)
  if (bracketed) s = bracketed[1]
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(':'))
  s = s.replace(/%.*$/, '').toLowerCase()
  if (IPV4.test(s)) return s
  return isIpv6(s) ? s : null
}

/** The trusted client IP from request headers, or null. */
export function clientIpFromHeaders(
  h: HeaderBag | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!h) return null
  const hops = trustedProxyHops(env)
  if (hops === 0) return null

  const real = normalizeIp(h.get('x-real-ip'))
  if (real) return real

  const xff = h.get('x-forwarded-for')
  if (!xff) return null
  const entries = xff.split(',').map((e) => e.trim()).filter(Boolean)
  if (!entries.length) return null
  return normalizeIp(entries[Math.max(0, entries.length - hops)])
}

/** clientIpFromHeaders for a Request. */
export function clientIp(req: { headers: HeaderBag } | null | undefined): string | null {
  return clientIpFromHeaders(req?.headers)
}

/** Same, with 'unknown' instead of null — for rate-limit keys. */
export function clientIpOrUnknown(req: { headers: HeaderBag } | null | undefined): string {
  return clientIp(req) ?? 'unknown'
}
