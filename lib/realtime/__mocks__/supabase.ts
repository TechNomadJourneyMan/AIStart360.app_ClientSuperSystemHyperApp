/**
 * Lightweight in-memory mock of the Supabase browser client surface used by
 * `startRealtimeSync` / `useRealtimeSync`. NOT a full mock — only implements
 * the subset documented by `SupabaseClientLike` in `lib/realtime/sync-core.ts`.
 *
 * Test ergonomics:
 *  - `client.__channels` exposes every channel created during the test.
 *  - `channel.__emitStatus('SUBSCRIBED')` triggers the subscribe callback.
 *  - `channel.__emit({...})` fires a postgres_changes payload at the listener
 *    registered for that channel's filter.
 *  - `client.__removed` is the count of `removeChannel` calls — handy for
 *    teardown assertions.
 */

import type {
  ChannelBuilderLike,
  ChannelHandleLike,
  SupabaseClientLike,
} from '../sync-core'
import type { RealtimeEvent, WatchedTable } from '../channels'

export interface MockListenerConfig {
  event: RealtimeEvent
  schema: string
  table: WatchedTable
  filter?: string
}

export interface MockChannel extends ChannelHandleLike, ChannelBuilderLike {
  name: string
  listeners: Array<{ config: MockListenerConfig; cb: (payload: unknown) => void }>
  statusCb: ((s: string) => void) | null
  __emit(payload: unknown): void
  __emitStatus(status: string): void
}

export interface MockSupabaseClient extends SupabaseClientLike {
  __channels: MockChannel[]
  __removed: number
  // Mirror the real client's `.auth.getUser` so the hook's auth lookup
  // resolves to a deterministic test user.
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> }
}

export function createMockSupabaseClient(opts: { userId?: string | null } = {}): MockSupabaseClient {
  const channels: MockChannel[] = []
  let removed = 0

  const client: MockSupabaseClient = {
    __channels: channels,
    get __removed() {
      return removed
    },
    auth: {
      getUser: async () => ({
        data: { user: opts.userId === null ? null : { id: opts.userId ?? 'test-user' } },
      }),
    },
    channel(name: string): MockChannel {
      const ch: MockChannel = {
        name,
        listeners: [],
        statusCb: null,
        on(_type, config, cb) {
          ch.listeners.push({ config, cb })
          return ch
        },
        subscribe(cb) {
          ch.statusCb = cb
          return ch
        },
        unsubscribe() {
          /* no-op for tests */
        },
        __emit(payload) {
          for (const l of ch.listeners) l.cb(payload)
        },
        __emitStatus(status) {
          ch.statusCb?.(status)
        },
      }
      channels.push(ch)
      return ch
    },
    removeChannel(_ch) {
      removed += 1
    },
  }

  return client
}
