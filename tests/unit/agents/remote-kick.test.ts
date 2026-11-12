/**
 * lib/agents/remote-kick.ts — the portal (PORTAL_ROLE=web) hands a freshly queued task to the
 * agents service: one small authenticated POST over the private network. The task is already in
 * Postgres, so a hand-over that fails loses nothing (the service's own drain picks the task up),
 * and the function never throws. The network is a stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { kickAgentsService } from '@/lib/agents/remote-kick'

const TASK = '3f2b7c1e-8a54-4d0b-9c6e-1f2a3b4c5d6e'
const SECRET = 'cron-secret-for-tests'
const ENV = { AGENTS_SERVICE_URL: 'http://agents.railway.internal:8080', CRON_SECRET: SECRET }
const NO_URL_LINE = '[agents] AGENTS_SERVICE_URL не задан — задача ждёт планового разбора очереди'
// "Once per process" is a flag on globalThis (see the module): every test starts without it.
const NO_URL_LOGGED = Symbol.for('aistart360.agents.kick.no_url_logged')
const clearFlag = () => { delete (globalThis as Record<symbol, unknown>)[NO_URL_LOGGED] }

function setup(answer: () => Promise<Response> | Response = () => new Response(null, { status: 202 })) {
  const lines: string[] = []
  const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => answer())
  const deps = { fetch: fetchImpl as unknown as typeof fetch, env: ENV as Partial<NodeJS.ProcessEnv>, log: (line: string) => { lines.push(line) } }
  return { lines, fetchImpl, deps }
}

beforeEach(clearFlag)
afterEach(() => {
  clearFlag()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('kickAgentsService: the request', () => {
  it('POSTs the task id to /api/internal/agents/kick of the agents service, with the cron secret as a bearer token', async () => {
    const t = setup()

    await expect(kickAgentsService(TASK, t.deps)).resolves.toBe('sent')

    expect(t.fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = t.fetchImpl.mock.calls[0]
    expect(url).toBe('http://agents.railway.internal:8080/api/internal/agents/kick')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${SECRET}`)
    expect(headers.get('content-type')).toBe('application/json')
    expect(init?.body).toBe(`{"taskId":"${TASK}"}`)
    expect(t.lines).toEqual([])
  })

  it('a trailing slash in AGENTS_SERVICE_URL does not double up', async () => {
    const t = setup()
    await kickAgentsService(TASK, { ...t.deps, env: { ...ENV, AGENTS_SERVICE_URL: 'http://agents.railway.internal:8080/' } })
    expect(t.fetchImpl.mock.calls[0][0]).toBe('http://agents.railway.internal:8080/api/internal/agents/kick')
  })

  it('gives the request 3 seconds', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const t = setup()

    await kickAgentsService(TASK, t.deps)

    expect(timeout).toHaveBeenCalledWith(3000)
    expect(t.fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('any 2xx answer is "sent", and the body nobody reads is released', async () => {
    const cancel = vi.fn(async () => {})
    for (const status of [200, 202, 204]) {
      const t = setup(() => ({ ok: true, status, body: { cancel } }) as unknown as Response)
      await expect(kickAgentsService(TASK, t.deps), `status=${status}`).resolves.toBe('sent')
      expect(t.lines).toEqual([])
    }
    expect(cancel).toHaveBeenCalledTimes(3)
  })

  it('by default it uses the global fetch, process.env and console.error', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchImpl)
    vi.stubEnv('AGENTS_SERVICE_URL', 'http://agents.railway.internal:3000')
    vi.stubEnv('CRON_SECRET', SECRET)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(kickAgentsService(TASK)).resolves.toBe('failed')

    expect(fetchImpl.mock.calls[0][0]).toBe('http://agents.railway.internal:3000/api/internal/agents/kick')
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('authorization')).toBe(`Bearer ${SECRET}`)
    expect(error.mock.calls).toEqual([['[agents] kick failed: 500']])
  })
})

describe('kickAgentsService: no address of the agents service', () => {
  it('sends nothing, answers "no_url" and says so in the log', async () => {
    const t = setup()

    await expect(kickAgentsService(TASK, { ...t.deps, env: { CRON_SECRET: SECRET } })).resolves.toBe('no_url')

    expect(t.fetchImpl).not.toHaveBeenCalled()
    expect(t.lines).toEqual([NO_URL_LINE])
  })

  it('logs it once per process, however many tasks are queued', async () => {
    const t = setup()
    const env = { CRON_SECRET: SECRET }

    for (let i = 0; i < 5; i += 1) {
      await expect(kickAgentsService(`${TASK.slice(0, -1)}${i}`, { ...t.deps, env })).resolves.toBe('no_url')
    }

    expect(t.lines).toEqual([NO_URL_LINE])
    expect(t.fetchImpl).not.toHaveBeenCalled()
  })

  it('once per process means once for every copy of the module (the flag is on globalThis)', async () => {
    const t = setup()
    await kickAgentsService(TASK, { ...t.deps, env: {} })
    expect(t.lines).toHaveLength(1)

    vi.resetModules()
    const copy = await import('@/lib/agents/remote-kick')
    await expect(copy.kickAgentsService(TASK, { ...t.deps, env: {} })).resolves.toBe('no_url')

    expect(t.lines).toHaveLength(1)
  })

  it('an address that is not a valid http(s) URL counts as none', async () => {
    for (const value of ['', '  ', 'agents.railway.internal:8080', 'ftp://agents.railway.internal', 'not a url']) {
      clearFlag()
      const t = setup()
      await expect(kickAgentsService(TASK, { ...t.deps, env: { ...ENV, AGENTS_SERVICE_URL: value } }), value).resolves.toBe('no_url')
      expect(t.fetchImpl).not.toHaveBeenCalled()
      expect(t.lines).toEqual([NO_URL_LINE])
    }
  })
})

describe('kickAgentsService: a hand-over that fails', () => {
  it('an answer that is not 2xx is "failed" and logged by its status', async () => {
    for (const status of [401, 404, 500, 503]) {
      const t = setup(() => new Response('{"ok":false}', { status }))
      await expect(kickAgentsService(TASK, t.deps), `status=${status}`).resolves.toBe('failed')
      expect(t.lines).toEqual([`[agents] kick failed: ${status}`])
    }
  })

  it('a network error is "failed" and logged by its code: the service is down, the name does not resolve', async () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET']) {
      const t = setup(() => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`connect ${code} fd12::1:8080`), { code }) }) })
      await expect(kickAgentsService(TASK, t.deps), code).resolves.toBe('failed')
      expect(t.lines).toEqual([`[agents] kick failed: ${code}`])
    }
  })

  it('the 3 second timeout is "failed" and logged by its name', async () => {
    const t = setup(() => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') })
    await expect(kickAgentsService(TASK, t.deps)).resolves.toBe('failed')
    expect(t.lines).toEqual(['[agents] kick failed: TimeoutError'])
  })

  it('an error without a code is logged by its name, anything else as "error"', async () => {
    const plain = setup(() => { throw new TypeError('fetch failed') })
    await kickAgentsService(TASK, plain.deps)
    expect(plain.lines).toEqual(['[agents] kick failed: TypeError'])

    const own = setup(() => { throw Object.assign(new Error('boom'), { code: 'ERR_INVALID_URL' }) })
    await kickAgentsService(TASK, own.deps)
    expect(own.lines).toEqual(['[agents] kick failed: ERR_INVALID_URL'])

    const odd = setup(() => Promise.reject('a string, not an error'))
    await expect(kickAgentsService(TASK, odd.deps)).resolves.toBe('failed')
    expect(odd.lines).toEqual(['[agents] kick failed: error'])
  })

  it('never logs the message of the error, the secret or the address', async () => {
    const t = setup(() => {
      throw Object.assign(new TypeError(`fetch failed for ${ENV.AGENTS_SERVICE_URL} (Authorization: Bearer ${SECRET})`), {
        cause: Object.assign(new Error(`connect to ${ENV.AGENTS_SERVICE_URL} with ${SECRET}`), { code: `oops ${SECRET}` }),
      })
    })

    await kickAgentsService(TASK, t.deps)

    expect(t.lines).toHaveLength(1)
    expect(t.lines[0]).toBe('[agents] kick failed: TypeError') // a code that is not a plain token is not trusted
    expect(t.lines.join('\n')).not.toContain(SECRET)
    expect(t.lines.join('\n')).not.toContain('railway.internal')
  })

  it('every failure is logged, not only the first', async () => {
    const t = setup(() => new Response(null, { status: 503 }))
    await kickAgentsService(TASK, t.deps)
    await kickAgentsService(TASK, t.deps)
    expect(t.lines).toEqual(['[agents] kick failed: 503', '[agents] kick failed: 503'])
  })

  it('without CRON_SECRET nothing is sent: the service could not accept it', async () => {
    for (const env of [{ AGENTS_SERVICE_URL: ENV.AGENTS_SERVICE_URL }, { ...ENV, CRON_SECRET: '' }]) {
      const t = setup()
      await expect(kickAgentsService(TASK, { ...t.deps, env })).resolves.toBe('failed')
      expect(t.fetchImpl).not.toHaveBeenCalled()
      expect(t.lines).toEqual(['[agents] kick failed: NO_CRON_SECRET'])
    }
  })
})

describe('kickAgentsService: never throws', () => {
  it('a fetch that throws synchronously is a failed hand-over', async () => {
    const lines: string[] = []
    const fetchImpl = (() => { throw Object.assign(new Error('bad'), { code: 'ERR_SYNC' }) }) as unknown as typeof fetch

    await expect(kickAgentsService(TASK, { fetch: fetchImpl, env: ENV, log: (line) => { lines.push(line) } })).resolves.toBe('failed')

    expect(lines).toEqual(['[agents] kick failed: ERR_SYNC'])
  })

  it('a logger that throws does not turn into a rejection', async () => {
    const boom = () => { throw new Error('logger down') }
    const failing = setup(() => new Response(null, { status: 500 }))

    await expect(kickAgentsService(TASK, { ...failing.deps, log: boom })).resolves.toBe('failed')
    await expect(kickAgentsService(TASK, { ...failing.deps, env: {}, log: boom })).resolves.toBe('no_url')
  })

  it('a body that cannot be released is still "sent"', async () => {
    const t = setup(() => ({ ok: true, status: 202, body: { cancel: async () => { throw new Error('already closed') } } }) as unknown as Response)
    await expect(kickAgentsService(TASK, t.deps)).resolves.toBe('sent')
  })
})
