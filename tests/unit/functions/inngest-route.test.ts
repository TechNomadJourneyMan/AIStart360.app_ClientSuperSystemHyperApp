/**
 * app/api/inngest/route.ts — the route serves the functions of the role this process booted with:
 * inngestFunctionsForRole(portalRole()). The lists themselves are pinned in registry.test.ts; here
 * only the wiring is checked, so the Inngest handler and the registry are stubs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  served: [] as Array<{ client: unknown; functions: unknown }>,
  handlers: { GET: () => 'GET', POST: () => 'POST', PUT: () => 'PUT' },
  client: { id: 'the-inngest-client' },
}))
vi.mock('inngest/next', () => ({
  serve: (options: { client: unknown; functions: unknown }) => {
    h.served.push(options)
    return h.handlers
  },
}))
vi.mock('@/lib/inngest', () => ({ inngest: h.client }))
vi.mock('@/lib/functions/registry', () => ({
  inngestFunctionsForRole: (role: string) => [`functions-of-${role}`],
}))

async function loadRoute() {
  vi.resetModules()
  return import('@/app/api/inngest/route')
}

beforeEach(() => {
  h.served.length = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('/api/inngest', () => {
  it('without PORTAL_ROLE it serves the functions of one process for everything', async () => {
    vi.stubEnv('PORTAL_ROLE', '')

    const route = await loadRoute()

    expect(h.served).toEqual([{ client: h.client, functions: ['functions-of-all'] }])
    expect(route.GET).toBe(h.handlers.GET)
    expect(route.POST).toBe(h.handlers.POST)
    expect(route.PUT).toBe(h.handlers.PUT) // PUT is the sync: it re-registers the list with Inngest
  })

  it('PORTAL_ROLE=web: the functions of the web role', async () => {
    vi.stubEnv('PORTAL_ROLE', 'web')
    await loadRoute()
    expect(h.served).toEqual([{ client: h.client, functions: ['functions-of-web'] }])
  })

  it('PORTAL_ROLE=agents: the functions of the agents role (none)', async () => {
    vi.stubEnv('PORTAL_ROLE', 'agents')
    await loadRoute()
    expect(h.served).toEqual([{ client: h.client, functions: ['functions-of-agents'] }])
  })

  it('stays a Node route with the short limit of a run', async () => {
    const route = await loadRoute()
    expect(route.runtime).toBe('nodejs')
    expect(route.maxDuration).toBe(120)
  })
})
