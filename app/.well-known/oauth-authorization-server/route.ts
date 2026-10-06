/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414) of the MCP authorization
 * server. The issuer is the site origin (no path), so this is the only
 * location clients derive from it (RFC 8414 §3.1).
 */
import type { NextRequest } from 'next/server'
import { corsPreflight, jsonResponse, PUBLIC_CORS } from '@/lib/mcp/http'
import { authorizationServerMetadata } from '@/lib/mcp/metadata'
import { publicOrigin } from '@/lib/mcp/urls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(req: NextRequest): Response {
  return jsonResponse(authorizationServerMetadata(publicOrigin(req.headers, req.url)), 200, {
    ...PUBLIC_CORS,
    'Cache-Control': 'public, max-age=300',
  })
}

export function OPTIONS(): Response {
  return corsPreflight()
}
