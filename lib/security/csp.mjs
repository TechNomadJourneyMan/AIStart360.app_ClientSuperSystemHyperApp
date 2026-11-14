/**
 * lib/security/csp.mjs — Content-Security-Policy and next/image remote patterns, built from env
 * (R-013, R-135). Plain ESM so next.config.mjs can import it; pure, so it is unit-tested.
 *
 * Why: the policy used to hard-code `https://*.supabase.co` (which also lets an injected script send
 * data to ANY cloud Supabase project) and the local Vite dev server for «Рынок», while production
 * runs on self-hosted Supabase (https://supabase.aistart360.app) — the browser client and Realtime
 * (wss:) were simply not allowed. Now:
 *   - Supabase: exactly the origin of NEXT_PUBLIC_SUPABASE_URL, plus its ws(s):// twin for Realtime;
 *     no wildcard. media-src and images.remotePatterns use the same origin.
 *   - «Рынок» (NEXT_PUBLIC_MARKET_APP_URL): in a production build only when set and not a loopback
 *     host; in development the local Vite default (http://localhost:5173) as before.
 *   - Anything missing or invalid becomes a warning; next.config.mjs prints them at build time.
 *
 * `script-src 'unsafe-inline'` stays: Next 14.2 injects inline bootstrap scripts without a nonce
 * unless every page is rendered dynamically with a per-request nonce from middleware (see
 * docs/deploy/csp.md for the estimate).
 */

const DEV_MARKET_ORIGIN = 'http://localhost:5173'
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0'])

/**
 * Origin (scheme://host[:port]) of an http(s) URL, or null.
 * @param {string | undefined | null} raw
 * @returns {URL | null}
 */
function parseHttpUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.username || u.password) return null
    return u
  } catch {
    return null
  }
}

/** @param {URL} u */
function isLoopback(u) {
  const h = u.hostname.toLowerCase()
  return LOOPBACK_HOSTS.has(h) || h.endsWith('.localhost') || /^127\./.test(h)
}

/**
 * @typedef {{
 *   NEXT_PUBLIC_SUPABASE_URL?: string,
 *   NEXT_PUBLIC_MARKET_APP_URL?: string,
 *   NODE_ENV?: string,
 * }} CspEnv
 *
 * @typedef {{ protocol: 'http' | 'https', hostname: string, port: string, pathname?: string }} RemotePattern
 *
 * @typedef {{
 *   csp: string,
 *   supabaseOrigin: string | null,
 *   supabaseRealtimeOrigin: string | null,
 *   marketOrigin: string | null,
 *   remotePatterns: RemotePattern[],
 *   warnings: string[],
 * }} SecurityConfig
 */

/**
 * @param {CspEnv} env
 * @returns {SecurityConfig}
 */
export function buildSecurityConfig(env) {
  const nodeEnv = env.NODE_ENV
  const isDev = nodeEnv === 'development'
  const isProdBuild = nodeEnv === 'production'
  /** @type {string[]} */
  const warnings = []

  // ── Supabase ────────────────────────────────────────────────────────────
  const sb = parseHttpUrl(env.NEXT_PUBLIC_SUPABASE_URL)
  /** @type {string | null} */
  let supabaseOrigin = null
  /** @type {string | null} */
  let supabaseRealtimeOrigin = null
  if (!sb) {
    warnings.push(
      env.NEXT_PUBLIC_SUPABASE_URL
        ? 'NEXT_PUBLIC_SUPABASE_URL is not a valid http(s) URL — CSP has no Supabase origin; the browser Supabase client and Realtime will be blocked.'
        : 'NEXT_PUBLIC_SUPABASE_URL is not set at build time — CSP has no Supabase origin; the browser Supabase client and Realtime will be blocked.',
    )
  } else {
    supabaseOrigin = sb.origin
    supabaseRealtimeOrigin = `${sb.protocol === 'https:' ? 'wss:' : 'ws:'}//${sb.host}`
    if (isProdBuild && sb.protocol !== 'https:' && !isLoopback(sb)) {
      warnings.push(`NEXT_PUBLIC_SUPABASE_URL uses plain http (${sb.origin}) in a production build.`)
    }
  }

  // ── «Рынок» (Mark-analytics) ────────────────────────────────────────────
  /** @type {string | null} */
  let marketOrigin = null
  const market = parseHttpUrl(env.NEXT_PUBLIC_MARKET_APP_URL)
  if (env.NEXT_PUBLIC_MARKET_APP_URL && !market) {
    warnings.push('NEXT_PUBLIC_MARKET_APP_URL is not a valid http(s) URL — not added to CSP.')
  }
  if (market) {
    if (isProdBuild && isLoopback(market)) {
      warnings.push(`NEXT_PUBLIC_MARKET_APP_URL points at a loopback host (${market.origin}) in a production build — not added to CSP.`)
    } else {
      marketOrigin = market.origin
    }
  } else if (!isProdBuild) {
    marketOrigin = DEV_MARKET_ORIGIN
  }

  // ── Policy ──────────────────────────────────────────────────────────────
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'"

  const join = (/** @type {Array<string | null>} */ parts) => parts.filter(Boolean).join(' ')

  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com",
    // Content pages (GIGA-CRM CMS) may show images from any https host.
    "img-src 'self' data: https:",
    // Video files uploaded to the cms-media bucket of OUR Supabase.
    join(["media-src 'self'", supabaseOrigin]),
    // Supabase REST/Auth/Storage + Realtime; Next's font loader; «Рынок» availability probe.
    join([
      "connect-src 'self'",
      supabaseOrigin,
      supabaseRealtimeOrigin,
      'https://fonts.googleapis.com https://fonts.gstatic.com',
      marketOrigin,
    ]),
    // «Рынок» iframe, YouTube (privacy-enhanced) and Vimeo embeds in content pages.
    join(["frame-src 'self'", marketOrigin, 'https://www.youtube-nocookie.com https://player.vimeo.com']),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ')

  /** @type {RemotePattern[]} */
  const remotePatterns = []
  if (sb) {
    remotePatterns.push({
      protocol: sb.protocol === 'https:' ? 'https' : 'http',
      hostname: sb.hostname,
      port: sb.port,
    })
  }
  remotePatterns.push({ protocol: 'https', hostname: 'lh3.googleusercontent.com', port: '' })

  return { csp, supabaseOrigin, supabaseRealtimeOrigin, marketOrigin, remotePatterns, warnings }
}

/**
 * Print build/start-time warnings loudly (once per process).
 * @param {string[]} warnings
 * @param {(msg: string) => void} [log]
 */
export function reportSecurityConfigWarnings(warnings, log = console.warn) {
  if (!warnings.length) return
  const bar = '!'.repeat(78)
  log([bar, '[next.config] CSP / security config WARNINGS:', ...warnings.map((w) => `  - ${w}`), bar].join('\n'))
}
