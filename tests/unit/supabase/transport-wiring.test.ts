/**
 * Middleware runs in the Edge runtime, whose global scope is its own: the wrapper instrumentation.ts
 * puts over the Node server's globalThis.fetch does not exist there. So everything middleware sends
 * to Supabase goes through one explicit wrapper (lib/supabase/transport-edge.ts): the session client
 * of lib/supabase/middleware.ts and the plain PostgREST calls of the *-edge helpers.
 *
 * (register() installing the wrapper on the Node runtime: tests/unit/infra/instrumentation.test.ts.)
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const SUPABASE = 'https://db.example.test'
const INTERNAL = 'http://gateway.internal:8000'
const SESSION_ID = '00000000-0000-4000-8000-000000000001'

const ssr = vi.hoisted(() => ({
  options: null as null | { global?: { fetch?: typeof fetch } },
  session: null as null | { access_token: string },
  user: null as null | { id: string },
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { global?: { fetch?: typeof fetch } }) => {
    ssr.options = options
    return {
      auth: {
        getSession: async () => ({ data: { session: ssr.session }, error: null }),
        getUser: async () => ({ data: { user: ssr.user }, error: null }),
      },
    }
  },
}))

type Step = Response | Error

/** Replaces the global fetch with one that answers from a script, one step per call. */
function scriptFetch(steps: Step[]) {
  const queue = [...steps]
  const mock = vi.fn<typeof fetch>(async () => {
    const step = queue.shift()
    if (!step) throw new Error('unscripted fetch call')
    if (step instanceof Error) throw step
    return step
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
/** What Railway's edge sends when it answers instead of the gateway. */
const edgeFallback = () =>
  new Response('{"status":"error","code":404,"message":"Application not found","request_id":"r-1"}', {
    status: 404,
    headers: { 'x-railway-fallback': 'true' },
  })

function jwt(sub: string): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'HS256' })}.${part({ sub })}.signature`
}

const request = () => new NextRequest('http://localhost/dashboard')
const calledUrls = (mock: ReturnType<typeof scriptFetch>) => mock.mock.calls.map((call) => String(call[0]))
const calledMethods = (mock: ReturnType<typeof scriptFetch>) =>
  mock.mock.calls.map((call) => (call[1]?.method ?? 'GET').toUpperCase())

beforeEach(() => {
  // A wrapper, and helper caches, of this test's own.
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  vi.stubEnv('SUPABASE_INTERNAL_URL', '')
  ssr.options = null
  ssr.session = null
  ssr.user = null
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the session client of middleware', () => {
  it('is given the transport fetch', async () => {
    const fetchMock = scriptFetch([])
    const { updateSession } = await import('@/lib/supabase/middleware')
    const { edgeSupabaseFetch } = await import('@/lib/supabase/transport-edge')

    await updateSession(request())

    expect(ssr.options?.global?.fetch).toBe(edgeSupabaseFetch)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gets through an answer of the edge with it', async () => {
    const user = json({ id: 'u1' })
    const fetchMock = scriptFetch([edgeFallback(), user])
    const { updateSession } = await import('@/lib/supabase/middleware')
    await updateSession(request())
    const clientFetch = ssr.options?.global?.fetch
    if (!clientFetch) throw new Error('createServerClient was given no fetch')

    const response = await clientFetch(`${SUPABASE}/auth/v1/user`, { headers: { apikey: 'anon-key' } })

    expect(response).toBe(user)
    expect(calledUrls(fetchMock)).toEqual([`${SUPABASE}/auth/v1/user`, `${SUPABASE}/auth/v1/user`])
    expect(console.warn).toHaveBeenCalledWith('[supabase-transport] retry 1/2 GET /auth/v1/user — edge fallback 404')
  })

  it('reads the own profile row through it', async () => {
    ssr.session = { access_token: jwt('u1') }
    ssr.user = { id: 'u1' }
    const fetchMock = scriptFetch([edgeFallback(), json([{ role: 'client', status: 'approved' }])])
    const { updateSession } = await import('@/lib/supabase/middleware')

    const out = await updateSession(request())

    expect(out.profile).toEqual({ role: 'client', status: 'approved' })
    const profileUrl = `${SUPABASE}/rest/v1/profiles?id=eq.u1&select=role,status`
    expect(calledUrls(fetchMock)).toEqual([profileUrl, profileUrl])
  })
})

describe('plain PostgREST calls of the Edge helpers', () => {
  it('edgeSettings: the maintenance switch is read although the edge answered first', async () => {
    const fetchMock = scriptFetch([
      edgeFallback(),
      json([
        { key: 'maintenance', value: { enabled: true, message: 'Техработы', until: '' } },
        { key: 'staff_require_mfa', value: true },
      ]),
    ])
    const { edgeSettings } = await import('@/lib/settings/edge')

    expect(await edgeSettings()).toEqual({
      maintenance: { enabled: true, message: 'Техработы', until: '' },
      staff_require_mfa: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sections-edge: the section list and the user facts (POST) are read although the edge answered first', async () => {
    const sections = [
      { key: 'content', paths: ['/client/content'], enabled: true, visibility: { audience: 'segments', segments: ['survey_completed'] } },
    ]
    const facts = { status: 'approved', tier: 'free', vertical: 'generic', created_at: '2026-01-01', survey_steps: 12, gri_runs: 0, is_staff: false }
    const fetchMock = scriptFetch([edgeFallback(), json(sections), edgeFallback(), json(facts)])
    const { blockedSectionFor } = await import('@/lib/platform/sections-edge')

    // A lost list would open every section; lost facts would close this one.
    expect(await blockedSectionFor('/client/content/intro', 'u1')).toBeNull()

    expect(calledMethods(fetchMock)).toEqual(['GET', 'GET', 'POST', 'POST'])
    expect(calledUrls(fetchMock).slice(2)).toEqual([
      `${SUPABASE}/rest/v1/rpc/user_segment_facts`,
      `${SUPABASE}/rest/v1/rpc/user_segment_facts`,
    ])
  })

  it('impersonation: an answer of the edge does not end a live session', async () => {
    const fetchMock = scriptFetch([
      edgeFallback(),
      json([{ ended_at: null, expires_at: new Date(Date.now() + 60_000).toISOString() }]),
    ])
    const { isImpersonationActiveEdge } = await import('@/lib/impersonation/edge')

    expect(await isImpersonationActiveEdge(SESSION_ID)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('impersonation: the audit row (POST) and the close (PATCH) are sent again after an answer of the edge', async () => {
    const fetchMock = scriptFetch([edgeFallback(), new Response(null, { status: 201 }), edgeFallback(), new Response(null, { status: 204 })])
    const { auditImpersonatedRequestEdge, endImpersonationEdge } = await import('@/lib/impersonation/edge')

    await auditImpersonatedRequestEdge({
      sid: SESSION_ID,
      adminId: 'admin-1',
      adminLabel: 'admin',
      targetUserId: 'u1',
      method: 'POST',
      path: '/api/v1/goals',
      ip: null,
      ua: null,
    })
    await endImpersonationEdge(SESSION_ID, 'expired')

    expect(calledMethods(fetchMock)).toEqual(['POST', 'POST', 'PATCH', 'PATCH'])
    expect(calledUrls(fetchMock)[1]).toBe(`${SUPABASE}/rest/v1/admin_audit_log`)
    // the same body both times
    expect(fetchMock.mock.calls[1][1]?.body).toBe(fetchMock.mock.calls[0][1]?.body)
  })

  it('leaves a call that already has an answer from the gateway alone', async () => {
    const fetchMock = scriptFetch([json({ message: 'JWT expired' }, 401)])
    const { edgeSettings } = await import('@/lib/settings/edge')

    expect(await edgeSettings()).toEqual({ maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('the wrapper itself', () => {
  it('does nothing at import; on first use it probes the private path without holding the request', async () => {
    vi.stubEnv('SUPABASE_INTERNAL_URL', INTERNAL)
    const probeUrl = `${INTERNAL}/auth/v1/settings`
    let answerProbe!: (response: Response) => void
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) =>
      String(input) === probeUrl ? new Promise<Response>((resolve) => { answerProbe = resolve }) : json([]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { edgeSupabaseFetch } = await import('@/lib/supabase/transport-edge')
    expect(fetchMock).not.toHaveBeenCalled()

    // The probe is out and unanswered: the request itself uses the public origin and returns.
    const profiles = `${SUPABASE}/rest/v1/profiles?select=role`
    await edgeSupabaseFetch(profiles)
    expect(calledUrls(fetchMock)).toEqual([probeUrl, profiles])
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('apikey')).toBe('anon-key')

    // Once the probe is answered, the first attempt goes over the private network…
    answerProbe(new Response('{}', { status: 200 }))
    await vi.waitFor(async () => {
      await edgeSupabaseFetch(profiles)
      expect(calledUrls(fetchMock).at(-1)).toBe(`${INTERNAL}/rest/v1/profiles?select=role`)
    })

    // …for the helpers too, which shows they share this wrapper. And it was probed once.
    const { edgeSettings } = await import('@/lib/settings/edge')
    await edgeSettings()
    expect(calledUrls(fetchMock).at(-1)).toBe(
      `${INTERNAL}/rest/v1/system_settings?select=key,value&key=in.(maintenance,staff_require_mfa)`,
    )
    expect(calledUrls(fetchMock).filter((url) => url === probeUrl)).toHaveLength(1)
  })

  it('uses whatever the global fetch is at the time of the call', async () => {
    const { edgeSupabaseFetch } = await import('@/lib/supabase/transport-edge')
    const first = scriptFetch([json([1])])
    await edgeSupabaseFetch(`${SUPABASE}/rest/v1/profiles`)
    const second = scriptFetch([json([2])])
    await edgeSupabaseFetch(`${SUPABASE}/rest/v1/profiles`)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('passes a call to another host through untouched', async () => {
    const unavailable = json({ error: 'overloaded' }, 503)
    const fetchMock = scriptFetch([unavailable])
    const { edgeSupabaseFetch } = await import('@/lib/supabase/transport-edge')
    const init: RequestInit = { method: 'POST', body: '{}' }

    expect(await edgeSupabaseFetch('https://api.telegram.org/bot0/sendMessage', init)).toBe(unavailable)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.telegram.org/bot0/sendMessage')
    expect(fetchMock.mock.calls[0][1]).toBe(init)
  })

  // Both modules end up in the middleware bundle: Web APIs only, no Node built-ins.
  it('is Edge-safe: the transport modules import nothing but each other', () => {
    const source = (file: string) => readFileSync(file, 'utf8')
    const imported = (file: string) =>
      [...source(file).matchAll(/^\s*(?:import|export)\s[^'"]*from\s*['"]([^'"]+)['"]/gm)].map((match) => match[1])

    expect(imported('lib/supabase/transport.ts')).toEqual([])
    expect(imported('lib/supabase/transport-edge.ts')).toEqual(['./transport'])
    for (const file of ['lib/supabase/transport.ts', 'lib/supabase/transport-edge.ts']) {
      expect(source(file)).not.toMatch(/\brequire\(|\bBuffer\b|['"]node:/)
    }
  })
})
