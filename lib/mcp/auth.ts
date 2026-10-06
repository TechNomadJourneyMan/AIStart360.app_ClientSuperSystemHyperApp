/**
 * lib/mcp/auth.ts — bearer authentication of MCP requests (resource server).
 *
 * MCP Authorization «Access Token Usage» / «Token Handling»
 * (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#access-token-usage):
 *   - the token comes in `Authorization: Bearer …` on EVERY request, never
 *     in the query string;
 *   - invalid or expired tokens get HTTP 401 with a WWW-Authenticate challenge
 *     carrying `resource_metadata` (RFC 9728 §5.1) and the scopes to request
 *     («Scope Selection Strategy», RFC 6750 §3);
 *   - OAuth access tokens are accepted only when issued for THIS resource
 *     (RFC 8707 audience binding); personal tokens only exist for this
 *     endpoint.
 * The caller's role is re-read on every request (lib/mcp/principal.ts).
 */
import { findActiveAccessToken, touchAccessToken } from './oauth'
import { resolveMcpPrincipal, type McpPrincipal } from './principal'
import { intersectScopes, MCP_SCOPES, scopeString, type McpScope } from './scopes'
import { findActivePat, touchPat } from './tokens'
import { looksLike } from './crypto'
import { resourceMetadataUrl, sameResource } from './urls'

export type McpCredential =
  | { kind: 'pat'; id: string; scopes: string[]; clientId: null }
  | { kind: 'oauth'; id: string; familyId: string; scopes: string[]; clientId: string }

export type AuthOutcome =
  | { ok: true; principal: McpPrincipal; credential: McpCredential; scopes: McpScope[] }
  | { ok: false; status: 401 | 403 | 503; error: 'invalid_token' | 'insufficient_scope' | null; description: string; credential?: McpCredential; userId?: string }

const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  invalid_token: 'The access token is invalid, expired or revoked',
  insufficient_scope: 'The access token does not grant the required scope',
}

/** RFC 6750 §3 challenge with the RFC 9728 resource_metadata parameter. */
export function wwwAuthenticate(origin: string, p: { error?: string | null; description?: string; scope?: string } = {}): string {
  const q = (v: string) => `"${v.replace(/["\\]/g, '')}"`
  const parts = [`resource_metadata=${q(resourceMetadataUrl(origin))}`]
  if (p.error) parts.unshift(`error=${q(p.error)}`)
  parts.push(`scope=${q(p.scope ?? scopeString(MCP_SCOPES))}`)
  // Header values must stay ASCII: the Russian text goes to the JSON body;
  // the header carries an English description.
  const description = p.description && /^[\x20-\x7e]+$/.test(p.description) ? p.description : p.error ? DEFAULT_DESCRIPTIONS[p.error] : undefined
  if (description) parts.push(`error_description=${q(description)}`)
  return `Bearer ${parts.join(', ')}`
}

export function bearerToken(authorization: string | null): string | null {
  const m = authorization?.match(/^Bearer[ ]+([A-Za-z0-9\-._~+/]+=*)\s*$/i)
  return m ? m[1] : null
}

export async function authenticateMcp(authorization: string | null, ourResource: string, ipHash: string | null): Promise<AuthOutcome> {
  const token = bearerToken(authorization)
  if (!token) return { ok: false, status: 401, error: null, description: 'Требуется токен доступа (Authorization: Bearer)' }

  try {
    if (looksLike('pat', token)) {
      const pat = await findActivePat(token)
      if (pat) {
        await touchPat(pat.id, ipHash)
        return await withPrincipal(pat.userId, { kind: 'pat', id: pat.id, scopes: pat.scopes, clientId: null })
      }
    } else if (looksLike('access', token)) {
      const at = await findActiveAccessToken(token)
      if (at && !sameResource(at.resource, ourResource)) {
        return { ok: false, status: 401, error: 'invalid_token', description: 'Токен выдан для другого ресурса' }
      }
      if (at) {
        await touchAccessToken(at.id, ipHash)
        return await withPrincipal(at.userId, { kind: 'oauth', id: at.id, familyId: at.familyId, scopes: at.scopes, clientId: at.clientId })
      }
    }
  } catch {
    return { ok: false, status: 503, error: null, description: 'Не удалось проверить токен, повторите позже' }
  }
  return { ok: false, status: 401, error: 'invalid_token', description: 'Токен недействителен, истёк или отозван' }
}

async function withPrincipal(userId: string, credential: McpCredential): Promise<AuthOutcome> {
  const principal = await resolveMcpPrincipal(userId)
  if (!principal) {
    return { ok: false, status: 401, error: 'invalid_token', description: 'Доступ владельца токена к MCP отозван', credential, userId }
  }
  const scopes = intersectScopes(credential.scopes, principal.allowed)
  if (scopes.length === 0) {
    return { ok: false, status: 403, error: 'insufficient_scope', description: 'Роль владельца токена больше не даёт ни одного из его прав', credential, userId }
  }
  return { ok: true, principal, credential, scopes }
}
