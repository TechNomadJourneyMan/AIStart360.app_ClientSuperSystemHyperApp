/**
 * lib/dev/dev-request.ts — dev mode (lib/dev/dev-access.ts) for server code
 * that may not hold the request object. Node / server only: it reads
 * next/headers, so middleware keeps importing dev-access.ts directly.
 *
 * Used by the API-side second-factor gate (staffMfaGate in
 * lib/admin/giga-actor.ts), which the GIGA API calls with the request and the
 * expert portal API and the MCP consent page call without one.
 */
import { cookies, headers } from 'next/headers'
import { devAccessConfigured, devModeOnForRequest, type DevAccessRequest } from './dev-access'

/**
 * Dev mode for the request being served — the decision middleware takes for a
 * page. Always `false` in a production build.
 *
 * Without a request object the headers and cookies come from next/headers.
 * They do not say where the server listens (`request.nextUrl.host`), so here
 * the Host header — what the browser asked for — stands in for it; the flag,
 * the platform variables, X-Forwarded-Host and the cookie are checked as usual.
 */
export function devModeOnForServerRequest(request?: DevAccessRequest): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (request) return devModeOnForRequest(request)
  if (!devAccessConfigured()) return false
  try {
    const requestHeaders = headers()
    // The method is unknown here. It only matters to the dev routes, which must
    // not be posted to from another site — and they hold the request.
    return devModeOnForRequest({
      method: 'GET',
      nextUrl: { host: requestHeaders.get('host') ?? '' },
      headers: requestHeaders,
      cookies: cookies(),
    })
  } catch {
    // Not inside a request (a background job, a script): no dev mode.
    return false
  }
}
