'use client'

/**
 * lib/assistant/mascot/analytics.ts — fire-and-forget mascot event tracking.
 *
 * Buffers events for ~1.5 s and posts them as one batch to
 * POST /api/v1/assistant/events (≤20 per call, strict whitelist server-side).
 * Failures are swallowed — analytics must never break the UI — and the buffer
 * flushes with `keepalive` on pagehide so tail events survive navigation.
 */

type MascotEventType =
  | 'mascot_shown'
  | 'hint_shown'
  | 'hint_clicked'
  | 'hint_dismissed'
  | 'chat_opened'
  | 'message_sent'
  | 'answer_received'
  | 'mascot_minimized'
  | 'mascot_restored'

interface MascotEvent {
  type: MascotEventType
  screen?: string
  refId?: string
  meta?: Record<string, unknown>
}

const FLUSH_DELAY_MS = 1500
const MAX_BATCH = 20

let queue: MascotEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let pagehideHooked = false

async function flush(keepalive = false): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (queue.length === 0) return
  const events = queue.slice(0, MAX_BATCH)
  queue = queue.slice(MAX_BATCH)
  try {
    await fetch('/api/v1/assistant/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      keepalive,
      body: JSON.stringify({ events }),
    })
  } catch {
    // Analytics is best-effort by design.
  }
  if (queue.length > 0) schedule()
}

function schedule(): void {
  if (timer) return
  timer = setTimeout(() => void flush(), FLUSH_DELAY_MS)
}

/** Queue a mascot event (batched; safe to call from anywhere client-side). */
export function trackMascotEvent(
  type: MascotEventType,
  data: { screen?: string; refId?: string; meta?: Record<string, unknown> } = {},
): void {
  if (typeof window === 'undefined') return
  queue.push({ type, ...data })
  if (!pagehideHooked) {
    pagehideHooked = true
    window.addEventListener('pagehide', () => void flush(true))
  }
  if (queue.length >= MAX_BATCH) void flush()
  else schedule()
}
