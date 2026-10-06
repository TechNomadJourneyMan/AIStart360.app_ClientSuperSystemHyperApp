/**
 * GET /api/oauth/authorize — OAuth 2.1 authorization endpoint (code flow only).
 *
 * Validates the request (client, exact redirect URI, response_type=code,
 * PKCE S256, RFC 8707 resource = this MCP endpoint, known scopes), stores it
 * for 10 minutes and sends the browser to the consent screen
 * /oauth/consent/<id>, where login, the second factor and the person's
 * decision happen. Errors that cannot be trusted to redirect (unknown client,
 * unregistered redirect_uri) are shown here and never redirected
 * (OAuth 2.1 §4.1.2.1, MCP «Open Redirection»). Redirected errors carry the
 * RFC 9207 `iss` parameter.
 */
import type { NextRequest } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { authorizationRedirect } from '@/lib/mcp/consent'
import { PKCE_CHALLENGE } from '@/lib/mcp/crypto'
import { createAuthRequest, getClient, redirectUriMatches } from '@/lib/mcp/oauth'
import { oauthHtmlPage } from '@/lib/mcp/pages'
import { parseScopeString } from '@/lib/mcp/scopes'
import { mcpResourceUrl, OAUTH_PATHS, publicOrigin, sameResource } from '@/lib/mcp/urls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit(clientIp(req), 'oauth-authorize', { max: 60, windowMs: 60_000, failClosed: true })
  if (rl.limited) return oauthHtmlPage('Слишком много запросов', 'Подождите минуту и повторите подключение.', 429)

  const origin = publicOrigin(req.headers, req.url)
  const sp = req.nextUrl.searchParams
  for (const key of ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'scope', 'state', 'resource']) {
    if (sp.getAll(key).length > 1) return oauthHtmlPage('Некорректный запрос', `Параметр ${key} передан несколько раз.`, 400)
  }

  let client
  try {
    client = await getClient(sp.get('client_id'))
  } catch {
    return oauthHtmlPage('Сервис недоступен', 'Не удалось проверить приложение. Повторите позже.', 503)
  }
  if (!client) return oauthHtmlPage('Неизвестное приложение', 'Приложение не зарегистрировано на этом сервере. Подключите MCP-сервер заново.', 400)

  const presented = sp.get('redirect_uri') ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null)
  if (!presented || !redirectUriMatches(client.redirectUris, presented)) {
    return oauthHtmlPage('Неверный адрес возврата', 'Адрес возврата (redirect_uri) не совпадает с зарегистрированным для приложения.', 400)
  }

  const state = sp.get('state')
  const fail = (error: string, description: string) =>
    Response.redirect(authorizationRedirect(presented, { error, error_description: description, state, iss: origin }), 302)

  if (sp.get('response_type') !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported')
  if (!client.grantTypes.includes('authorization_code')) return fail('unauthorized_client', 'Client may not use authorization_code')
  const challenge = sp.get('code_challenge')
  if (sp.get('code_challenge_method') !== 'S256' || !challenge || !PKCE_CHALLENGE.test(challenge)) {
    return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required')
  }
  if (state !== null && state.length > 1000) return fail('invalid_request', 'state is too long')
  const ourResource = mcpResourceUrl(origin)
  const resource = sp.get('resource')
  if (resource !== null && !sameResource(resource, ourResource)) return fail('invalid_target', 'Unknown resource')
  const rawScope = sp.get('scope')
  const scopes = parseScopeString(rawScope)
  if (scopes === null) return fail('invalid_scope', 'Unknown scope')

  let id: string
  try {
    id = await createAuthRequest({
      clientId: client.clientId, redirectUri: presented, codeChallenge: challenge, scopes,
      scopeRequested: rawScope !== null && scopes.length > 0, resource: ourResource, state,
    })
  } catch {
    return fail('server_error', 'Authorization request could not be stored')
  }
  return Response.redirect(`${origin}${OAUTH_PATHS.consent}/${id}`, 302)
}
