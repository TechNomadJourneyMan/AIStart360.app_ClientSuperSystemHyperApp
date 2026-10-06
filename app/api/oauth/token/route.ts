/**
 * POST /api/oauth/token — OAuth 2.1 token endpoint.
 *
 *   grant_type=authorization_code  code + redirect_uri + code_verifier (PKCE S256) [+ resource]
 *   grant_type=refresh_token       refresh_token [+ scope ⊆ granted] [+ resource] — rotated on every use
 * Client authentication: none (public, PKCE), client_secret_basic or
 * client_secret_post, as registered. Responses are never cached
 * (RFC 6749 §5.1). See lib/mcp/oauth.ts for the security rules.
 */
import type { NextRequest } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { corsPreflight, jsonResponse, NO_STORE, oauthErrorResponse, PUBLIC_CORS } from '@/lib/mcp/http'
import { authenticateClient, exchangeCode, OAuthError, readClientCredentials, refreshTokens } from '@/lib/mcp/oauth'
import { mcpResourceUrl, publicOrigin } from '@/lib/mcp/urls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit(clientIp(req), 'oauth-token', { max: 60, windowMs: 60_000, failClosed: true })
  if (rl.limited) {
    return oauthErrorResponse('temporarily_unavailable', 'Слишком много запросов, повторите позже', rl.reason === 'unavailable' ? 503 : 429, { 'Retry-After': String(rl.retryAfterSeconds) })
  }
  if (!/^application\/x-www-form-urlencoded\b/i.test(req.headers.get('content-type') ?? '')) {
    return oauthErrorResponse('invalid_request', 'Content-Type должен быть application/x-www-form-urlencoded')
  }
  const form = new URLSearchParams(await req.text())
  for (const key of form.keys()) {
    if (form.getAll(key).length > 1) return oauthErrorResponse('invalid_request', `Параметр ${key} передан несколько раз`)
  }
  const creds = readClientCredentials(req.headers.get('authorization'), form)
  if (creds instanceof OAuthError) return oauthErrorResponse(creds.code, creds.description, creds.status)
  const ourResource = mcpResourceUrl(publicOrigin(req.headers, req.url))

  try {
    const client = await authenticateClient(creds)
    const grant = form.get('grant_type')
    const tokens = grant === 'authorization_code'
      ? await exchangeCode(client, {
          code: form.get('code'), redirectUri: form.get('redirect_uri'), codeVerifier: form.get('code_verifier'), resource: form.get('resource'),
        }, ourResource)
      : grant === 'refresh_token'
        ? await refreshTokens(client, { refreshToken: form.get('refresh_token'), scope: form.get('scope'), resource: form.get('resource') }, ourResource)
        : null
    if (!tokens) return oauthErrorResponse('unsupported_grant_type', 'Поддерживаются authorization_code и refresh_token')
    return jsonResponse(tokens, 200, { ...NO_STORE, ...PUBLIC_CORS })
  } catch (err) {
    if (err instanceof OAuthError) {
      const extra: Record<string, string> = err.code === 'invalid_client' && creds.method === 'client_secret_basic' ? { 'WWW-Authenticate': 'Basic realm="aistart360-mcp"' } : {}
      return oauthErrorResponse(err.code, err.description, err.status, extra)
    }
    console.error('[oauth/token]', err instanceof Error ? err.message.split('\n')[0] : err)
    return oauthErrorResponse('server_error', 'Не удалось выдать токен', 500)
  }
}

export function OPTIONS(): Response {
  return corsPreflight()
}
