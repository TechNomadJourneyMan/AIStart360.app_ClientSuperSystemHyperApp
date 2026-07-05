/**
 * WebAuthn relying-party config.
 *
 * Priority for `expectedOrigin` (what the browser actually is on):
 *   1. request `Origin` header — auto-adapts when the portal is served on
 *      multiple domains (portal.aistart360.app AND the raw *.vercel.app).
 *      Origin is set by the browser and is not spoofable by page JS.
 *   2. `NEXT_PUBLIC_APP_ORIGIN` (or comma-separated list) as env fallback.
 *   3. `AUTH_URL` / `NEXTAUTH_URL` as further fallback.
 *   4. `http://localhost:3000` for dev without any of the above.
 *
 * `rpID` (which domain the passkey is bound to):
 *   - `WEBAUTHN_RP_ID` env wins if set — recommended for prod (set it to the
 *     eTLD+1, e.g. `aistart360.app`, so passkeys work across subdomains).
 *   - Otherwise derived from the origin hostname.
 *
 * Trade-off: without `WEBAUTHN_RP_ID`, a passkey registered on domain A won't
 * verify on domain B. Setting it explicitly to the apex fixes multi-subdomain
 * setups; setting it to a specific host locks passkeys to that host.
 */
export interface WebAuthnConfig {
  rpID: string
  rpName: string
  /** The origin the browser is currently on (single value for simplewebauthn). */
  origin: string
  /** All origins the RP considers valid (multi-domain support). */
  expectedOrigins: string[]
}

function envOrigins(): string[] {
  const raw = [
    process.env.NEXT_PUBLIC_APP_ORIGIN,
    process.env.AUTH_URL,
    process.env.NEXTAUTH_URL,
  ]
    .filter(Boolean)
    .flatMap((v) => (v as string).split(','))
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
  return Array.from(new Set(raw))
}

export function getWebAuthnConfig(req?: Request): WebAuthnConfig {
  const reqOrigin = req?.headers.get('origin')?.replace(/\/$/, '') ?? ''
  const envs = envOrigins()

  // Prefer the browser's actual Origin — makes multi-domain deploys "just work"
  // as long as the user is on a domain the RP considers valid.
  const origin = reqOrigin || envs[0] || 'http://localhost:3000'

  // The full set of accepted origins (dedup, request first).
  const expectedOrigins = Array.from(new Set([origin, ...envs].filter(Boolean)))

  let rpID = process.env.WEBAUTHN_RP_ID || ''
  if (!rpID) {
    try {
      rpID = new URL(origin).hostname
    } catch {
      rpID = 'localhost'
    }
  }

  return { rpID, rpName: 'AIStart360', origin, expectedOrigins }
}

/** Friendly default name for a newly-registered passkey, from the User-Agent. */
export function deviceLabelFromRequest(req?: Request): string {
  const ua = req?.headers.get('user-agent') ?? ''
  const os = /Mac/i.test(ua) ? 'Mac' : /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/i.test(ua) ? 'iOS' : /Linux/i.test(ua) ? 'Linux' : 'Устройство'
  const br = /Edg/i.test(ua) ? 'Edge' : /Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox'
    : /Safari/i.test(ua) ? 'Safari' : ''
  return br ? `${os} · ${br}` : os
}
