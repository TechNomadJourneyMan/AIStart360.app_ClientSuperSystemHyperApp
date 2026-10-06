/**
 * /api/mcp — the MCP endpoint (Streamable HTTP, JSON responses, stateless).
 *
 * Protocol: MCP revision 2026-07-28 with legacy `initialize` clients
 * (≤ 2025-11-25) served on the same endpoint — see lib/mcp/server.ts.
 * Auth: personal access token or OAuth 2.1 access token (lib/mcp/auth.ts);
 * discovery via /.well-known/oauth-protected-resource/api/mcp.
 *
 * The official @modelcontextprotocol/sdk (1.32.1, latest on npm) implements
 * protocol versions up to 2025-11-25 only, so the JSON-RPC layer is written
 * against the specification directly; the SDK client is used in the tests to
 * check interoperability with legacy clients.
 */
import type { NextRequest } from 'next/server'
import { handleMcpPost, methodNotAllowed } from '@/lib/mcp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<Response> {
  return handleMcpPost(req)
}

/** No standalone SSE stream (removed in 2026-07-28; optional before): 405. */
export function GET(): Response {
  return methodNotAllowed()
}

/** No protocol sessions to terminate: 405. */
export function DELETE(): Response {
  return methodNotAllowed()
}
