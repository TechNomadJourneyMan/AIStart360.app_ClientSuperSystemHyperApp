/**
 * lib/runtime/role.ts — what a process is for. The same build runs as the portal, as the agents
 * service, or as both in one process; both is the default, so a deployment that sets nothing
 * (local development, tests, the single service) behaves as it always did.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentsServiceUrl, portalRole, runsAgentWork, servesWeb } from '@/lib/runtime/role'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('portalRole', () => {
  it('is "all" when PORTAL_ROLE is not set or empty', () => {
    expect(portalRole({})).toBe('all')
    expect(portalRole({ PORTAL_ROLE: '' })).toBe('all')
    expect(portalRole({ PORTAL_ROLE: '   ' })).toBe('all')
  })

  it('reads web and agents', () => {
    expect(portalRole({ PORTAL_ROLE: 'web' })).toBe('web')
    expect(portalRole({ PORTAL_ROLE: 'agents' })).toBe('agents')
  })

  it('ignores case and surrounding spaces', () => {
    expect(portalRole({ PORTAL_ROLE: ' Web ' })).toBe('web')
    expect(portalRole({ PORTAL_ROLE: 'AGENTS\n' })).toBe('agents')
  })

  it('anything else is "all": a typo must not switch agent work off', () => {
    for (const value of ['all', 'ALL', 'agent', 'worker', 'web,agents', 'web agents', '1', 'true']) {
      expect(portalRole({ PORTAL_ROLE: value }), value).toBe('all')
    }
  })

  it('reads process.env by default', () => {
    vi.stubEnv('PORTAL_ROLE', 'agents')
    expect(portalRole()).toBe('agents')
    vi.stubEnv('PORTAL_ROLE', '')
    expect(portalRole()).toBe('all')
  })
})

describe('runsAgentWork', () => {
  it('everything but the web role runs agent work', () => {
    expect(runsAgentWork('all')).toBe(true)
    expect(runsAgentWork('agents')).toBe(true)
    expect(runsAgentWork('web')).toBe(false)
  })

  it('takes the role of this process by default', () => {
    vi.stubEnv('PORTAL_ROLE', '')
    expect(runsAgentWork()).toBe(true)
    vi.stubEnv('PORTAL_ROLE', 'web')
    expect(runsAgentWork()).toBe(false)
    vi.stubEnv('PORTAL_ROLE', 'agents')
    expect(runsAgentWork()).toBe(true)
  })
})

describe('servesWeb', () => {
  it('everything but the agents role is the portal', () => {
    expect(servesWeb('all')).toBe(true)
    expect(servesWeb('web')).toBe(true)
    expect(servesWeb('agents')).toBe(false)
  })

  it('takes the role of this process by default', () => {
    vi.stubEnv('PORTAL_ROLE', '')
    expect(servesWeb()).toBe(true)
    vi.stubEnv('PORTAL_ROLE', 'agents')
    expect(servesWeb()).toBe(false)
    vi.stubEnv('PORTAL_ROLE', 'web')
    expect(servesWeb()).toBe(true)
  })
})

describe('agentsServiceUrl', () => {
  it('is null when AGENTS_SERVICE_URL is not set or empty', () => {
    expect(agentsServiceUrl({})).toBeNull()
    expect(agentsServiceUrl({ AGENTS_SERVICE_URL: '' })).toBeNull()
    expect(agentsServiceUrl({ AGENTS_SERVICE_URL: '  ' })).toBeNull()
  })

  it('returns an http(s) address as it is', () => {
    expect(agentsServiceUrl({ AGENTS_SERVICE_URL: 'http://agents.railway.internal:8080' })).toBe('http://agents.railway.internal:8080')
    expect(agentsServiceUrl({ AGENTS_SERVICE_URL: 'https://agents.example.test' })).toBe('https://agents.example.test')
  })

  it('removes the trailing slash and surrounding spaces, so a path can be appended', () => {
    expect(agentsServiceUrl({ AGENTS_SERVICE_URL: 'http://agents.railway.internal:8080/' })).toBe('http://agents.railway.internal:8080')
    expect(agentsServiceUrl({ AGENTS_SERVICE_URL: ' http://agents.railway.internal:8080// ' })).toBe('http://agents.railway.internal:8080')
    expect(agentsServiceUrl({ AGENTS_SERVICE_URL: 'http://agents.railway.internal:8080/base/' })).toBe('http://agents.railway.internal:8080/base')
  })

  it('keeps an IPv6 host', () => {
    expect(agentsServiceUrl({ AGENTS_SERVICE_URL: 'http://[fd12:3456:789a::1]:8080/' })).toBe('http://[fd12:3456:789a::1]:8080')
  })

  it('keeps only the origin and the path: a query, a fragment or credentials are not part of a service address', () => {
    expect(agentsServiceUrl({ AGENTS_SERVICE_URL: 'http://agents.railway.internal:8080/?x=1#top' })).toBe('http://agents.railway.internal:8080')
    expect(agentsServiceUrl({ AGENTS_SERVICE_URL: 'http://user:pw@agents.railway.internal:8080' })).toBe('http://agents.railway.internal:8080')
  })

  it('is null for anything that is not a valid http(s) URL', () => {
    for (const value of [
      'agents.railway.internal:8080', // no scheme: parsed as the scheme "agents.railway.internal:"
      'agents.railway.internal',
      'ftp://agents.railway.internal',
      'ws://agents.railway.internal:8080',
      'http://',
      'http//agents',
      'not a url',
    ]) {
      expect(agentsServiceUrl({ AGENTS_SERVICE_URL: value }), value).toBeNull()
    }
  })

  it('reads process.env by default', () => {
    vi.stubEnv('AGENTS_SERVICE_URL', 'http://agents.railway.internal:3000/')
    expect(agentsServiceUrl()).toBe('http://agents.railway.internal:3000')
    vi.stubEnv('AGENTS_SERVICE_URL', '')
    expect(agentsServiceUrl()).toBeNull()
  })
})
