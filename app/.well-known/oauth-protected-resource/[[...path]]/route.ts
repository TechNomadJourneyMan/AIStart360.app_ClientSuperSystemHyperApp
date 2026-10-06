/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) of the MCP endpoint.
 *
 * Served at both well-known locations MCP clients probe
 * (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery):
 *   /.well-known/oauth-protected-resource/api/mcp   (path-inserted, announced in WWW-Authenticate)
 *   /.well-known/oauth-protected-resource           (root fallback)
 * Both describe the one protected resource, `<origin>/api/mcp`.
 */
import type { NextRequest } from 'next/server'
import { corsPreflight, jsonResponse, PUBLIC_CORS } from '@/lib/mcp/http'
import { protectedResourceMetadata } from '@/lib/mcp/metadata'
import { publicOrigin } from '@/lib/mcp/urls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(req: NextRequest, { params }: { params: { path?: string[] } }): Response {
  const sub = (params.path ?? []).join('/')
  if (sub !== '' && sub !== 'api/mcp') return jsonResponse({ error: 'not_found' }, 404, PUBLIC_CORS)
  return jsonResponse(protectedResourceMetadata(publicOrigin(req.headers, req.url)), 200, {
    ...PUBLIC_CORS,
    'Cache-Control': 'public, max-age=300',
  })
}

export function OPTIONS(): Response {
  return corsPreflight()
}
