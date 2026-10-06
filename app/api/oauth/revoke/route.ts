/**
 * POST /api/oauth/revoke — OAuth 2.0 Token Revocation (RFC 7009).
 * Revoking an access or a refresh token ends the whole sign-in (token family).
 * Answers 200 for unknown or already revoked tokens (RFC 7009 §2.2).
 */
import type { NextRequest } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { corsPreflight, NO_STORE, oauthErrorResponse, PUBLIC_CORS } from '@/lib/mcp/http'
import { authenticateClient, OAuthError, readClientCredentials, revokeToken } from '@/lib/mcp/oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit(clientIp(req), 'oauth-revoke', { max: 60, windowMs: 60_000, failClosed: true })
  if (rl.limited) {
    return oauthErrorResponse('temporarily_unavailable', 'Слишком много запросов, повторите позже', rl.reason === 'unavailable' ? 503 : 429, { 'Retry-After': String(rl.retryAfterSeconds) })
  }
  if (!/^application\/x-www-form-urlencoded\b/i.test(req.headers.get('content-type') ?? '')) {
    return oauthErrorResponse('invalid_request', 'Content-Type должен быть application/x-www-form-urlencoded')
  }
  const form = new URLSearchParams(await req.text())
  const creds = readClientCredentials(req.headers.get('authorization'), form)
  if (creds instanceof OAuthError) return oauthErrorResponse(creds.code, creds.description, creds.status)
  try {
    const client = await authenticateClient(creds)
    await revokeToken(client, form.get('token'))
    return new Response(null, { status: 200, headers: { ...NO_STORE, ...PUBLIC_CORS } })
  } catch (err) {
    if (err instanceof OAuthError) return oauthErrorResponse(err.code, err.description, err.status)
    console.error('[oauth/revoke]', err instanceof Error ? err.message.split('\n')[0] : err)
    return oauthErrorResponse('server_error', 'Не удалось отозвать токен', 500)
  }
}

export function OPTIONS(): Response {
  return corsPreflight()
}
