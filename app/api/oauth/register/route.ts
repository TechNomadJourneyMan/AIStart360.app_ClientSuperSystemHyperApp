/**
 * POST /api/oauth/register — OAuth 2.0 Dynamic Client Registration (RFC 7591).
 *
 * Kept for MCP clients that register dynamically (Claude Code does). MCP
 * 2026-07-28 deprecates DCR in favour of Client ID Metadata Documents but
 * retains it for backwards compatibility
 * (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration#dynamic-client-registration).
 * Registration grants nothing by itself: every authorization still needs a
 * staff/expert login, the second factor and explicit consent.
 */
import type { NextRequest } from 'next/server'
import { checkRateLimit, clientIp, hashIdentifier } from '@/lib/rate-limit'
import { corsPreflight, jsonResponse, NO_STORE, oauthErrorResponse, PUBLIC_CORS } from '@/lib/mcp/http'
import { OAuthError, registerClient } from '@/lib/mcp/oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<Response> {
  const ip = clientIp(req)
  const rl = await checkRateLimit(ip, 'oauth-register', { max: 20, windowMs: 60 * 60_000, failClosed: true })
  if (rl.limited) {
    return oauthErrorResponse('temporarily_unavailable', 'Слишком много регистраций, повторите позже', rl.reason === 'unavailable' ? 503 : 429, { 'Retry-After': String(rl.retryAfterSeconds) })
  }
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) {
    return oauthErrorResponse('invalid_client_metadata', 'Content-Type должен быть application/json')
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return oauthErrorResponse('invalid_client_metadata', 'Некорректный JSON')
  }
  try {
    const result = await registerClient(body, hashIdentifier(ip))
    return jsonResponse(result, 201, { ...NO_STORE, ...PUBLIC_CORS })
  } catch (err) {
    if (err instanceof OAuthError) return oauthErrorResponse(err.code, err.description, err.status)
    console.error('[oauth/register]', err instanceof Error ? err.message.split('\n')[0] : err)
    return oauthErrorResponse('server_error', 'Не удалось зарегистрировать клиента', 500)
  }
}

export function OPTIONS(): Response {
  return corsPreflight()
}
