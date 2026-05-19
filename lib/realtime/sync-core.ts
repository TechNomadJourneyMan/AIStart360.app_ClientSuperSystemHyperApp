/**
 * Pure / framework-free core of `useRealtimeSync`.
 *
 * Split out so it can be unit-tested without React, RTL, or jsdom. The hook
 * in `hooks/useRealtimeSync.ts` is a thin React adapter that wires this core
 * to a real Supabase browser client + a `useState` setter.
 */

import type { QueryKey } from '@tanstack/react-query'
import { buildChannelName, bindingKey, type ChannelDescriptor, type RealtimeEvent, type WatchedTable } from './channels'

export interface RealtimeSyncBinding {
  table: WatchedTable
  filter?: { column: string; value: string }
  event?: RealtimeEvent
  /**
   * Query keys to invalidate when any matching event arrives. Each key is
   * invalidated with an exact-match `queryKey` filter; pass the broadest
   * key you want (e.g. `['metrics']`) — React Query treats it as a prefix.
   */
  invalidateKeys: QueryKey[]
  /**
   * Optional predicate-based invalidations — useful when you need to fan out
   * to all variants of a query (e.g. every `['timeseries', metricId, period]`).
   * Each predicate runs once per debounced flush.
   */
  invalidatePredicates?: Array<(query: { queryKey: QueryKey }) => boolean>
  /** Optional side-effect callback (analytics, toast). */
  onChange?: (payload: unknown) => void
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

/** Minimal subset of `@tanstack/react-query` QueryClient that we depend on. */
export interface QueryClientLike {
  invalidateQueries(filters: { queryKey?: QueryKey; predicate?: (q: { queryKey: QueryKey }) => boolean }): unknown
}

/** Channel handle the supabase client returns; we only call `.unsubscribe()` on teardown. */
export interface ChannelHandleLike {
  unsubscribe(): unknown
}

/** Minimal subset of the supabase client `.channel(...)` builder API. */
export interface ChannelBuilderLike {
  on(
    type: 'postgres_changes',
    config: { event: RealtimeEvent; schema: string; table: WatchedTable; filter?: string },
    cb: (payload: unknown) => void,
  ): ChannelBuilderLike
  subscribe(cb: (status: string) => void): ChannelHandleLike
}

/** Minimal subset of `SupabaseClient` we depend on. */
export interface SupabaseClientLike {
  channel(name: string): ChannelBuilderLike
  removeChannel(channel: ChannelHandleLike): unknown
}

/**
 * Map a Supabase subscribe status string to our public `ConnectionStatus`.
 *   - 'SUBSCRIBED' → 'open'
 *   - 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' → 'closed'
 *   - anything else → 'connecting'
 */
export function mapStatus(raw: string): ConnectionStatus {
  if (raw === 'SUBSCRIBED') return 'open'
  if (raw === 'CHANNEL_ERROR' || raw === 'TIMED_OUT' || raw === 'CLOSED') return 'closed'
  return 'connecting'
}

/**
 * Build the channel-descriptor that `buildChannelName` accepts from a binding.
 */
export function bindingToDescriptor(b: RealtimeSyncBinding): ChannelDescriptor {
  return {
    table: b.table,
    filter: b.filter ? `${b.filter.column}=eq.${b.filter.value}` : undefined,
    event: b.event ?? '*',
  }
}

/**
 * Stable signature for an entire bindings list — `useRealtimeSync` compares
 * this string between renders to decide whether to re-subscribe.
 */
export function bindingsSignature(bindings: RealtimeSyncBinding[]): string {
  return bindings.map((b) => bindingKey(bindingToDescriptor(b))).join('|')
}

/**
 * Side-effect API the core needs from its caller. Lets us swap React's
 * `setState` for a plain function in tests and call `Date.now()` deterministically.
 */
export interface SyncCoreDeps {
  client: SupabaseClientLike
  queryClient: QueryClientLike
  userId: string
  setStatus(s: ConnectionStatus): void
  setLastEventAt(iso: string): void
  /** Defaults to `setTimeout` / `clearTimeout`. Overridable for tests. */
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void
  /** Defaults to `() => new Date().toISOString()`. */
  nowIso?: () => string
  /** Debounce window for invalidation flush. Default 250ms. */
  debounceMs?: number
}

/**
 * Internal: a query key + the optional predicate flag. We serialize the
 * queryKey to JSON for deduplication across a debounce window.
 */
type PendingKey = QueryKey

/**
 * Wire up subscriptions for `bindings` and return a teardown thunk. Pure in
 * the sense that all side-effects flow through `deps`.
 *
 * Strict-mode safety: if React unmounts then remounts, the previous mount's
 * teardown will run before the next call. We also expose a `cancelled` flag
 * so async subscribe callbacks that arrive after teardown become no-ops.
 */
export function startRealtimeSync(
  bindings: RealtimeSyncBinding[],
  deps: SyncCoreDeps,
): () => void {
  const { client, queryClient, userId, setStatus, setLastEventAt } = deps
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout
  const nowIso = deps.nowIso ?? (() => new Date().toISOString())
  const debounceMs = deps.debounceMs ?? 250

  let cancelled = false
  const channels: ChannelHandleLike[] = []

  // Track per-binding subscribe status; aggregate to `setStatus`.
  const statuses: ConnectionStatus[] = bindings.map(() => 'connecting')

  // Debounced invalidation queue — collects pending query keys (as JSON strings)
  // across all bindings until the timer fires, then flushes once.
  const pendingKeys = new Map<string, PendingKey>()
  const pendingPredicates = new Set<(query: { queryKey: QueryKey }) => boolean>()
  let debounceHandle: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    debounceHandle = null
    if (cancelled) return
    const keys = Array.from(pendingKeys.values())
    const predicates = Array.from(pendingPredicates)
    pendingKeys.clear()
    pendingPredicates.clear()
    for (const queryKey of keys) {
      try {
        queryClient.invalidateQueries({ queryKey })
      } catch (err) {
        console.warn('[useRealtimeSync] invalidateQueries failed', err)
      }
    }
    for (const predicate of predicates) {
      try {
        queryClient.invalidateQueries({ predicate })
      } catch (err) {
        console.warn('[useRealtimeSync] invalidateQueries(predicate) failed', err)
      }
    }
  }

  const scheduleFlush = () => {
    if (debounceHandle !== null) return
    debounceHandle = setTimeoutFn(flush, debounceMs)
  }

  const aggregateStatus = (): ConnectionStatus => {
    // 'open' if every channel is open; 'closed' if any is closed; else 'connecting'.
    if (statuses.length === 0) return 'closed'
    if (statuses.some((s) => s === 'closed')) return 'closed'
    if (statuses.every((s) => s === 'open')) return 'open'
    return 'connecting'
  }

  if (bindings.length === 0) {
    setStatus('closed')
    return () => {
      cancelled = true
    }
  }

  setStatus('connecting')

  bindings.forEach((binding, idx) => {
    const descriptor = bindingToDescriptor(binding)
    const channelName = buildChannelName(descriptor, userId)

    let handle: ChannelHandleLike | null = null
    try {
      const builder = client.channel(channelName).on(
        'postgres_changes',
        {
          event: descriptor.event ?? '*',
          schema: 'public',
          table: binding.table,
          filter: descriptor.filter,
        },
        (payload) => {
          if (cancelled) return
          setLastEventAt(nowIso())
          // Side-effect callback (analytics / toast). Never let it throw out.
          if (binding.onChange) {
            try {
              binding.onChange(payload)
            } catch (err) {
              console.warn('[useRealtimeSync] onChange handler threw', err)
            }
          }
          // Queue invalidations; debounce will dedupe across all bindings.
          for (const key of binding.invalidateKeys) {
            pendingKeys.set(JSON.stringify(key), key)
          }
          if (binding.invalidatePredicates) {
            for (const predicate of binding.invalidatePredicates) {
              pendingPredicates.add(predicate)
            }
          }
          scheduleFlush()
        },
      )

      handle = builder.subscribe((rawStatus) => {
        if (cancelled) return
        statuses[idx] = mapStatus(rawStatus)
        setStatus(aggregateStatus())
      })
    } catch (err) {
      // Supabase unreachable, or channel() throws synchronously. Degrade silently.
      console.warn('[useRealtimeSync] failed to open channel', channelName, err)
      statuses[idx] = 'closed'
      setStatus(aggregateStatus())
      return
    }

    channels.push(handle)
  })

  return () => {
    cancelled = true
    if (debounceHandle !== null) {
      clearTimeoutFn(debounceHandle)
      debounceHandle = null
    }
    for (const ch of channels) {
      try {
        client.removeChannel(ch)
      } catch (err) {
        console.warn('[useRealtimeSync] removeChannel failed', err)
      }
    }
  }
}
