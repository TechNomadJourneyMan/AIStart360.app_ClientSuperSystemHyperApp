/**
 * Unit tests for the realtime sync core. Pure-function path — no React, no
 * jsdom, no Supabase. We exercise `startRealtimeSync` directly through the
 * in-memory mock supabase client from `lib/realtime/__mocks__/supabase.ts`.
 *
 * The React hook in `hooks/useRealtimeSync.ts` is a thin wrapper around this
 * core, so coverage here covers the behavioural contract end-to-end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  startRealtimeSync,
  bindingsSignature,
  mapStatus,
  type RealtimeSyncBinding,
  type QueryClientLike,
  type ConnectionStatus,
} from '@/lib/realtime/sync-core'
import { buildChannelName, buildFilter, bindingKey } from '@/lib/realtime/channels'
import { createMockSupabaseClient } from '@/lib/realtime/__mocks__/supabase'

function makeQueryClient() {
  const calls: Array<{ queryKey?: unknown; predicate?: unknown }> = []
  const qc: QueryClientLike = {
    invalidateQueries(filters) {
      calls.push(filters as { queryKey?: unknown; predicate?: unknown })
      return undefined
    },
  }
  return { qc, calls }
}

interface Harness {
  statuses: ConnectionStatus[]
  lastEventAts: string[]
}

function makeHarness(): Harness & {
  setStatus: (s: ConnectionStatus) => void
  setLastEventAt: (s: string) => void
} {
  const statuses: ConnectionStatus[] = []
  const lastEventAts: string[] = []
  return {
    statuses,
    lastEventAts,
    setStatus(s) {
      statuses.push(s)
    },
    setLastEventAt(s) {
      lastEventAts.push(s)
    },
  }
}

describe('lib/realtime/channels', () => {
  it('buildFilter formats eq predicate', () => {
    expect(buildFilter('company_id', 'abc-123')).toBe('company_id=eq.abc-123')
  })

  it('buildFilter throws on missing column', () => {
    expect(() => buildFilter('', 'x')).toThrow()
  })

  it('buildChannelName is stable and includes table, user, filter, event', () => {
    const name = buildChannelName(
      { table: 'metrics', filter: 'company_id=eq.abc', event: 'UPDATE' },
      'user-1',
    )
    expect(name).toBe('realtime:metrics:user-user-1:company_id=eq.abc:UPDATE')

    // Same input → same output (stable).
    const again = buildChannelName(
      { table: 'metrics', filter: 'company_id=eq.abc', event: 'UPDATE' },
      'user-1',
    )
    expect(again).toBe(name)
  })

  it('buildChannelName falls back to "all" + "*" when fields omitted', () => {
    const name = buildChannelName({ table: 'documents' }, 'user-x')
    expect(name).toBe('realtime:documents:user-user-x:all:*')
  })

  it('bindingKey is filter+event aware', () => {
    const a = bindingKey({ table: 'metrics', filter: 'a=eq.1', event: 'INSERT' })
    const b = bindingKey({ table: 'metrics', filter: 'a=eq.1', event: 'UPDATE' })
    expect(a).not.toBe(b)
  })
})

describe('mapStatus', () => {
  it('maps SUBSCRIBED → open', () => {
    expect(mapStatus('SUBSCRIBED')).toBe('open')
  })
  it('maps error states → closed', () => {
    expect(mapStatus('CHANNEL_ERROR')).toBe('closed')
    expect(mapStatus('TIMED_OUT')).toBe('closed')
    expect(mapStatus('CLOSED')).toBe('closed')
  })
  it('maps anything else → connecting', () => {
    expect(mapStatus('JOINING')).toBe('connecting')
    expect(mapStatus('')).toBe('connecting')
  })
})

describe('bindingsSignature', () => {
  it('returns identical strings for logically identical bindings', () => {
    const a: RealtimeSyncBinding[] = [
      { table: 'metrics', filter: { column: 'company_id', value: 'c1' }, invalidateKeys: [['metrics']] },
    ]
    const b: RealtimeSyncBinding[] = [
      { table: 'metrics', filter: { column: 'company_id', value: 'c1' }, invalidateKeys: [['metrics']] },
    ]
    expect(bindingsSignature(a)).toBe(bindingsSignature(b))
  })

  it('changes when filter value changes', () => {
    const a: RealtimeSyncBinding[] = [
      { table: 'metrics', filter: { column: 'company_id', value: 'c1' }, invalidateKeys: [] },
    ]
    const b: RealtimeSyncBinding[] = [
      { table: 'metrics', filter: { column: 'company_id', value: 'c2' }, invalidateKeys: [] },
    ]
    expect(bindingsSignature(a)).not.toBe(bindingsSignature(b))
  })
})

describe('startRealtimeSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('subscribes on start, returns connecting then open on SUBSCRIBED', () => {
    const client = createMockSupabaseClient()
    const { qc } = makeQueryClient()
    const h = makeHarness()

    const bindings: RealtimeSyncBinding[] = [
      {
        table: 'metrics',
        filter: { column: 'company_id', value: 'c-1' },
        invalidateKeys: [['metrics']],
      },
    ]

    startRealtimeSync(bindings, {
      client,
      queryClient: qc,
      userId: 'u-1',
      setStatus: h.setStatus,
      setLastEventAt: h.setLastEventAt,
    })

    expect(h.statuses[0]).toBe('connecting')
    expect(client.__channels).toHaveLength(1)
    expect(client.__channels[0].name).toContain('realtime:metrics:user-u-1')

    client.__channels[0].__emitStatus('SUBSCRIBED')
    expect(h.statuses.at(-1)).toBe('open')
  })

  it('flips status to closed on CHANNEL_ERROR', () => {
    const client = createMockSupabaseClient()
    const { qc } = makeQueryClient()
    const h = makeHarness()

    startRealtimeSync(
      [{ table: 'documents', invalidateKeys: [['documents']] }],
      {
        client,
        queryClient: qc,
        userId: 'u',
        setStatus: h.setStatus,
        setLastEventAt: h.setLastEventAt,
      },
    )

    client.__channels[0].__emitStatus('CHANNEL_ERROR')
    expect(h.statuses.at(-1)).toBe('closed')
  })

  it('fires onChange with payload when channel emits', () => {
    const client = createMockSupabaseClient()
    const { qc } = makeQueryClient()
    const h = makeHarness()
    const onChange = vi.fn()

    startRealtimeSync(
      [{ table: 'diagnostics', invalidateKeys: [['point-a-aggregate']], onChange }],
      {
        client,
        queryClient: qc,
        userId: 'u',
        setStatus: h.setStatus,
        setLastEventAt: h.setLastEventAt,
      },
    )

    const payload = { eventType: 'INSERT', new: { id: 'x' } }
    client.__channels[0].__emit(payload)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(payload)
    expect(h.lastEventAts.length).toBe(1)
  })

  it('debounces invalidations: 5 rapid emits → 1 invalidate call per unique key', () => {
    const client = createMockSupabaseClient()
    const { qc, calls } = makeQueryClient()
    const h = makeHarness()

    startRealtimeSync(
      [{ table: 'metrics', invalidateKeys: [['metrics'], ['point-a-aggregate']] }],
      {
        client,
        queryClient: qc,
        userId: 'u',
        setStatus: h.setStatus,
        setLastEventAt: h.setLastEventAt,
        debounceMs: 250,
      },
    )

    const ch = client.__channels[0]
    for (let i = 0; i < 5; i += 1) ch.__emit({ i })

    // Pre-flush: no calls yet.
    expect(calls).toHaveLength(0)

    vi.advanceTimersByTime(250)

    // Post-flush: two unique keys → exactly two calls, regardless of emit count.
    expect(calls).toHaveLength(2)
    const keys = calls.map((c) => JSON.stringify(c.queryKey)).sort()
    expect(keys).toEqual([JSON.stringify(['metrics']), JSON.stringify(['point-a-aggregate'])].sort())
  })

  it('predicate invalidations also debounce + dedupe', () => {
    const client = createMockSupabaseClient()
    const { qc, calls } = makeQueryClient()
    const h = makeHarness()
    const predicate = (q: { queryKey: unknown[] }) => q.queryKey[0] === 'timeseries'

    startRealtimeSync(
      [
        {
          table: 'metrics',
          invalidateKeys: [],
          invalidatePredicates: [predicate as (q: { queryKey: unknown }) => boolean] as Array<
            (q: { queryKey: import('@tanstack/react-query').QueryKey }) => boolean
          >,
        },
      ],
      {
        client,
        queryClient: qc,
        userId: 'u',
        setStatus: h.setStatus,
        setLastEventAt: h.setLastEventAt,
      },
    )

    const ch = client.__channels[0]
    for (let i = 0; i < 3; i += 1) ch.__emit({ i })
    vi.advanceTimersByTime(250)

    expect(calls).toHaveLength(1)
    expect(typeof calls[0].predicate).toBe('function')
  })

  it('removes all channels on teardown', () => {
    const client = createMockSupabaseClient()
    const { qc } = makeQueryClient()
    const h = makeHarness()

    const teardown = startRealtimeSync(
      [
        { table: 'metrics', invalidateKeys: [['metrics']] },
        { table: 'documents', invalidateKeys: [['documents']] },
      ],
      {
        client,
        queryClient: qc,
        userId: 'u',
        setStatus: h.setStatus,
        setLastEventAt: h.setLastEventAt,
      },
    )

    expect(client.__channels).toHaveLength(2)
    teardown()
    expect(client.__removed).toBe(2)
  })

  it('cancels pending debounced flush on teardown', () => {
    const client = createMockSupabaseClient()
    const { qc, calls } = makeQueryClient()
    const h = makeHarness()

    const teardown = startRealtimeSync(
      [{ table: 'metrics', invalidateKeys: [['metrics']] }],
      {
        client,
        queryClient: qc,
        userId: 'u',
        setStatus: h.setStatus,
        setLastEventAt: h.setLastEventAt,
      },
    )

    client.__channels[0].__emit({ i: 1 })
    teardown()
    vi.advanceTimersByTime(1000)

    expect(calls).toHaveLength(0)
  })

  it('multiple bindings open multiple channels', () => {
    const client = createMockSupabaseClient()
    const { qc } = makeQueryClient()
    const h = makeHarness()

    startRealtimeSync(
      [
        { table: 'metrics', filter: { column: 'company_id', value: 'c' }, invalidateKeys: [['metrics']] },
        { table: 'diagnostics', filter: { column: 'user_id', value: 'u' }, invalidateKeys: [] },
        { table: 'documents', filter: { column: 'user_id', value: 'u' }, invalidateKeys: [['documents']] },
      ],
      {
        client,
        queryClient: qc,
        userId: 'u',
        setStatus: h.setStatus,
        setLastEventAt: h.setLastEventAt,
      },
    )

    expect(client.__channels).toHaveLength(3)
    const tables = client.__channels.map((c) => c.listeners[0].config.table).sort()
    expect(tables).toEqual(['diagnostics', 'documents', 'metrics'])
  })

  it('aggregate status reports open only when all bindings are open', () => {
    const client = createMockSupabaseClient()
    const { qc } = makeQueryClient()
    const h = makeHarness()

    startRealtimeSync(
      [
        { table: 'metrics', invalidateKeys: [] },
        { table: 'documents', invalidateKeys: [] },
      ],
      {
        client,
        queryClient: qc,
        userId: 'u',
        setStatus: h.setStatus,
        setLastEventAt: h.setLastEventAt,
      },
    )

    client.__channels[0].__emitStatus('SUBSCRIBED')
    expect(h.statuses.at(-1)).toBe('connecting') // one still pending

    client.__channels[1].__emitStatus('SUBSCRIBED')
    expect(h.statuses.at(-1)).toBe('open')
  })

  it('empty bindings → status closed and no channels', () => {
    const client = createMockSupabaseClient()
    const { qc } = makeQueryClient()
    const h = makeHarness()

    startRealtimeSync([], {
      client,
      queryClient: qc,
      userId: 'u',
      setStatus: h.setStatus,
      setLastEventAt: h.setLastEventAt,
    })

    expect(h.statuses.at(-1)).toBe('closed')
    expect(client.__channels).toHaveLength(0)
  })

  it('degrades silently when client.channel() throws', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const brokenClient = {
      ...createMockSupabaseClient(),
      channel: () => {
        throw new Error('boom')
      },
    }
    const { qc } = makeQueryClient()
    const h = makeHarness()

    expect(() =>
      startRealtimeSync([{ table: 'metrics', invalidateKeys: [['metrics']] }], {
        client: brokenClient,
        queryClient: qc,
        userId: 'u',
        setStatus: h.setStatus,
        setLastEventAt: h.setLastEventAt,
      }),
    ).not.toThrow()

    expect(h.statuses.at(-1)).toBe('closed')
    warnSpy.mockRestore()
  })

  it('does not invoke onChange or setStatus after teardown (strict-mode safety)', () => {
    const client = createMockSupabaseClient()
    const { qc } = makeQueryClient()
    const h = makeHarness()
    const onChange = vi.fn()

    const teardown = startRealtimeSync(
      [{ table: 'metrics', invalidateKeys: [['metrics']], onChange }],
      {
        client,
        queryClient: qc,
        userId: 'u',
        setStatus: h.setStatus,
        setLastEventAt: h.setLastEventAt,
      },
    )

    teardown()

    client.__channels[0].__emit({ post: 'teardown' })
    client.__channels[0].__emitStatus('SUBSCRIBED')

    expect(onChange).not.toHaveBeenCalled()
    // No status update after teardown.
    expect(h.statuses.at(-1)).not.toBe('open')
  })
})
