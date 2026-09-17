'use client'

/**
 * Browser-side event queue → POST /api/v1/events. Batched, flushed on a timer,
 * when the tab is hidden, and when the batch is full. Only events marked
 * `client: true` in the registry are accepted by the server anyway.
 */
import type { EventName } from './registry'

interface QueuedEvent {
  name: EventName
  page?: string
  entity_type?: string
  entity_id?: string
  metadata?: Record<string, string | number | boolean | null>
  session_id: string
  at: string
}

const ENDPOINT = '/api/v1/events'
const MAX_BATCH = 20
const FLUSH_MS = 4000
const SESSION_KEY = 'aistart360_sid'

let queue: QueuedEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null

export function sessionId(): string {
  try {
    let sid = window.sessionStorage.getItem(SESSION_KEY)
    if (!sid) {
      sid = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 32)
      window.sessionStorage.setItem(SESSION_KEY, sid)
    }
    return sid
  } catch {
    return 'nosession'
  }
}

export function flushEvents(useBeacon = false): void {
  if (typeof window === 'undefined' || queue.length === 0) return
  const batch = queue.splice(0, MAX_BATCH)
  const body = JSON.stringify({ events: batch })
  if (timer) { clearTimeout(timer); timer = null }
  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
    } else {
      void fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'include' }).catch(() => {})
    }
  } catch {
    /* analytics must never break the page */
  }
  if (queue.length) flushEvents(useBeacon)
}

export function track(
  name: EventName,
  opts: { page?: string; entityType?: string; entityId?: string; metadata?: QueuedEvent['metadata'] } = {},
): void {
  if (typeof window === 'undefined') return
  queue.push({
    name,
    page: opts.page ?? window.location.pathname,
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    metadata: opts.metadata,
    session_id: sessionId(),
    at: new Date().toISOString(),
  })
  if (queue.length >= MAX_BATCH) flushEvents()
  else if (!timer) timer = setTimeout(() => flushEvents(), FLUSH_MS)
}
