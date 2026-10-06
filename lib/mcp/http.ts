/**
 * lib/mcp/http.ts — small HTTP helpers shared by the OAuth / discovery routes.
 */

/** Discovery documents and the token / registration endpoints are not cookie-authenticated: any origin may read them. */
export const PUBLIC_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
  'Access-Control-Max-Age': '600',
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: PUBLIC_CORS })
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** RFC 6749 §5.1 / §5.2: token responses are never cached. */
export const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }

export function oauthErrorResponse(code: string, description: string, status = 400, extra: Record<string, string> = {}): Response {
  return jsonResponse({ error: code, error_description: description }, status, { ...NO_STORE, ...PUBLIC_CORS, ...extra })
}
