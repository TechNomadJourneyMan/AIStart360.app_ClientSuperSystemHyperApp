/**
 * lib/mcp/oauth.ts — the OAuth 2.1 authorization server of the MCP endpoint
 * (stage 2 of the owner decision «Оба»).
 *
 * Follows MCP Authorization, revision 2026-07-28
 * (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization):
 *   - authorization code grant only, PKCE with S256 only (OAuth 2.1 §4.1.1,
 *     RFC 7636); no implicit flow, no password grant;
 *   - exact redirect URI match against the registered values («Open
 *     Redirection»), with the loopback-port allowance of RFC 8252 §7.3 /
 *     OAuth 2.1 §8.4.2 for native clients (scheme, host, path and query must
 *     still match);
 *   - redirect URIs must be HTTPS or loopback («Communication Security»);
 *   - tokens bound to the MCP resource URL (RFC 8707, «Token Audience Binding
 *     and Validation»): `resource` is checked at /authorize, at /token and on
 *     every MCP call;
 *   - short-lived access tokens (1 h), refresh tokens (30 d) rotated on every
 *     use; presenting a rotated refresh token again revokes the whole family
 *     (OAuth 2.1 §4.3.1, «Token Theft»: public clients MUST rotate);
 *   - a code is single use; a second redemption revokes the tokens issued
 *     from it (OAuth 2.1 §4.1.3);
 *   - Dynamic Client Registration (RFC 7591) — deprecated in 2026-07-28 in
 *     favour of Client ID Metadata Documents but still allowed for backwards
 *     compatibility; this server does not fetch client metadata documents
 *     (`client_id_metadata_document_supported: false`).
 * Every secret is stored as SHA-256 only (lib/mcp/crypto.ts).
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { looksLike, newClientId, newSecret, pkceS256Matches, PKCE_CHALLENGE, safeEqual, sha256Hex } from './crypto'
import { resolveMcpPrincipal } from './principal'
import { intersectScopes, parseScopeString, scopeString, type McpScope } from './scopes'
import { sameResource } from './urls'

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
export const AUTH_CODE_TTL_SECONDS = 120
export const AUTH_REQUEST_TTL_SECONDS = 10 * 60

export class OAuthError extends Error {
  constructor(public code: string, public description: string, public status = 400) {
    super(description)
  }
}

// ─── Redirect URIs ───────────────────────────────────────────────────────────

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function parseUrl(v: string): URL | null {
  try {
    return new URL(v)
  } catch {
    return null
  }
}

/** HTTPS anywhere, or http on a loopback host; no fragment, no credentials. */
export function isAcceptableRedirectUri(v: unknown): v is string {
  if (typeof v !== 'string' || v.length < 8 || v.length > 2000) return false
  const u = parseUrl(v)
  if (!u || u.hash || v.includes('#') || u.username || u.password) return false
  if (u.protocol === 'https:') return true
  return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname)
}

/**
 * Is `presented` one of `registered`? Exact string comparison; for loopback
 * http URIs the port alone may differ (native apps pick an ephemeral port).
 */
export function redirectUriMatches(registered: readonly string[], presented: string): boolean {
  if (registered.includes(presented)) return true
  const p = parseUrl(presented)
  if (!p || p.protocol !== 'http:' || !LOOPBACK_HOSTS.has(p.hostname) || p.hash) return false
  return registered.some((r) => {
    const u = parseUrl(r)
    return !!u && u.protocol === 'http:' && u.hostname === p.hostname && u.pathname === p.pathname && u.search === p.search
  })
}

// ─── Dynamic Client Registration (RFC 7591) ─────────────────────────────────

export interface ClientRow {
  clientId: string
  clientName: string | null
  redirectUris: string[]
  grantTypes: string[]
  authMethod: 'none' | 'client_secret_post' | 'client_secret_basic'
  secretHash: string | null
  applicationType: string | null
  createdAt: Date
}

const AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'] as const

function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  let out = ''
  for (const ch of v) {
    const c = ch.codePointAt(0) ?? 0
    out += c < 0x20 || (c >= 0x7f && c < 0xa0) ? ' ' : ch
  }
  out = out.replace(/\s+/g, ' ').trim().slice(0, 200)
  return out || null
}

/** RFC 7591 §3.2.1 response for a registered client (plus the secret, once). */
export interface RegistrationResult {
  client_id: string
  client_id_issued_at: number
  client_secret?: string
  client_secret_expires_at?: number
  client_name?: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  token_endpoint_auth_method: string
  application_type?: string
}

/** Validate RFC 7591 client metadata; throws OAuthError(invalid_redirect_uri | invalid_client_metadata). */
export function validateClientMetadata(body: unknown): {
  name: string | null; redirectUris: string[]; grantTypes: string[]; authMethod: ClientRow['authMethod']; applicationType: string | null
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OAuthError('invalid_client_metadata', 'Тело запроса должно быть JSON-объектом')
  const m = body as Record<string, unknown>
  const uris = m.redirect_uris
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris: от 1 до 10 адресов')
  }
  if (!uris.every(isAcceptableRedirectUri)) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uri должен быть https:// или http://localhost (127.0.0.1, [::1]) без фрагмента')
  }
  const authMethod = (m.token_endpoint_auth_method ?? 'client_secret_basic') as string
  if (!(AUTH_METHODS as readonly string[]).includes(authMethod)) {
    throw new OAuthError('invalid_client_metadata', 'token_endpoint_auth_method: none, client_secret_post или client_secret_basic')
  }
  const grantTypes = m.grant_types === undefined ? ['authorization_code'] : m.grant_types
  if (!Array.isArray(grantTypes) || grantTypes.length === 0 || !grantTypes.every((g) => g === 'authorization_code' || g === 'refresh_token')
      || !grantTypes.includes('authorization_code')) {
    throw new OAuthError('invalid_client_metadata', 'grant_types: authorization_code (и refresh_token); implicit и password не поддерживаются')
  }
  const responseTypes = m.response_types === undefined ? ['code'] : m.response_types
  if (!Array.isArray(responseTypes) || responseTypes.length !== 1 || responseTypes[0] !== 'code') {
    throw new OAuthError('invalid_client_metadata', 'response_types: только code')
  }
  if (m.scope !== undefined && (typeof m.scope !== 'string' || parseScopeString(m.scope) === null)) {
    throw new OAuthError('invalid_client_metadata', 'scope: неизвестный скоуп')
  }
  const appType = m.application_type
  if (appType !== undefined && appType !== 'native' && appType !== 'web') {
    throw new OAuthError('invalid_client_metadata', 'application_type: native или web')
  }
  return {
    name: cleanName(m.client_name),
    redirectUris: [...new Set(uris as string[])],
    grantTypes: [...new Set(grantTypes as string[])],
    authMethod: authMethod as ClientRow['authMethod'],
    applicationType: (appType as string | undefined) ?? null,
  }
}

export async function registerClient(body: unknown, ipHash: string | null): Promise<RegistrationResult> {
  const v = validateClientMetadata(body)
  const clientId = newClientId()
  const secret = v.authMethod === 'none' ? null : newSecret('clientSecret')
  const rows = await prisma.$queryRaw<Array<{ created_at: Date }>>`
    INSERT INTO public.oauth_clients
      (client_id, client_name, redirect_uris, grant_types, token_endpoint_auth_method, client_secret_hash, application_type, registration_ip_hash)
    VALUES (${clientId}, ${v.name}, ${v.redirectUris}::text[], ${v.grantTypes}::text[], ${v.authMethod},
            ${secret ? sha256Hex(secret) : null}, ${v.applicationType}, ${ipHash})
    RETURNING created_at`
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(rows[0].created_at.getTime() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    ...(v.name ? { client_name: v.name } : {}),
    redirect_uris: v.redirectUris,
    grant_types: v.grantTypes,
    response_types: ['code'],
    token_endpoint_auth_method: v.authMethod,
    ...(v.applicationType ? { application_type: v.applicationType } : {}),
  }
}

export async function getClient(clientId: string | null | undefined): Promise<ClientRow | null> {
  if (!clientId || !/^mcpc_[A-Za-z0-9_-]{16,64}$/.test(clientId)) return null
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT client_id, client_name, redirect_uris, grant_types, token_endpoint_auth_method, client_secret_hash, application_type, created_at
    FROM public.oauth_clients WHERE client_id = ${clientId}`
  const r = rows[0]
  if (!r) return null
  return {
    clientId: String(r.client_id),
    clientName: (r.client_name as string | null) ?? null,
    redirectUris: (r.redirect_uris as string[]) ?? [],
    grantTypes: (r.grant_types as string[]) ?? [],
    authMethod: r.token_endpoint_auth_method as ClientRow['authMethod'],
    secretHash: (r.client_secret_hash as string | null) ?? null,
    applicationType: (r.application_type as string | null) ?? null,
    createdAt: r.created_at as Date,
  }
}

// ─── Client authentication at the token / revocation endpoints ──────────────

export interface ClientCredentials { clientId: string | null; secret: string | null; method: 'none' | 'client_secret_post' | 'client_secret_basic' }

/** client_secret_basic (RFC 6749 §2.3.1: form-urlencoded id and secret) or form fields. */
export function readClientCredentials(authorization: string | null, form: URLSearchParams): ClientCredentials | OAuthError {
  const basic = authorization?.match(/^Basic\s+([A-Za-z0-9+/=]+)\s*$/i)
  if (basic) {
    let decoded: string
    try {
      decoded = Buffer.from(basic[1], 'base64').toString('utf8')
    } catch {
      return new OAuthError('invalid_client', 'Некорректный заголовок Authorization', 401)
    }
    const i = decoded.indexOf(':')
    if (i < 0) return new OAuthError('invalid_client', 'Некорректный заголовок Authorization', 401)
    let id: string
    let secret: string
    try {
      id = decodeURIComponent(decoded.slice(0, i).replace(/\+/g, ' '))
      secret = decodeURIComponent(decoded.slice(i + 1).replace(/\+/g, ' '))
    } catch {
      return new OAuthError('invalid_client', 'Некорректный заголовок Authorization', 401)
    }
    const formId = form.get('client_id')
    if (formId && formId !== id) return new OAuthError('invalid_request', 'client_id в форме не совпадает с Authorization')
    return { clientId: id, secret, method: 'client_secret_basic' }
  }
  const secret = form.get('client_secret')
  return { clientId: form.get('client_id'), secret, method: secret ? 'client_secret_post' : 'none' }
}

/** Authenticate the client as registered; throws OAuthError(invalid_client, 401). */
export async function authenticateClient(creds: ClientCredentials): Promise<ClientRow> {
  const client = await getClient(creds.clientId)
  if (!client) throw new OAuthError('invalid_client', 'Неизвестный клиент', 401)
  if (client.authMethod === 'none') {
    if (creds.secret) throw new OAuthError('invalid_client', 'Публичный клиент не передаёт секрет', 401)
    return client
  }
  if (!creds.secret || !client.secretHash || !safeEqual(sha256Hex(creds.secret), client.secretHash)) {
    throw new OAuthError('invalid_client', 'Неверный секрет клиента', 401)
  }
  return client
}

// ─── Authorization requests (waiting for consent) ───────────────────────────

export interface AuthorizeParams {
  responseType: string | null
  clientId: string | null
  redirectUri: string | null
  codeChallenge: string | null
  codeChallengeMethod: string | null
  scope: string | null
  state: string | null
  resource: string | null
}

export interface AuthRequestRow {
  id: string
  clientId: string
  clientName: string | null
  redirectUri: string
  scopes: McpScope[]
  scopeRequested: boolean
  resource: string
  state: string | null
  expiresAt: Date
}

export async function createAuthRequest(r: {
  clientId: string; redirectUri: string; codeChallenge: string; scopes: McpScope[]; scopeRequested: boolean; resource: string; state: string | null
  /** false when the client omitted redirect_uri (single registered URI). */
  redirectUriExplicit?: boolean
}): Promise<string> {
  if (!PKCE_CHALLENGE.test(r.codeChallenge)) throw new OAuthError('invalid_request', 'code_challenge: base64url SHA-256 (43 символа)')
  await pruneExpiredGrants()
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO public.oauth_auth_requests (client_id, redirect_uri, redirect_uri_explicit, code_challenge, scopes, scope_requested, resource, state, expires_at)
    VALUES (${r.clientId}, ${r.redirectUri}, ${r.redirectUriExplicit ?? true}, ${r.codeChallenge}, ${r.scopes}::text[], ${r.scopeRequested}, ${r.resource},
            ${r.state}, now() + make_interval(secs => ${AUTH_REQUEST_TTL_SECONDS}::int))
    RETURNING id::text`
  return rows[0].id
}

/**
 * Housekeeping on the authorize path: drop authorization requests and codes
 * that expired more than a day ago (bounded batch). Tokens keep their rows —
 * the family history is what reuse detection relies on.
 */
async function pruneExpiredGrants(): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM public.oauth_auth_requests WHERE id IN (
      SELECT id FROM public.oauth_auth_requests WHERE expires_at < now() - interval '1 day' LIMIT 500)`
  await prisma.$executeRaw`
    DELETE FROM public.oauth_auth_codes WHERE id IN (
      SELECT id FROM public.oauth_auth_codes WHERE expires_at < now() - interval '1 day' LIMIT 500)`
}

/** A pending (not decided, not expired) request, or null. */
export async function getPendingAuthRequest(id: string): Promise<AuthRequestRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT r.id::text, r.client_id, c.client_name, r.redirect_uri, r.scopes, r.scope_requested, r.resource, r.state, r.expires_at
    FROM public.oauth_auth_requests r JOIN public.oauth_clients c ON c.client_id = r.client_id
    WHERE r.id = ${id}::uuid AND r.used_at IS NULL AND r.expires_at > now()`
  const r = rows[0]
  if (!r) return null
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    clientName: (r.client_name as string | null) ?? null,
    redirectUri: String(r.redirect_uri),
    scopes: (r.scopes as McpScope[]) ?? [],
    scopeRequested: Boolean(r.scope_requested),
    resource: String(r.resource),
    state: (r.state as string | null) ?? null,
    expiresAt: r.expires_at as Date,
  }
}

/**
 * Scopes a consent grants: the requested ones the person's role allows; with
 * no `scope` parameter, everything the role allows (MCP clients omit `scope`
 * when neither WWW-Authenticate nor the resource metadata name one).
 */
export function grantableScopes(req: Pick<AuthRequestRow, 'scopes' | 'scopeRequested'>, allowed: readonly McpScope[]): McpScope[] {
  return req.scopeRequested ? intersectScopes(req.scopes, allowed) : [...allowed]
}

export type DecisionResult =
  | { ok: true; redirectUri: string; state: string | null; code: string | null }
  | { ok: false; reason: 'not_pending' }

/**
 * Record the person's decision (single use) and, when approved, mint the
 * authorization code. The code is returned once; only its hash is stored.
 */
export async function decideAuthRequest(id: string, userId: string, approve: boolean, scopes: McpScope[]): Promise<DecisionResult> {
  const claimed = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    UPDATE public.oauth_auth_requests
    SET used_at = now(), user_id = ${userId}::uuid, decision = ${approve && scopes.length > 0 ? 'approved' : 'denied'}
    WHERE id = ${id}::uuid AND used_at IS NULL AND expires_at > now()
    RETURNING client_id, redirect_uri, redirect_uri_explicit, code_challenge, resource, state`
  const r = claimed[0]
  if (!r) return { ok: false, reason: 'not_pending' }
  if (!approve || scopes.length === 0) return { ok: true, redirectUri: String(r.redirect_uri), state: (r.state as string | null) ?? null, code: null }
  const code = newSecret('code')
  await prisma.$executeRaw`
    INSERT INTO public.oauth_auth_codes (code_hash, client_id, user_id, redirect_uri, redirect_uri_explicit, code_challenge, scopes, resource, expires_at)
    VALUES (${sha256Hex(code)}, ${String(r.client_id)}, ${userId}::uuid, ${String(r.redirect_uri)}, ${r.redirect_uri_explicit !== false}, ${String(r.code_challenge)},
            ${scopes}::text[], ${String(r.resource)}, now() + make_interval(secs => ${AUTH_CODE_TTL_SECONDS}::int))`
  return { ok: true, redirectUri: String(r.redirect_uri), state: (r.state as string | null) ?? null, code }
}

// ─── Token endpoint ──────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token?: string
  scope: string
}

type Tx = Pick<typeof prisma, '$queryRaw' | '$executeRaw'>

async function issuePair(db: Tx, p: {
  familyId: string; rotatedFrom: string | null; codeId: string | null; client: ClientRow; userId: string; scopes: McpScope[]; resource: string
}): Promise<TokenResponse> {
  const access = newSecret('access')
  const withRefresh = p.client.grantTypes.includes('refresh_token')
  const refresh = withRefresh ? newSecret('refresh') : null
  await db.$executeRaw`
    INSERT INTO public.oauth_tokens
      (family_id, rotated_from, code_id, client_id, user_id, access_hash, refresh_hash, scopes, resource, expires_at, refresh_expires_at)
    VALUES (${p.familyId}::uuid, ${p.rotatedFrom}::uuid, ${p.codeId}::uuid, ${p.client.clientId}, ${p.userId}::uuid,
            ${sha256Hex(access)}, ${refresh ? sha256Hex(refresh) : null}, ${p.scopes}::text[], ${p.resource},
            now() + make_interval(secs => ${ACCESS_TOKEN_TTL_SECONDS}::int),
            ${refresh ? REFRESH_TOKEN_TTL_SECONDS : null}::int * interval '1 second' + now())`
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    ...(refresh ? { refresh_token: refresh } : {}),
    scope: scopeString(p.scopes),
  }
}

async function revokeFamily(db: Tx, familyId: string, reason: 'reuse_detected' | 'code_reuse' | 'revoked' | 'access_lost'): Promise<number> {
  return db.$executeRaw`
    UPDATE public.oauth_tokens SET revoked_at = now(), revoked_reason = ${reason}
    WHERE family_id = ${familyId}::uuid AND revoked_at IS NULL`
}

/** grant_type=authorization_code (OAuth 2.1 §4.1.3 + RFC 7636 §4.6 + RFC 8707 §2.2). */
export async function exchangeCode(client: ClientRow, p: {
  code: string | null; redirectUri: string | null; codeVerifier: string | null; resource: string | null
}, ourResource: string): Promise<TokenResponse> {
  if (!client.grantTypes.includes('authorization_code')) throw new OAuthError('unauthorized_client', 'Клиенту не разрешён authorization_code')
  if (!p.code || !looksLike('code', p.code)) throw new OAuthError('invalid_grant', 'Код авторизации недействителен')
  if (!p.codeVerifier) throw new OAuthError('invalid_request', 'Нужен code_verifier (PKCE)')
  const hash = sha256Hex(p.code)
  // Single use: the code is burned by the first redemption, whatever its outcome.
  const claimed = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    UPDATE public.oauth_auth_codes SET used_at = now()
    WHERE code_hash = ${hash} AND used_at IS NULL AND expires_at > now()
    RETURNING id::text, client_id, user_id::text, redirect_uri, redirect_uri_explicit, code_challenge, scopes, resource`
  const c = claimed[0]
  if (!c) {
    // A second redemption: revoke what the first one obtained (OAuth 2.1 §4.1.3).
    const used = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text FROM public.oauth_auth_codes WHERE code_hash = ${hash} AND used_at IS NOT NULL`
    if (used[0]) {
      await prisma.$executeRaw`
        UPDATE public.oauth_tokens SET revoked_at = now(), revoked_reason = 'code_reuse'
        WHERE family_id IN (SELECT family_id FROM public.oauth_tokens WHERE code_id = ${used[0].id}::uuid) AND revoked_at IS NULL`
    }
    throw new OAuthError('invalid_grant', 'Код авторизации недействителен, истёк или уже использован')
  }
  if (String(c.client_id) !== client.clientId) throw new OAuthError('invalid_grant', 'Код выдан другому клиенту')
  // redirect_uri is required at /token exactly when it was sent at /authorize
  // (OAuth 2.1 §4.1.3); when sent, it must be identical.
  if (c.redirect_uri_explicit !== false && !p.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri обязателен: он был передан в запросе авторизации')
  if (p.redirectUri && p.redirectUri !== String(c.redirect_uri)) throw new OAuthError('invalid_grant', 'redirect_uri не совпадает с запросом авторизации')
  if (!pkceS256Matches(p.codeVerifier, String(c.code_challenge))) throw new OAuthError('invalid_grant', 'code_verifier не соответствует code_challenge')
  const resource = String(c.resource)
  // Same normalisation as /authorize (scheme/host case, one trailing slash).
  if (p.resource && !sameResource(p.resource, resource)) throw new OAuthError('invalid_target', 'resource не совпадает с запросом авторизации')
  if (!sameResource(resource, ourResource)) throw new OAuthError('invalid_target', 'Токен запрошен для другого ресурса')

  const principal = await resolveMcpPrincipal(String(c.user_id))
  const scopes = principal ? intersectScopes(c.scopes as string[], principal.allowed) : []
  if (!principal || scopes.length === 0) throw new OAuthError('invalid_grant', 'Доступ к MCP у пользователя отозван')
  return issuePair(prisma, {
    familyId: randomUUID(), rotatedFrom: null, codeId: String(c.id), client, userId: String(c.user_id), scopes, resource,
  })
}

/** grant_type=refresh_token with rotation and reuse detection (OAuth 2.1 §4.3, §4.3.1). */
export async function refreshTokens(client: ClientRow, p: {
  refreshToken: string | null; scope: string | null; resource: string | null
}, ourResource: string): Promise<TokenResponse> {
  if (!client.grantTypes.includes('refresh_token')) throw new OAuthError('unauthorized_client', 'Клиенту не разрешён refresh_token')
  if (!p.refreshToken || !looksLike('refresh', p.refreshToken)) throw new OAuthError('invalid_grant', 'refresh_token недействителен')
  const requested = p.scope === null ? null : parseScopeString(p.scope)
  if (requested === null && p.scope !== null) throw new OAuthError('invalid_scope', 'Неизвестный скоуп')
  const hash = sha256Hex(p.refreshToken)

  return prisma.$transaction(async (tx) => {
    const rotated = await tx.$queryRaw<Array<Record<string, unknown>>>`
      UPDATE public.oauth_tokens SET revoked_at = now(), revoked_reason = 'rotated'
      WHERE refresh_hash = ${hash} AND revoked_at IS NULL AND refresh_expires_at > now()
      RETURNING id::text, family_id::text, client_id, user_id::text, scopes, resource`
    const old = rotated[0]
    if (!old) {
      const seen = await tx.$queryRaw<Array<{ family_id: string; revoked_reason: string | null; client_id: string }>>`
        SELECT family_id::text, revoked_reason, client_id FROM public.oauth_tokens WHERE refresh_hash = ${hash}`
      // A rotated refresh token presented again: someone kept a copy. Kill the family.
      if (seen[0]?.revoked_reason === 'rotated' && seen[0].client_id === client.clientId) {
        await revokeFamily(tx, seen[0].family_id, 'reuse_detected')
        return { reuse: true as const }
      }
      throw new OAuthError('invalid_grant', 'refresh_token недействителен, истёк или отозван')
    }
    if (String(old.client_id) !== client.clientId) throw new OAuthError('invalid_grant', 'refresh_token выдан другому клиенту')
    const resource = String(old.resource)
    if (p.resource && !sameResource(p.resource, resource)) throw new OAuthError('invalid_target', 'resource не совпадает с выданным токеном')
    if (!sameResource(resource, ourResource)) throw new OAuthError('invalid_target', 'Токен выдан для другого ресурса')
    const principal = await resolveMcpPrincipal(String(old.user_id))
    let scopes = principal ? intersectScopes(old.scopes as string[], principal.allowed) : []
    if (requested && requested.length > 0) {
      if (!requested.every((s) => (old.scopes as string[]).includes(s))) throw new OAuthError('invalid_scope', 'Нельзя расширить скоупы при обновлении токена')
      scopes = intersectScopes(scopes, requested)
    }
    if (!principal || scopes.length === 0) {
      await revokeFamily(tx, String(old.family_id), 'access_lost')
      await tx.$executeRaw`UPDATE public.oauth_tokens SET revoked_reason = 'access_lost' WHERE id = ${String(old.id)}::uuid`
      return { lost: true as const }
    }
    return issuePair(tx, {
      familyId: String(old.family_id), rotatedFrom: String(old.id), codeId: null, client, userId: String(old.user_id), scopes, resource,
    })
  }).then((r) => {
    // Revocations above must commit, so the error is raised after the transaction.
    if ('reuse' in r) throw new OAuthError('invalid_grant', 'refresh_token уже использован — все токены этого входа отозваны')
    if ('lost' in r) throw new OAuthError('invalid_grant', 'Доступ к MCP у пользователя отозван')
    return r
  })
}

/** RFC 7009: revoke an access or refresh token of this client (and its family). Always succeeds. */
export async function revokeToken(client: ClientRow, token: string | null): Promise<void> {
  if (!token) return
  const isAccess = looksLike('access', token)
  if (!isAccess && !looksLike('refresh', token)) return
  const hash = sha256Hex(token)
  const rows = isAccess
    ? await prisma.$queryRaw<Array<{ family_id: string }>>`
        SELECT family_id::text FROM public.oauth_tokens WHERE access_hash = ${hash} AND client_id = ${client.clientId}`
    : await prisma.$queryRaw<Array<{ family_id: string }>>`
        SELECT family_id::text FROM public.oauth_tokens WHERE refresh_hash = ${hash} AND client_id = ${client.clientId}`
  if (rows[0]) await revokeFamily(prisma, rows[0].family_id, 'revoked')
}

// ─── Resource server side ────────────────────────────────────────────────────

export interface ActiveAccessToken {
  id: string
  familyId: string
  userId: string
  clientId: string
  scopes: string[]
  resource: string
}

export async function findActiveAccessToken(token: string): Promise<ActiveAccessToken | null> {
  if (!looksLike('access', token)) return null
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id::text, family_id::text, user_id::text, client_id, scopes, resource FROM public.oauth_tokens
    WHERE access_hash = ${sha256Hex(token)} AND revoked_at IS NULL AND expires_at > now()`
  const r = rows[0]
  if (!r) return null
  return {
    id: String(r.id), familyId: String(r.family_id), userId: String(r.user_id), clientId: String(r.client_id),
    scopes: (r.scopes as string[]) ?? [], resource: String(r.resource),
  }
}

export async function touchAccessToken(id: string, ipHash: string | null): Promise<void> {
  await prisma.$executeRaw`
    UPDATE public.oauth_tokens SET last_used_at = now(), last_used_ip_hash = ${ipHash}
    WHERE id = ${id}::uuid AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`
}

// ─── Connected applications (GIGA / expert page) ─────────────────────────────

export interface OAuthGrantRow { familyId: string; clientId: string; clientName: string | null; scopes: string[]; createdAt: Date; lastUsedAt: Date | null; refreshExpiresAt: Date | null }

/** Active OAuth sign-ins of a person: one row per token family. */
export async function listOAuthGrants(userId: string): Promise<OAuthGrantRow[]> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT t.family_id::text, t.client_id, c.client_name, t.scopes,
           (SELECT min(f.created_at) FROM public.oauth_tokens f WHERE f.family_id = t.family_id) AS created_at,
           (SELECT max(f.last_used_at) FROM public.oauth_tokens f WHERE f.family_id = t.family_id) AS last_used_at,
           t.refresh_expires_at
    FROM public.oauth_tokens t JOIN public.oauth_clients c ON c.client_id = t.client_id
    WHERE t.user_id = ${userId}::uuid AND t.revoked_at IS NULL
      AND (t.expires_at > now() OR t.refresh_expires_at > now())
    ORDER BY t.created_at DESC
    LIMIT 50`
  return rows.map((r) => ({
    familyId: String(r.family_id), clientId: String(r.client_id), clientName: (r.client_name as string | null) ?? null,
    scopes: (r.scopes as string[]) ?? [], createdAt: r.created_at as Date, lastUsedAt: (r.last_used_at as Date | null) ?? null,
    refreshExpiresAt: (r.refresh_expires_at as Date | null) ?? null,
  }))
}

/** Revoke one of the person's OAuth sign-ins. false = not theirs / nothing active. */
export async function revokeOAuthGrant(userId: string, familyId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(familyId)) return false
  const n = await prisma.$executeRaw`
    UPDATE public.oauth_tokens SET revoked_at = now(), revoked_reason = 'revoked'
    WHERE family_id = ${familyId}::uuid AND user_id = ${userId}::uuid AND revoked_at IS NULL`
  return n > 0
}
