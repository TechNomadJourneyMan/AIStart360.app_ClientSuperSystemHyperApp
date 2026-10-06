/**
 * lib/mcp/consent.ts — who may approve an OAuth authorization request, and
 * what the approval grants. Shared by the consent page
 * (app/oauth/consent/[id]) and the decision route (POST
 * /api/oauth/authorize/decision), which re-checks everything.
 *
 * Requirements (owner decision + MCP Authorization):
 *   - a personal Supabase session (login);
 *   - the panel's second-factor rule (lib/admin/giga-actor.ts staffMfaGate):
 *     enrolled → the signed step-up cookie of THIS user; not enrolled → only
 *     when the platform requires 2FA for staff;
 *   - staff (RBAC) or an expert; scopes = requested ∩ what the role allows;
 *   - the redirect host is shown to the person; a loopback redirect gets a
 *     warning («Client ID Metadata Document Security» — localhost
 *     impersonation; the same applies to dynamically registered clients).
 */
import type { User } from '@supabase/supabase-js'
import { staffMfaGate } from '@/lib/admin/giga-actor'
import { getPendingAuthRequest, grantableScopes, type AuthRequestRow } from './oauth'
import { resolveMcpPrincipal, type McpPrincipal } from './principal'
import { MCP_SCOPES, type McpScope } from './scopes'

export type ConsentState =
  | { kind: 'invalid' }
  | { kind: 'login' }
  | { kind: 'step_up' }
  | { kind: 'enroll' }
  | { kind: 'forbidden' }
  | { kind: 'unavailable' }
  | {
      kind: 'ready'
      request: AuthRequestRow
      principal: McpPrincipal
      /** Scopes the approval grants. Empty → the person can only deny. */
      grant: McpScope[]
      /** Requested scopes the person's role does not allow (shown as «не будет выдано»). */
      withheld: McpScope[]
      redirectHost: string
      loopback: boolean
    }

type SessionUser = Pick<User, 'id' | 'app_metadata' | 'user_metadata'>

export async function consentState(requestId: string, user: SessionUser | null, stepUpCookie: string | null | undefined): Promise<ConsentState> {
  let request: AuthRequestRow | null
  try {
    request = await getPendingAuthRequest(requestId)
  } catch {
    return { kind: 'unavailable' }
  }
  if (!request) return { kind: 'invalid' }
  if (!user) return { kind: 'login' }

  let principal: McpPrincipal | null
  try {
    principal = await resolveMcpPrincipal(user.id)
  } catch {
    return { kind: 'unavailable' }
  }
  if (!principal || principal.allowed.length === 0) return { kind: 'forbidden' }

  let gate: 'ok' | 'step_up' | 'enroll'
  try {
    gate = await staffMfaGate(stepUpCookie, user)
  } catch {
    return { kind: 'unavailable' }
  }
  if (gate !== 'ok') return { kind: gate }

  const grant = grantableScopes(request, principal.allowed)
  const requested = request.scopeRequested ? request.scopes : [...MCP_SCOPES]
  const withheld = MCP_SCOPES.filter((s) => requested.includes(s) && !grant.includes(s))
  const u = new URL(request.redirectUri)
  return {
    kind: 'ready',
    request,
    principal,
    grant,
    withheld: request.scopeRequested ? withheld : [],
    redirectHost: u.host,
    loopback: u.protocol === 'http:',
  }
}

/** Authorization response URL (RFC 6749 §4.1.2 / §4.1.2.1) with RFC 9207 `iss`. */
export function authorizationRedirect(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined) u.searchParams.set(k, v)
  }
  return u.toString()
}
