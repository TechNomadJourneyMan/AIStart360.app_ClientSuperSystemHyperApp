/**
 * OAuth 2.1 rules of the MCP authorization server that need no database:
 * redirect URI policy (HTTPS or loopback, exact match, loopback port),
 * RFC 7591 metadata validation, client authentication parsing, discovery
 * documents (RFC 9728 / RFC 8414) and resource (RFC 8707) comparison.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { isAcceptableRedirectUri, OAuthError, readClientCredentials, redirectUriMatches, validateClientMetadata } from '@/lib/mcp/oauth'
import { authorizationServerMetadata, protectedResourceMetadata } from '@/lib/mcp/metadata'
import { mcpResourceUrl, publicOrigin, resourceMetadataUrl, sameResource } from '@/lib/mcp/urls'
import { bearerToken, wwwAuthenticate } from '@/lib/mcp/auth'
import { authorizationRedirect } from '@/lib/mcp/consent'

describe('redirect URIs', () => {
  it('accepts HTTPS and loopback http only, never fragments or credentials', () => {
    expect(isAcceptableRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(isAcceptableRedirectUri('http://localhost:53682/callback')).toBe(true)
    expect(isAcceptableRedirectUri('http://127.0.0.1:8080/cb')).toBe(true)
    expect(isAcceptableRedirectUri('http://[::1]:8080/cb')).toBe(true)
    expect(isAcceptableRedirectUri('http://evil.example/cb')).toBe(false)
    expect(isAcceptableRedirectUri('https://app.example/cb#frag')).toBe(false)
    expect(isAcceptableRedirectUri('https://user:pw@app.example/cb')).toBe(false)
    expect(isAcceptableRedirectUri('cursor://anysphere/cb')).toBe(false)
    expect(isAcceptableRedirectUri('javascript:alert(1)')).toBe(false)
  })

  it('matches exactly; on loopback only the port may differ (RFC 8252 §7.3)', () => {
    const reg = ['https://app.example/cb', 'http://localhost:3000/callback']
    expect(redirectUriMatches(reg, 'https://app.example/cb')).toBe(true)
    expect(redirectUriMatches(reg, 'https://app.example/cb/')).toBe(false)
    expect(redirectUriMatches(reg, 'https://app.example/cb?x=1')).toBe(false)
    expect(redirectUriMatches(reg, 'https://APP.example/cb')).toBe(false)
    expect(redirectUriMatches(reg, 'https://app.example:8443/cb')).toBe(false)
    expect(redirectUriMatches(reg, 'http://localhost:61234/callback')).toBe(true)
    expect(redirectUriMatches(reg, 'http://localhost:61234/other')).toBe(false)
    expect(redirectUriMatches(reg, 'http://127.0.0.1:3000/callback')).toBe(false)
    expect(redirectUriMatches(reg, 'http://localhost.evil.example:3000/callback')).toBe(false)
  })
})

describe('RFC 7591 client metadata', () => {
  it('defaults to client_secret_basic, authorization_code and code', () => {
    expect(validateClientMetadata({ redirect_uris: ['https://a.example/cb'] })).toMatchObject({
      authMethod: 'client_secret_basic', grantTypes: ['authorization_code'], name: null,
    })
    expect(validateClientMetadata({
      redirect_uris: ['http://localhost:1/cb'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'],
      client_name: '  Claude\u0000 Code  ', application_type: 'native',
    })).toMatchObject({ authMethod: 'none', grantTypes: ['authorization_code', 'refresh_token'], name: 'Claude Code', applicationType: 'native' })
  })

  it('rejects implicit/password grants, other response types, bad redirect URIs', () => {
    const bad = (m: unknown, code: string) => {
      try {
        validateClientMetadata(m)
        throw new Error('accepted')
      } catch (e) {
        expect(e).toBeInstanceOf(OAuthError)
        expect((e as OAuthError).code).toBe(code)
      }
    }
    bad({ redirect_uris: [] }, 'invalid_redirect_uri')
    bad({ redirect_uris: ['http://evil.example/cb'] }, 'invalid_redirect_uri')
    bad({ redirect_uris: ['https://a.example/cb'], grant_types: ['implicit'] }, 'invalid_client_metadata')
    bad({ redirect_uris: ['https://a.example/cb'], grant_types: ['refresh_token'] }, 'invalid_client_metadata')
    bad({ redirect_uris: ['https://a.example/cb'], response_types: ['token'] }, 'invalid_client_metadata')
    bad({ redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'private_key_jwt' }, 'invalid_client_metadata')
    bad({ redirect_uris: ['https://a.example/cb'], scope: 'root' }, 'invalid_client_metadata')
    bad('nope', 'invalid_client_metadata')
  })
})

describe('client authentication parsing', () => {
  it('reads client_secret_basic (form-urlencoded parts) and form credentials', () => {
    const basic = `Basic ${Buffer.from(`${encodeURIComponent('mcpc_abc')}:${encodeURIComponent('s:e/c r+t')}`).toString('base64')}`
    expect(readClientCredentials(basic, new URLSearchParams())).toEqual({ clientId: 'mcpc_abc', secret: 's:e/c r+t', method: 'client_secret_basic' })
    expect(readClientCredentials(null, new URLSearchParams('client_id=mcpc_x'))).toEqual({ clientId: 'mcpc_x', secret: null, method: 'none' })
    expect(readClientCredentials(null, new URLSearchParams('client_id=mcpc_x&client_secret=y'))).toMatchObject({ method: 'client_secret_post' })
    const mismatch = readClientCredentials(basic, new URLSearchParams('client_id=mcpc_other'))
    expect(mismatch).toBeInstanceOf(OAuthError)
  })
})

describe('discovery documents', () => {
  const origin = 'https://portal.test'

  it('protected resource metadata names the MCP URL and this server as the AS', () => {
    const prm = protectedResourceMetadata(origin)
    expect(prm.resource).toBe('https://portal.test/api/mcp')
    expect(prm.authorization_servers).toEqual([origin])
    expect(prm.bearer_methods_supported).toEqual(['header'])
    expect(prm.scopes_supported).not.toContain('offline_access')
  })

  it('authorization server metadata: issuer, endpoints, S256 only, code only, iss parameter', () => {
    const as = authorizationServerMetadata(origin)
    expect(as.issuer).toBe(origin)
    expect(as.authorization_endpoint).toBe(`${origin}/api/oauth/authorize`)
    expect(as.token_endpoint).toBe(`${origin}/api/oauth/token`)
    expect(as.registration_endpoint).toBe(`${origin}/api/oauth/register`)
    expect(as.revocation_endpoint).toBe(`${origin}/api/oauth/revoke`)
    expect(as.code_challenge_methods_supported).toEqual(['S256'])
    expect(as.response_types_supported).toEqual(['code'])
    expect(as.grant_types_supported).toEqual(['authorization_code', 'refresh_token'])
    expect(as.authorization_response_iss_parameter_supported).toBe(true)
  })

  it('derives the origin from forwarded headers; resource comparison per RFC 8707', () => {
    const h = new Headers({ 'x-forwarded-host': 'Portal.AIStart360.app', 'x-forwarded-proto': 'https' })
    expect(publicOrigin(h)).toBe('https://portal.aistart360.app')
    expect(mcpResourceUrl('https://p.test')).toBe('https://p.test/api/mcp')
    expect(resourceMetadataUrl('https://p.test')).toBe('https://p.test/.well-known/oauth-protected-resource/api/mcp')
    expect(sameResource('HTTPS://P.TEST/api/mcp', 'https://p.test/api/mcp')).toBe(true)
    expect(sameResource('https://p.test/api/mcp/', 'https://p.test/api/mcp')).toBe(true)
    expect(sameResource('https://p.test/api/mcp#x', 'https://p.test/api/mcp')).toBe(false)
    expect(sameResource('https://p.test', 'https://p.test/api/mcp')).toBe(false)
    expect(sameResource('https://other.test/api/mcp', 'https://p.test/api/mcp')).toBe(false)
  })

  it('challenge and bearer parsing', () => {
    expect(bearerToken('Bearer a360_pat_abc')).toBe('a360_pat_abc')
    expect(bearerToken('bearer   a360_pat_abc')).toBe('a360_pat_abc')
    expect(bearerToken('Basic abc')).toBeNull()
    expect(bearerToken(null)).toBeNull()
    const h = wwwAuthenticate(origin, { error: 'insufficient_scope', scope: 'spend:read', description: 'Нужно право spend:read' })
    expect(h).toBe('Bearer error="insufficient_scope", resource_metadata="https://portal.test/.well-known/oauth-protected-resource/api/mcp", scope="spend:read", error_description="The access token does not grant the required scope"')
    expect(wwwAuthenticate(origin, { error: 'insufficient_scope', scope: 'spend:read', description: 'Scope spend:read required' })).toContain('error_description="Scope spend:read required"')
  })

  it('authorization responses keep the redirect URI query and add iss', () => {
    expect(authorizationRedirect('http://localhost:3000/cb?x=1', { code: 'c', state: 's', iss: origin, error: null }))
      .toBe('http://localhost:3000/cb?x=1&code=c&state=s&iss=https%3A%2F%2Fportal.test')
  })
})
