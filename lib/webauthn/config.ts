/**
 * WebAuthn relying-party config. In prod set `NEXT_PUBLIC_APP_ORIGIN` (e.g.
 * https://aistart360.app) — `rpID` is derived from its hostname and
 * `expectedOrigin` must match the browser's origin exactly. Falls back to the
 * request's Origin header in dev (http://localhost:3000).
 */
export interface WebAuthnConfig {
  rpID: string
  rpName: string
  origin: string
}

export function getWebAuthnConfig(req?: Request): WebAuthnConfig {
  const envOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.AUTH_URL
  let origin = (envOrigin || req?.headers.get('origin') || 'http://localhost:3000').replace(/\/$/, '')

  let rpID = process.env.WEBAUTHN_RP_ID || ''
  if (!rpID) {
    try {
      rpID = new URL(origin).hostname
    } catch {
      rpID = 'localhost'
      origin = 'http://localhost:3000'
    }
  }

  return { rpID, rpName: 'AIStart360', origin }
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
