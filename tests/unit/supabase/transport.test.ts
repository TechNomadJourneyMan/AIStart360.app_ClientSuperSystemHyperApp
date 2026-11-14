/**
 * lib/supabase/transport.ts — the fetch the portal uses for its own Supabase gateway. The hosting
 * edge can answer such a request by itself (404 + `x-railway-fallback: true`; the gateway never
 * sees it): the wrapper sends that request again, never re-sends one that may have been executed,
 * and leaves every other host alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  INTERNAL_COOLDOWN_MS,
  MAX_RETRIES,
  TRANSPORT_TIMEOUT_DEFAULTS,
  RETRY_DELAYS_MS,
  createSupabaseTransportFetch,
  installSupabaseTransport,
  type TransportOptions,
} from '@/lib/supabase/transport'

const PUBLIC = 'https://db.example.test'
const INTERNAL = 'http://gateway.internal:8000'
const MARKER = Symbol.for('aistart360.supabaseTransport')

type Step = Response | Error

/** A base fetch that answers from a script, one step per call. An unscripted call rejects. */
function scripted(steps: Step[]) {
  const queue = [...steps]
  return vi.fn<typeof fetch>(async () => {
    const step = queue.shift()
    if (!step) throw new Error('unscripted fetch call')
    if (step instanceof Error) throw step
    return step
  })
}

const ok = (body = '[]') => new Response(body, { status: 200 })
const answer = (status: number) => new Response('upstream', { status })
/** What Railway's edge sends when it answers instead of the application. */
const edgeFallback = () =>
  new Response('{"status":"error","code":404,"message":"Application not found","request_id":"r-1"}', {
    status: 404,
    headers: { 'content-type': 'application/json', server: 'railway-hikari', 'x-railway-fallback': 'true' },
  })

/** The shape of a failed native fetch: TypeError('fetch failed') with the socket error as cause. */
function networkError(code?: string): TypeError {
  return code
    ? new TypeError('fetch failed', { cause: Object.assign(new Error(`connect ${code} 10.0.0.1:443`), { code }) })
    : new TypeError('fetch failed')
}

function setup(steps: Step[], options: { internal?: string; env?: TransportOptions['env']; random?: number } = {}) {
  const base = scripted(steps)
  const lines: string[] = []
  const sleeps: number[] = []
  const clock = { now: 1_700_000_000_000 }
  const transport = createSupabaseTransportFetch(base, {
    env: options.env ?? {
      NEXT_PUBLIC_SUPABASE_URL: PUBLIC,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_INTERNAL_URL: options.internal,
    },
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    log: (line) => {
      lines.push(line)
    },
    random: () => options.random ?? 0,
    now: () => clock.now,
  })
  return { base, transport, lines, sleeps, clock }
}

/** A wrapper whose private path has been probed successfully; `steps` answer what follows. */
async function active(steps: Step[]) {
  const context = setup([ok('{}'), ...steps], { internal: INTERNAL })
  await context.transport.probe()
  expect(context.transport.internalState()).toBe('active')
  context.base.mockClear()
  return context
}

const urls = (base: ReturnType<typeof scripted>) => base.mock.calls.map((call) => String(call[0]))

/** The init a base fetch saw, minus the per-attempt signal the transport adds (R-014). */
function withoutSignal(init: RequestInit | undefined): RequestInit | undefined {
  if (!init) return init
  const { signal: _signal, ...rest } = init
  return rest
}

describe('scope: only the Supabase origin is handled', () => {
  it('passes other origins through untouched', async () => {
    const calls: Array<Parameters<typeof fetch>> = [
      ['https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: '{"model":"m"}' }],
      [new URL('https://api.telegram.org/bot0/sendMessage'), { method: 'POST', body: '{"chat_id":1}' }],
      ['https://inn.gs/e/event-key'],
      [new Request('https://api.inngest.com/v1/events', { method: 'POST', body: '{}' })],
    ]
    // Answers that would be retried for the Supabase origin come back as they are.
    const answers = [answer(503), edgeFallback(), answer(502), ok()]
    const { base, transport, lines, sleeps } = setup(answers)

    for (const [index, args] of calls.entries()) {
      const response = await transport(...args)

      expect(response).toBe(answers[index])
      expect(base).toHaveBeenCalledTimes(index + 1)
      const seen = base.mock.calls[index]
      expect(seen).toHaveLength(args.length)
      expect(seen[0]).toBe(args[0])
      expect(seen[1]).toBe(args[1])
    }
    expect(sleeps).toEqual([])
    expect(lines).toEqual([])
  })

  it('does not retry a failed request to another origin', async () => {
    const failure = networkError('ECONNREFUSED')
    const { base, transport, lines, sleeps } = setup([failure])

    await expect(transport('https://api.telegram.org/bot0/getMe')).rejects.toBe(failure)

    expect(base).toHaveBeenCalledTimes(1)
    expect(sleeps).toEqual([])
    expect(lines).toEqual([])
  })

  it('passes a Request object through, even one for the Supabase origin', async () => {
    const fallback = edgeFallback()
    const { base, transport } = setup([fallback])
    const request = new Request(`${PUBLIC}/rest/v1/profiles?select=role`)
    const init: RequestInit = { headers: { apikey: 'anon-key' } }

    expect(await transport(request, init)).toBe(fallback)

    expect(base).toHaveBeenCalledTimes(1)
    expect(base.mock.calls[0][0]).toBe(request)
    expect(base.mock.calls[0][1]).toBe(init)
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['not a URL', 'db.example.test'],
    ['not http(s)', 'ftp://db.example.test'],
  ])('is a pass-through when the public URL is %s', async (_label, publicUrl) => {
    const fallback = edgeFallback()
    const { base, transport } = setup([fallback], {
      env: { NEXT_PUBLIC_SUPABASE_URL: publicUrl, SUPABASE_INTERNAL_URL: INTERNAL },
    })
    const url = `${PUBLIC}/rest/v1/profiles`

    expect(await transport(url)).toBe(fallback)

    expect(base).toHaveBeenCalledTimes(1)
    expect(base.mock.calls[0]).toEqual([url])
    // No public origin to stand in for: the private path is never used either.
    expect(transport.internalState()).toBe('off')
    expect(await transport.probe()).toBe(false)
    expect(base).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['another scheme', 'http://db.example.test/rest/v1/profiles'],
    ['another port', 'https://db.example.test:8443/rest/v1/profiles'],
    ['a longer host', 'https://db.example.test.evil.example/rest/v1/profiles'],
    ['a subdomain', 'https://x.db.example.test/rest/v1/profiles'],
    ['a relative URL', '/rest/v1/profiles'],
  ])('compares whole origins: %s is not handled', async (_label, url) => {
    const unavailable = answer(503)
    const { base, transport, sleeps } = setup([unavailable])

    expect(await transport(url)).toBe(unavailable)

    expect(base).toHaveBeenCalledTimes(1)
    expect(base.mock.calls[0][0]).toBe(url)
    expect(sleeps).toEqual([])
  })

  it('handles a string and a URL object, and hands the caller’s own input to the base fetch', async () => {
    for (const input of [`${PUBLIC}/rest/v1/profiles?select=role`, new URL(`${PUBLIC}/rest/v1/profiles?select=role`)]) {
      const good = ok()
      const { base, transport } = setup([edgeFallback(), good])

      expect(await transport(input)).toBe(good)

      expect(base).toHaveBeenCalledTimes(2)
      expect(base.mock.calls[0][0]).toBe(input)
      expect(base.mock.calls[1][0]).toBe(input)
    }
  })

  it('matches the origin whatever the letter case or an explicit default port', async () => {
    for (const url of ['https://DB.Example.Test/rest/v1/profiles', 'https://db.example.test:443/rest/v1/profiles']) {
      const good = ok()
      const { base, transport } = setup([edgeFallback(), good])

      expect(await transport(url)).toBe(good)
      expect(base).toHaveBeenCalledTimes(2)
    }
  })
})

describe('retry', () => {
  it('sends a request the edge answered by itself again, whatever the method', async () => {
    for (const method of ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE']) {
      const good = ok()
      const { base, transport } = setup([edgeFallback(), good])
      const url = `${PUBLIC}/rest/v1/profiles?id=eq.1`
      const init: RequestInit =
        method === 'GET' || method === 'HEAD'
          ? { method, headers: { apikey: 'anon-key' } }
          : { method, headers: { apikey: 'anon-key' }, body: '{"status":"approved"}' }

      expect(await transport(url, init)).toBe(good)

      expect(base).toHaveBeenCalledTimes(2)
      for (const call of base.mock.calls) {
        expect(call[0]).toBe(url)
        expect(withoutSignal(call[1])).toEqual(init)
      }
    }
  })

  it('returns a 404 of the gateway itself at once', async () => {
    const missing = new Response('{"code":"PGRST205"}', { status: 404, headers: { 'x-railway-fallback': 'false' } })
    const plain = answer(404)
    const { base, transport } = setup([missing, plain])

    expect(await transport(`${PUBLIC}/rest/v1/no_such_table`)).toBe(missing)
    expect(await transport(`${PUBLIC}/rest/v1/no_such_table`)).toBe(plain)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it.each([502, 503, 504])('retries %i without the header for GET and HEAD only', async (status) => {
    for (const method of ['GET', 'HEAD']) {
      const good = ok()
      const { base, transport, lines } = setup([answer(status), good])

      expect(await transport(`${PUBLIC}/rest/v1/profiles`, { method })).toBe(good)

      expect(base).toHaveBeenCalledTimes(2)
      expect(lines).toEqual([`[supabase-transport] retry 1/2 ${method} /rest/v1/profiles — status ${status}`])
    }
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const unavailable = answer(status)
      const { base, transport, lines, sleeps } = setup([unavailable])

      expect(await transport(`${PUBLIC}/rest/v1/profiles`, { method, body: '{}' })).toBe(unavailable)

      expect(base).toHaveBeenCalledTimes(1)
      expect(sleeps).toEqual([])
      expect(lines).toEqual([])
    }
  })

  it.each([400, 401, 403, 404, 409, 429, 500])('returns %i at once', async (status) => {
    const response = answer(status)
    const { base, transport, sleeps } = setup([response])

    expect(await transport(`${PUBLIC}/rest/v1/profiles`)).toBe(response)

    expect(base).toHaveBeenCalledTimes(1)
    expect(sleeps).toEqual([])
  })

  it('retries GET and HEAD after any network error', async () => {
    for (const method of ['GET', 'HEAD']) {
      for (const code of ['ECONNRESET', 'UND_ERR_SOCKET', 'ECONNREFUSED', undefined]) {
        const good = ok()
        const { base, transport, lines } = setup([networkError(code), good])

        expect(await transport(`${PUBLIC}/auth/v1/user`, { method })).toBe(good)

        expect(base).toHaveBeenCalledTimes(2)
        expect(lines).toEqual([`[supabase-transport] retry 1/2 ${method} /auth/v1/user — network ${code ?? 'TypeError'}`])
      }
    }
  })

  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'])(
    'retries POST after %s: the request was never sent',
    async (code) => {
      const good = ok('{"access_token":"t"}')
      const { base, transport, lines } = setup([networkError(code), good])
      const init: RequestInit = { method: 'POST', body: '{"refresh_token":"r"}' }

      expect(await transport(`${PUBLIC}/auth/v1/token?grant_type=refresh_token`, init)).toBe(good)

      expect(base).toHaveBeenCalledTimes(2)
      expect(lines).toEqual([`[supabase-transport] retry 1/2 POST /auth/v1/token — network ${code}`])
    },
  )

  it('does not retry POST after an ambiguous network error', async () => {
    // A reset after the request left: the gateway may have rotated the refresh token already.
    for (const code of ['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE', 'UND_ERR_HEADERS_TIMEOUT', undefined]) {
      for (const method of ['POST', 'post', 'PATCH', 'PUT', 'DELETE']) {
        const failure = networkError(code)
        const { base, transport, lines, sleeps } = setup([failure, ok()])

        await expect(
          transport(`${PUBLIC}/auth/v1/token?grant_type=refresh_token`, { method, body: '{"refresh_token":"r"}' }),
        ).rejects.toBe(failure)

        expect(base).toHaveBeenCalledTimes(1)
        expect(sleeps).toEqual([])
        expect(lines).toEqual([])
      }
    }
  })

  it('rethrows an abort at once', async () => {
    for (const name of ['AbortError', 'TimeoutError']) {
      const abort = new DOMException('The operation was aborted', name)
      const { base, transport, lines, sleeps } = setup([abort, ok()])

      await expect(transport(`${PUBLIC}/rest/v1/profiles`)).rejects.toBe(abort)

      expect(base).toHaveBeenCalledTimes(1)
      expect(sleeps).toEqual([])
      expect(lines).toEqual([])
    }
  })

  it('rethrows whatever the base fetch threw once the caller’s signal is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const failure = networkError('ECONNRESET')
    const { base, transport, sleeps } = setup([failure, ok()])

    await expect(transport(`${PUBLIC}/rest/v1/profiles`, { signal: controller.signal })).rejects.toBe(failure)

    expect(base).toHaveBeenCalledTimes(1)
    expect(sleeps).toEqual([])
  })

  it('gives up after MAX_RETRIES and returns the last response', async () => {
    const last = edgeFallback()
    const { base, transport, lines, sleeps } = setup([edgeFallback(), edgeFallback(), last, ok()])

    const response = await transport(`${PUBLIC}/rest/v1/profiles`)

    expect(response).toBe(last)
    expect(base).toHaveBeenCalledTimes(MAX_RETRIES + 1)
    expect(sleeps).toHaveLength(MAX_RETRIES)
    expect(lines).toHaveLength(MAX_RETRIES)
    // The caller can still read what the edge said.
    expect(await response.json()).toMatchObject({ message: 'Application not found' })
  })

  it('gives up after MAX_RETRIES and throws the last error', async () => {
    const last = networkError('ECONNRESET')
    const { base, transport, sleeps } = setup([networkError('ECONNREFUSED'), networkError('ENOTFOUND'), last, ok()])

    await expect(transport(`${PUBLIC}/rest/v1/profiles`)).rejects.toBe(last)

    expect(base).toHaveBeenCalledTimes(MAX_RETRIES + 1)
    expect(sleeps).toHaveLength(MAX_RETRIES)
  })

  it('cancels the body of a discarded response and leaves the returned one alone', async () => {
    const cancelled: string[] = []
    const streaming = (name: string, status: number, headers: Record<string, string> = {}) =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new TextEncoder().encode(name))
          },
          cancel() {
            cancelled.push(name)
          },
        }),
        { status, headers },
      )
    const kept = streaming('third', 503)
    const { transport } = setup([streaming('first', 404, { 'x-railway-fallback': 'true' }), streaming('second', 503), kept])

    expect(await transport(`${PUBLIC}/rest/v1/profiles`)).toBe(kept)

    expect(cancelled).toEqual(['first', 'second'])
    expect(kept.bodyUsed).toBe(false)
  })

  it('waits RETRY_DELAYS_MS[n] * (1 + random() * 0.25) before retry n', async () => {
    const plain = setup([edgeFallback(), edgeFallback(), ok()], { random: 0 })
    await plain.transport(`${PUBLIC}/rest/v1/profiles`)
    expect(plain.sleeps).toEqual([RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]])

    const jittered = setup([edgeFallback(), edgeFallback(), ok()], { random: 0.5 })
    await jittered.transport(`${PUBLIC}/rest/v1/profiles`)
    expect(jittered.sleeps).toEqual([RETRY_DELAYS_MS[0] * 1.125, RETRY_DELAYS_MS[1] * 1.125])

    expect(MAX_RETRIES).toBe(2)
    expect([...RETRY_DELAYS_MS]).toEqual([150, 400])
  })

  it('writes one line per retry: method and pathname, never the query, the host or a header', async () => {
    const { transport, lines } = setup([edgeFallback(), answer(503), ok()])

    await transport(`${PUBLIC}/rest/v1/profiles?id=eq.user-42&select=role,status`, {
      headers: { apikey: 'anon-key', Authorization: 'Bearer access-token' },
    })

    expect(lines).toEqual([
      '[supabase-transport] retry 1/2 GET /rest/v1/profiles — edge fallback 404',
      '[supabase-transport] retry 2/2 GET /rest/v1/profiles — status 503',
    ])
    const written = lines.join('\n')
    for (const secret of ['user-42', 'select', 'db.example.test', 'anon-key', 'access-token', '?']) {
      expect(written).not.toContain(secret)
    }
  })

  it('logs with console.warn by default', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const transport = createSupabaseTransportFetch(scripted([edgeFallback(), ok()]), {
        env: { NEXT_PUBLIC_SUPABASE_URL: PUBLIC },
        sleep: async () => {},
      })

      await transport(`${PUBLIC}/rest/v1/profiles`)

      expect(warn.mock.calls).toEqual([['[supabase-transport] retry 1/2 GET /rest/v1/profiles — edge fallback 404']])
    } finally {
      warn.mockRestore()
    }
  })
})

describe('request body', () => {
  it.each<[string, () => BodyInit | null | undefined]>([
    ['no', () => undefined],
    ['null', () => null],
    ['string', () => '{"a":1}'],
    ['URLSearchParams', () => new URLSearchParams({ grant_type: 'refresh_token' })],
    ['ArrayBuffer', () => new ArrayBuffer(4)],
    ['typed array', () => new Uint8Array([1, 2, 3])],
    ['Blob', () => new Blob(['file'])],
    ['FormData', () => new FormData()],
  ])('sends a request with a %s body again', async (_label, makeBody) => {
    const body = makeBody()
    const good = ok()
    const { base, transport } = setup([edgeFallback(), good])

    expect(await transport(`${PUBLIC}/storage/v1/object/documents/a.pdf`, { method: 'POST', body })).toBe(good)

    expect(base).toHaveBeenCalledTimes(2)
    // The very same body object goes out both times.
    expect(base.mock.calls[0][1]?.body).toBe(body)
    expect(base.mock.calls[1][1]?.body).toBe(body)
  })

  it('gives a ReadableStream body exactly one attempt', async () => {
    const stream = () => new ReadableStream<Uint8Array>()

    const fallback = edgeFallback()
    const answered = setup([fallback, ok()])
    expect(
      await answered.transport(`${PUBLIC}/storage/v1/object/documents/a.pdf`, { method: 'POST', body: stream() }),
    ).toBe(fallback)
    expect(answered.base).toHaveBeenCalledTimes(1)
    expect(answered.sleeps).toEqual([])

    const failure = networkError('ECONNREFUSED')
    const failed = setup([failure, ok()])
    await expect(
      failed.transport(`${PUBLIC}/storage/v1/object/documents/a.pdf`, { method: 'POST', body: stream() }),
    ).rejects.toBe(failure)
    expect(failed.base).toHaveBeenCalledTimes(1)
    expect(failed.sleeps).toEqual([])
  })
})

describe('private path (SUPABASE_INTERNAL_URL)', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['not a URL', 'gateway.internal:8000'],
  ])('is off when the variable is %s: nothing is probed, requests use the public origin', async (_label, internal) => {
    const good = ok()
    const { base, transport, lines } = setup([good], { internal })

    expect(transport.internalState()).toBe('off')
    expect(await transport.probe()).toBe(false)
    expect(base).not.toHaveBeenCalled()

    const url = `${PUBLIC}/rest/v1/profiles`
    expect(await transport(url)).toBe(good)
    expect(urls(base)).toEqual([url])
    expect(lines).toEqual([])
  })

  it('stays pending until the probe has succeeded; until then requests use the public origin', async () => {
    const good = ok()
    const { base, transport } = setup([good, ok('{}')], { internal: INTERNAL })
    const url = `${PUBLIC}/rest/v1/profiles`

    expect(transport.internalState()).toBe('pending')
    expect(await transport(url)).toBe(good)
    expect(urls(base)).toEqual([url])
    expect(transport.internalState()).toBe('pending')

    expect(await transport.probe()).toBe(true)
    expect(transport.internalState()).toBe('active')
  })

  it('probes GET <internal>/auth/v1/settings with the anon key, once', async () => {
    const { base, transport, lines } = setup([ok('{}')], { internal: `${INTERNAL}/` })

    const [first, second] = await Promise.all([transport.probe(), transport.probe()])

    expect([first, second]).toEqual([true, true])
    expect(base).toHaveBeenCalledTimes(1)
    const [url, init] = base.mock.calls[0]
    expect(url).toBe(`${INTERNAL}/auth/v1/settings`)
    expect((init?.method ?? 'GET').toUpperCase()).toBe('GET')
    expect(new Headers(init?.headers).get('apikey')).toBe('anon-key')
    expect(lines).toEqual([])
  })

  it.each<[string, Step, string]>([
    ['another status', answer(401), '401'],
    ['an edge answer', edgeFallback(), '404'],
    ['a network error', networkError('ENOTFOUND'), 'ENOTFOUND'],
    ['a network error without a code', networkError(), 'TypeError'],
  ])('a probe that ends with %s disables the path for the life of the wrapper', async (_label, step, shown) => {
    const good = ok()
    const { base, transport, lines, clock } = setup([step, good], { internal: INTERNAL })

    expect(await transport.probe()).toBe(false)

    expect(transport.internalState()).toBe('disabled')
    expect(lines).toEqual([`[supabase-transport] internal probe failed (${shown}), internal path disabled`])

    // Not a cooldown: time does not bring it back, and it is not probed again.
    clock.now += INTERNAL_COOLDOWN_MS * 10
    expect(transport.internalState()).toBe('disabled')
    expect(await transport.probe()).toBe(false)
    expect(base).toHaveBeenCalledTimes(1)

    const url = `${PUBLIC}/rest/v1/profiles`
    expect(await transport(url)).toBe(good)
    expect(urls(base)).toEqual([`${INTERNAL}/auth/v1/settings`, url])
    expect(lines).toHaveLength(1)
  })

  it('sends the first attempt to the internal origin with the same path, query and init', async () => {
    const good = ok()
    const { base, transport, lines } = await active([good])
    const init: RequestInit = { method: 'PATCH', headers: { apikey: 'anon-key' }, body: '{"status":"approved"}' }

    expect(await transport(`${PUBLIC}/rest/v1/profiles?id=eq.1&select=role,status`, init)).toBe(good)

    expect(base).toHaveBeenCalledTimes(1)
    expect(base.mock.calls[0][0]).toBe(`${INTERNAL}/rest/v1/profiles?id=eq.1&select=role,status`)
    // R-014: the transport adds its own per-attempt signal; everything else is the caller's.
    expect(withoutSignal(base.mock.calls[0][1])).toEqual(init)
    expect(lines).toEqual([])
  })

  it('returns a response of the internal origin as it is', async () => {
    for (const status of [401, 404, 500]) {
      const response = answer(status)
      const { base, transport } = await active([response])

      expect(await transport(`${PUBLIC}/rest/v1/profiles`)).toBe(response)
      expect(base).toHaveBeenCalledTimes(1)
    }
    // …including 503 for a method that is not retried.
    const unavailable = answer(503)
    const { base, transport } = await active([unavailable])
    expect(await transport(`${PUBLIC}/rest/v1/profiles`, { method: 'POST', body: '{}' })).toBe(unavailable)
    expect(urls(base)).toEqual([`${INTERNAL}/rest/v1/profiles`])
  })

  it('retries a 503 of the internal origin for GET — on the public origin', async () => {
    const good = ok()
    const { base, transport, lines, sleeps } = await active([answer(503), good])
    const url = `${PUBLIC}/rest/v1/profiles?select=role`

    expect(await transport(url)).toBe(good)

    expect(urls(base)).toEqual([`${INTERNAL}/rest/v1/profiles?select=role`, url])
    expect(sleeps).toEqual([RETRY_DELAYS_MS[0]])
    expect(lines).toEqual(['[supabase-transport] retry 1/2 GET /rest/v1/profiles — status 503'])
    // An answer, even a bad one, is not a failure of the path.
    expect(transport.internalState()).toBe('active')
  })

  it('continues on the public origin when the internal attempt fails, without spending a retry', async () => {
    const good = ok()
    const { base, transport, lines, sleeps } = await active([
      networkError('ECONNREFUSED'),
      edgeFallback(),
      edgeFallback(),
      good,
    ])
    const url = `${PUBLIC}/rest/v1/profiles?id=eq.1`

    expect(await transport(url)).toBe(good)

    // One internal attempt, then the public origin with both retries still to spend.
    expect(urls(base)).toEqual([`${INTERNAL}/rest/v1/profiles?id=eq.1`, url, url, url])
    expect(sleeps).toHaveLength(MAX_RETRIES)
    expect(lines).toEqual([
      '[supabase-transport] internal path failed (ECONNREFUSED), using public for 60 s',
      '[supabase-transport] retry 1/2 GET /rest/v1/profiles — edge fallback 404',
      '[supabase-transport] retry 2/2 GET /rest/v1/profiles — edge fallback 404',
    ])
    expect(transport.internalState()).toBe('disabled')
  })

  it('continues on the public origin for POST too when the internal request was never sent', async () => {
    const good = ok()
    const { base, transport, lines } = await active([networkError('UND_ERR_CONNECT_TIMEOUT'), good])
    const url = `${PUBLIC}/auth/v1/token?grant_type=refresh_token`
    const init: RequestInit = { method: 'POST', body: '{"refresh_token":"r"}' }

    expect(await transport(url, init)).toBe(good)

    expect(urls(base)).toEqual([`${INTERNAL}/auth/v1/token?grant_type=refresh_token`, url])
    expect(withoutSignal(base.mock.calls[1][1])).toEqual(init)
    expect(lines).toEqual(['[supabase-transport] internal path failed (UND_ERR_CONNECT_TIMEOUT), using public for 60 s'])
  })

  it('does not send POST to the public origin after an ambiguous failure of the internal one', async () => {
    const failure = networkError('ECONNRESET')
    const { base, transport, lines, sleeps } = await active([failure, ok()])

    await expect(
      transport(`${PUBLIC}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: '{"refresh_token":"r"}' }),
    ).rejects.toBe(failure)

    expect(urls(base)).toEqual([`${INTERNAL}/auth/v1/token?grant_type=refresh_token`])
    expect(sleeps).toEqual([])
    expect(lines).toEqual([])
    expect(transport.internalState()).toBe('active')
  })

  it('uses the public origin for INTERNAL_COOLDOWN_MS after a failure, then the internal one again', async () => {
    const { base, transport, lines, clock } = await active([networkError('ENOTFOUND'), ok(), ok(), ok()])
    const url = `${PUBLIC}/auth/v1/user`
    const internal = `${INTERNAL}/auth/v1/user`

    await transport(url)
    expect(urls(base)).toEqual([internal, url])

    clock.now += INTERNAL_COOLDOWN_MS - 1
    expect(transport.internalState()).toBe('disabled')
    await transport(url)
    expect(urls(base)).toEqual([internal, url, url])

    clock.now += 1
    expect(transport.internalState()).toBe('active')
    await transport(url)
    expect(urls(base)).toEqual([internal, url, url, internal])

    expect(INTERNAL_COOLDOWN_MS).toBe(60_000)
    expect(lines).toEqual(['[supabase-transport] internal path failed (ENOTFOUND), using public for 60 s'])
  })

  it('writes the failure line once when several requests fail on the internal origin together', async () => {
    const { base, transport, lines } = await active([
      networkError('ECONNREFUSED'),
      networkError('ECONNREFUSED'),
      ok(),
      ok(),
    ])
    const url = `${PUBLIC}/rest/v1/profiles`

    await Promise.all([transport(url), transport(url)])

    expect(base).toHaveBeenCalledTimes(4)
    expect(lines).toEqual(['[supabase-transport] internal path failed (ECONNREFUSED), using public for 60 s'])
  })

  it('rethrows an abort of the internal attempt at once and keeps the path', async () => {
    const abort = new DOMException('The operation timed out', 'TimeoutError')
    const { base, transport, lines } = await active([abort, ok()])

    await expect(transport(`${PUBLIC}/rest/v1/profiles`)).rejects.toBe(abort)

    expect(base).toHaveBeenCalledTimes(1)
    expect(lines).toEqual([])
    expect(transport.internalState()).toBe('active')
  })

  it('gives a ReadableStream body exactly one attempt on the internal origin as well', async () => {
    const failure = networkError('ECONNREFUSED')
    const { base, transport, lines } = await active([failure, ok()])

    await expect(
      transport(`${PUBLIC}/storage/v1/object/documents/a.pdf`, { method: 'POST', body: new ReadableStream<Uint8Array>() }),
    ).rejects.toBe(failure)

    expect(urls(base)).toEqual([`${INTERNAL}/storage/v1/object/documents/a.pdf`])
    expect(lines).toEqual([])
  })
})

describe('installSupabaseTransport', () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: PUBLIC, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key' }
  const marked = (fn: unknown) => (fn as Record<symbol, unknown>)[MARKER] === true

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('replaces globalThis.fetch once', async () => {
    const good = ok()
    const base = scripted([edgeFallback(), good])
    vi.stubGlobal('fetch', base)

    expect(installSupabaseTransport({ env, sleep: async () => {}, log: () => {} })).toBe(true)

    const installed = globalThis.fetch
    expect(installed).not.toBe(base)
    expect(marked(installed)).toBe(true)
    expect(marked(base)).toBe(false)

    expect(installSupabaseTransport({ env })).toBe(false)
    expect(globalThis.fetch).toBe(installed)

    // The global fetch now survives an answer of the edge, through the function it replaced.
    expect(await fetch(`${PUBLIC}/rest/v1/profiles`)).toBe(good)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('keeps the own enumerable properties of the function it replaces', () => {
    const getStaticStore = () => undefined
    const base = Object.assign(scripted([]), { __nextPatched: true, __nextGetStaticStore: getStaticStore })
    vi.stubGlobal('fetch', base)

    expect(installSupabaseTransport({ env })).toBe(true)

    const installed = globalThis.fetch as typeof fetch & { __nextPatched?: unknown; __nextGetStaticStore?: unknown }
    expect(installed.__nextPatched).toBe(true)
    expect(installed.__nextGetStaticStore).toBe(getStaticStore)
    // …without losing its own.
    expect(typeof (installed as unknown as { probe: unknown }).probe).toBe('function')
    expect(typeof (installed as unknown as { internalState: unknown }).internalState).toBe('function')
  })

  it('passes other origins through to the function it replaced', async () => {
    const unavailable = answer(503)
    const base = scripted([unavailable])
    vi.stubGlobal('fetch', base)
    installSupabaseTransport({ env })
    const init: RequestInit = { method: 'POST', body: '{}' }

    expect(await fetch('https://openrouter.ai/api/v1/chat/completions', init)).toBe(unavailable)

    expect(base).toHaveBeenCalledTimes(1)
    expect(base.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(base.mock.calls[0][1]).toBe(init)
  })

  it('starts the probe without waiting for it', async () => {
    let answerProbe!: (response: Response) => void
    const base = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { answerProbe = resolve }))
    vi.stubGlobal('fetch', base)

    expect(installSupabaseTransport({ env: { ...env, SUPABASE_INTERNAL_URL: INTERNAL }, log: () => {} })).toBe(true)

    const installed = globalThis.fetch as ReturnType<typeof createSupabaseTransportFetch>
    expect(base).toHaveBeenCalledTimes(1)
    expect(base.mock.calls[0][0]).toBe(`${INTERNAL}/auth/v1/settings`)
    expect(installed.internalState()).toBe('pending')

    answerProbe(ok('{}'))
    await vi.waitFor(() => expect(installed.internalState()).toBe('active'))
  })

  it('probes nothing without SUPABASE_INTERNAL_URL', () => {
    const base = scripted([])
    vi.stubGlobal('fetch', base)

    expect(installSupabaseTransport({ env })).toBe(true)

    expect(base).not.toHaveBeenCalled()
  })
})

describe('R-014 timeouts: an attempt that hangs without an error', () => {
  /** A base fetch that never answers on its own: it rejects only when its signal is aborted. */
  function hanging(answers: Record<string, () => Response> = {}) {
    return vi.fn<typeof fetch>((input, init) => {
      const url = String(input)
      for (const [prefix, make] of Object.entries(answers)) if (url.startsWith(prefix)) return Promise.resolve(make())
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return // a request without a signal would hang forever: the test times out
        if (signal.aborted) reject(signal.reason)
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
  }

  function make(base: typeof fetch, timeouts: { attemptMs?: number; internalAttemptMs?: number; deadlineMs?: number; probeMs?: number }, internal?: string) {
    const lines: string[] = []
    const transport = createSupabaseTransportFetch(base, {
      env: { NEXT_PUBLIC_SUPABASE_URL: PUBLIC, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key', SUPABASE_INTERNAL_URL: internal },
      sleep: async () => {},
      log: (line) => { lines.push(line) },
      random: () => 0,
      timeouts,
    })
    return { transport, lines }
  }

  it('has bounded defaults: a short internal attempt, a longer public one, a request deadline above them', () => {
    const d = TRANSPORT_TIMEOUT_DEFAULTS
    expect(d.internalAttemptMs).toBeGreaterThan(0)
    expect(d.internalAttemptMs).toBeLessThan(d.attemptMs)
    expect(d.attemptMs).toBeLessThanOrEqual(d.deadlineMs)
    expect(d.deadlineMs).toBeLessThanOrEqual(45_000) // the project rule for one unit of work
    expect(d.probeMs).toBeGreaterThan(0)
  })

  it('moves a GET from a hung internal path to the public origin after the internal attempt timeout', async () => {
    const good = ok()
    const base = hanging({ [`${INTERNAL}/auth/v1/settings`]: () => ok('{}'), [PUBLIC]: () => good })
    const { transport, lines } = make(base, { attemptMs: 2_000, internalAttemptMs: 30, deadlineMs: 5_000 }, INTERNAL)
    expect(await transport.probe()).toBe(true)

    const started = Date.now()
    expect(await transport(`${PUBLIC}/rest/v1/profiles?select=id`)).toBe(good)

    expect(Date.now() - started).toBeLessThan(1_000)
    expect(urls(base).slice(1)).toEqual([`${INTERNAL}/rest/v1/profiles?select=id`, `${PUBLIC}/rest/v1/profiles?select=id`])
    expect(transport.internalState()).toBe('disabled') // cooldown: the next requests go public at once
    expect(lines).toEqual(['[supabase-transport] internal path timed out (30 ms), using public for 60 s'])
  })

  it('never re-sends a POST that timed out on the internal path (it may have been executed)', async () => {
    const base = hanging({ [`${INTERNAL}/auth/v1/settings`]: () => ok('{}') })
    // A POST gets the full attempt budget on the private path: there is no safe failover for it.
    const { transport } = make(base, { attemptMs: 60, internalAttemptMs: 10, deadlineMs: 5_000 }, INTERNAL)
    await transport.probe()

    const started = Date.now()
    await expect(transport(`${PUBLIC}/rest/v1/rpc/claim`, { method: 'POST', body: '{}' })).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(50)
    expect(base).toHaveBeenCalledTimes(2) // probe + the one attempt
    expect(transport.internalState()).toBe('disabled')
  })

  it('retries a hung public GET while the request deadline leaves room for it', async () => {
    const base = hanging()
    // attempt 1: 0–200 ms; retry 1 fits (500 ms left); attempt 2: 200–400 ms; retry 2 does not
    // (300 ms left < the 400 ms pause before it) — the last timeout is thrown.
    const { transport, lines } = make(base, { attemptMs: 200, deadlineMs: 700 })

    const started = Date.now()
    await expect(transport(`${PUBLIC}/rest/v1/profiles`)).rejects.toMatchObject({ name: 'TimeoutError' })
    const took = Date.now() - started
    expect(took).toBeGreaterThanOrEqual(380)
    expect(took).toBeLessThan(690)
    expect(base).toHaveBeenCalledTimes(2)
    expect(lines).toEqual(['[supabase-transport] retry 1/2 GET /rest/v1/profiles — timeout 200 ms'])
  })

  it('cuts an attempt at the request deadline', async () => {
    const base = hanging()
    const { transport } = make(base, { attemptMs: 5_000, deadlineMs: 60 })
    const started = Date.now()
    await expect(transport(`${PUBLIC}/rest/v1/profiles`)).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('does not retry a hung public POST', async () => {
    const base = hanging()
    const { transport } = make(base, { attemptMs: 30, deadlineMs: 1_000 })
    await expect(transport(`${PUBLIC}/rest/v1/profiles`, { method: 'POST', body: '{}' })).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('passes the caller\'s abort through to the attempt and rethrows it at once', async () => {
    const base = hanging()
    const { transport } = make(base, { attemptMs: 5_000, deadlineMs: 10_000 })
    const controller = new AbortController()
    const pending = transport(`${PUBLIC}/rest/v1/profiles`, { signal: controller.signal })
    const reason = new DOMException('caller gave up', 'AbortError')
    setTimeout(() => controller.abort(reason), 20)
    await expect(pending).rejects.toBe(reason)
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('stops the timer once the response arrived: reading the body later is not aborted', async () => {
    let seen: AbortSignal | undefined
    const base = vi.fn<typeof fetch>(async (_input, init) => {
      seen = init?.signal ?? undefined
      return ok('[{"id":1}]')
    })
    const { transport } = make(base, { attemptMs: 20, deadlineMs: 40 })
    const response = await transport(`${PUBLIC}/rest/v1/profiles`)
    await new Promise((r) => setTimeout(r, 60))
    expect(seen?.aborted).toBe(false)
    expect(await response.text()).toBe('[{"id":1}]')
  })

  it('gives up the probe after probeMs: the private path stays off, nothing hangs', async () => {
    const base = hanging()
    const { transport, lines } = make(base, { probeMs: 20 }, INTERNAL)
    expect(await transport.probe()).toBe(false)
    expect(transport.internalState()).toBe('disabled')
    expect(lines).toEqual(['[supabase-transport] internal probe failed (TimeoutError), internal path disabled'])
  })

  it('0 turns a timeout off (the previous behaviour)', async () => {
    const good = ok()
    const base = vi.fn<typeof fetch>(async () => good)
    const { transport } = make(base, { attemptMs: 0, internalAttemptMs: 0, deadlineMs: 0 })
    const init: RequestInit = { headers: { apikey: 'anon-key' } }
    expect(await transport(`${PUBLIC}/rest/v1/profiles`, init)).toBe(good)
    expect(base.mock.calls[0][1]).toEqual(init)
  })
})
