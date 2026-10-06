/**
 * lib/mcp/metadata.ts — discovery documents.
 *
 *  - OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP endpoint —
 *    MCP servers MUST implement it and list at least one authorization server
 *    (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery).
 *  - OAuth 2.0 Authorization Server Metadata (RFC 8414) — `issuer` must equal
 *    the URL the client derived the well-known address from; PKCE support is
 *    advertised through `code_challenge_methods_supported` (clients MUST
 *    refuse to proceed without it); RFC 9207 `iss` in authorization responses.
 */
import { MCP_SCOPES } from './scopes'
import { mcpResourceUrl, OAUTH_PATHS } from './urls'

export const SERVER_INFO = { name: 'aistart360-mcp', title: 'AIStart360', version: '1.0.0' } as const

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [origin],
    // Scopes needed for basic functionality; offline_access is deliberately
    // absent (MCP Authorization «Refresh Tokens»: resources SHOULD NOT list it).
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'AIStart360 MCP',
  }
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${OAUTH_PATHS.authorize}`,
    token_endpoint: `${origin}${OAUTH_PATHS.token}`,
    registration_endpoint: `${origin}${OAUTH_PATHS.register}`,
    revocation_endpoint: `${origin}${OAUTH_PATHS.revoke}`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false,
  }
}
