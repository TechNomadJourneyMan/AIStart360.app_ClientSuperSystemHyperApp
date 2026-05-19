'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import {
  startRealtimeSync,
  bindingsSignature,
  type RealtimeSyncBinding,
  type ConnectionStatus,
  type SupabaseClientLike,
} from '@/lib/realtime/sync-core'

export type { RealtimeSyncBinding } from '@/lib/realtime/sync-core'

interface UseRealtimeSyncResult {
  status: ConnectionStatus
  lastEventAt: string | null
}

/**
 * Subscribe to one or more Supabase Realtime channels and invalidate the
 * paired React Query keys on every event.
 *
 * Channels are kept stable across renders — re-subscription only happens
 * when the bindings' logical signature (table + filter + event) changes,
 * NOT on every reference change. This avoids tearing down the WebSocket on
 * every render of a parent component.
 *
 * Strict-mode safe: the effect's cleanup tears down all channels and marks
 * the previous run cancelled, so React's dev-mode double-mount produces at
 * most a brief duplicate subscription that's immediately reaped.
 *
 * Degrades silently if Supabase is unreachable: status stays 'closed' and
 * a `console.warn` is emitted — no throws, no toast spam.
 */
export function useRealtimeSync(bindings: RealtimeSyncBinding[]): UseRealtimeSyncResult {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [lastEventAt, setLastEventAt] = useState<string | null>(null)

  // Compute a stable signature so a fresh-array-same-shape doesn't re-subscribe.
  const signature = useMemo(() => bindingsSignature(bindings), [bindings])

  // Stash the latest bindings in a ref — used inside the effect so we always
  // see the freshest `onChange` closure without re-keying the effect.
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings

  // Resolve userId from the Supabase session if available. The hook is
  // intentionally userId-agnostic at the public API — channel scoping uses
  // whatever the current session has, falling back to 'anon'.
  const userIdRef = useRef<string>('anon')

  useEffect(() => {
    let cancelled = false
    let teardown: (() => void) | null = null

    const init = async () => {
      let client: SupabaseClientLike
      try {
        client = createClient() as unknown as SupabaseClientLike
      } catch (err) {
        console.warn('[useRealtimeSync] failed to create supabase client', err)
        if (!cancelled) setStatus('closed')
        return
      }

      // Best-effort userId resolution. If session lookup fails or there is
      // no user, we keep the 'anon' default — channel names still need a
      // unique-per-tab segment to avoid strict-mode collisions, which is
      // already supplied by the table/filter/event in the descriptor.
      try {
        // @ts-expect-error — supabase client `.auth` isn't on the minimal interface.
        const { data } = await client.auth.getUser()
        if (data?.user?.id) userIdRef.current = data.user.id
      } catch {
        /* ignore — anon fallback is fine */
      }

      if (cancelled) return

      teardown = startRealtimeSync(bindingsRef.current, {
        client,
        queryClient,
        userId: userIdRef.current,
        setStatus,
        setLastEventAt,
      })
    }

    init()

    return () => {
      cancelled = true
      if (teardown) teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signature is the canonical key
  }, [signature, queryClient])

  return { status, lastEventAt }
}
