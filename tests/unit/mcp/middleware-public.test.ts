/**
 * The OAuth discovery documents of the MCP server must be reachable without a
 * session (MCP clients fetch them before any sign-in); the consent screen
 * must NOT be — an anonymous visitor goes to /login and comes back to the
 * same /oauth/consent/<id> path (the request id lives in the path so the
 * login and 2FA redirects keep it).
 */
import { describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (request: NextRequest) => ({
    response: NextResponse.next({ request }),
    user: null,
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) },
  }),
}))

import { middleware } from '../../../middleware'

const req = (path: string) => new NextRequest(new URL(path, 'http://localhost:3000'))

describe('middleware and the MCP OAuth paths', () => {
  it('lets the discovery documents through without a session', async () => {
    for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp', '/.well-known/oauth-authorization-server']) {
      const res = await middleware(req(p))
      expect(res.headers.get('location'), p).toBeNull()
      expect(res.headers.get('x-middleware-next'), p).toBe('1')
    }
  })

  it('does not open other .well-known paths', async () => {
    const res = await middleware(req('/.well-known/oauth-authorization-server-evil'))
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })

  it('sends an anonymous visitor of the consent screen to /login with the same path to return to', async () => {
    const id = '0b6f8f0e-7a0c-4a51-9d39-6a0f1f0a8d11'
    const res = await middleware(req(`/oauth/consent/${id}`))
    const loc = new URL(res.headers.get('location')!)
    expect(loc.pathname).toBe('/login')
    expect(loc.searchParams.get('from')).toBe(`/oauth/consent/${id}`)
  })
})
