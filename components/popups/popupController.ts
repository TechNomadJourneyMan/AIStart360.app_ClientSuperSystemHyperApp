/**
 * components/popups/popupController.ts — the brain of the cabinet pop-up
 * layer, free of React and of the DOM so it can be tested with fake timers.
 * `usePopups` binds it to the page; PopupLayer only draws `current`.
 *
 * Rules (spec §12.2, plan Task 10):
 *   - the list comes from GET /api/v1/popups (already selected and ordered by
 *     the server); loaded when the layer mounts and when the route changes,
 *     at most once a minute; a fallback poll every 2 minutes while the tab is
 *     visible; a new staff message arrives over Realtime and joins the queue
 *     without a request;
 *   - nothing opens in the first 5 seconds after load, nor while the user is
 *     typing in a field outside the layer (the window waits in the queue and
 *     opens after blur — it is not lost), nor on suppressed routes;
 *   - one window on screen at a time; a card on screen stays until the user
 *     acts, except that an important message (modal) takes its place;
 *   - an error or an empty answer = silence: nothing is shown, nothing written;
 *   - a write about an insight or a recommendation (a Point B invite, plan Ф6a Task 7) carries its `kind`, so the
 *     server changes the invite and not a message; an expert message is written as before (no `kind`).
 */
import { isPopupSuppressedRoute } from '@/lib/popups/select'
import { candidateFromMessage } from '@/lib/popups/store'
import { POPUP_SNOOZE_DAYS, type PopupCandidate, type PopupKind, type PopupSnoozeDays } from '@/lib/popups/types'

export const POPUP_QUIET_MS = 5_000
export const POPUP_RELOAD_MIN_MS = 60_000
export const POPUP_POLL_MS = 120_000

export interface PopupControllerDeps {
  fetchFn: typeof fetch
  now?: () => number
  /** A text field outside the layer has the focus. */
  isTyping: () => boolean
  /** The tab is visible. */
  isVisible: () => boolean
  /** Realtime: staff messages of the conversation. Returns the unsubscribe function. */
  subscribe: (threadId: string, onRow: (row: Record<string, unknown>) => void) => () => void
}

export interface PopupSnapshot {
  popups: PopupCandidate[]
  current: PopupCandidate | null
}

const byImportance = (a: PopupCandidate, b: PopupCandidate) =>
  a.priority - b.priority || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export class PopupController {
  private queue: PopupCandidate[] = []
  private current: PopupCandidate | null = null
  private snapshot: PopupSnapshot = { popups: [], current: null }
  private listeners = new Set<() => void>()
  private route = ''
  private mountedAt = 0
  private lastLoadAt = -Infinity
  private forceNextLoad = false
  private inflight: Promise<void> | null = null
  private threadId: string | null = null
  private unsubscribe: (() => void) | null = null
  private quietTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private readonly dismissed = new Set<string>()
  private readonly shown = new Set<string>()
  private readonly seenSent = new Set<string>()
  /** Kind of every candidate ever queued: a write after the card left the queue still knows what it was about. */
  private readonly kinds = new Map<string, PopupKind>()
  private modalsShown = 0
  private started = false

  constructor(private readonly deps: PopupControllerDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  // ── subscription for useSyncExternalStore ──────────────────────────────
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): PopupSnapshot => this.snapshot

  private emit(): void {
    this.snapshot = { popups: [...this.queue], current: this.current }
    this.listeners.forEach((l) => l())
  }

  // ── lifecycle ──────────────────────────────────────────────────────────
  start(): void {
    if (this.started) return
    this.started = true
    this.mountedAt = this.now()
    this.quietTimer = setTimeout(() => this.refresh(), POPUP_QUIET_MS)
    this.pollTimer = setInterval(() => {
      if (this.deps.isVisible() && this.route && !isPopupSuppressedRoute(this.route)) void this.load()
    }, POPUP_POLL_MS)
  }

  stop(): void {
    this.started = false
    if (this.quietTimer) clearTimeout(this.quietTimer)
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.quietTimer = null
    this.pollTimer = null
    this.unsubscribe?.()
    this.unsubscribe = null
    this.threadId = null
  }

  /** The pathname changed (or the layer mounted). */
  async setRoute(route: string): Promise<void> {
    this.route = route
    if (isPopupSuppressedRoute(route)) {
      // What waits behind the page is re-read when the user leaves it: the
      // server knows whether he read it there (messages page) or not (wizard).
      this.forceNextLoad = true
      this.current = null
      this.emit()
      return
    }
    if (this.forceNextLoad || this.now() - this.lastLoadAt >= POPUP_RELOAD_MIN_MS) await this.load()
    else this.refresh()
  }

  /** Recompute what is on screen (call after the focus or the time gate changed). */
  refresh(): void {
    if (isPopupSuppressedRoute(this.route)) {
      if (this.current) { this.current = null }
      this.emit()
      return
    }
    const open = this.started && this.now() - this.mountedAt >= POPUP_QUIET_MS && !this.deps.isTyping()
    if (open) {
      const best = this.queue.find((p) => !this.shown.has(p.id) && !this.dismissed.has(p.id)) ?? null
      if (best && (!this.current || (this.current.display === 'card' && best.display === 'modal'))) this.show(best)
    }
    this.emit()
  }

  private show(p: PopupCandidate): void {
    this.current = p
    this.shown.add(p.id)
    if (p.display === 'modal') this.modalsShown += 1
    void this.markSeen(p.id)
  }

  // ── loading ────────────────────────────────────────────────────────────
  private load(): Promise<void> {
    if (this.inflight) return this.inflight
    this.lastLoadAt = this.now()
    this.forceNextLoad = false
    const run = async () => {
      try {
        const res = await this.deps.fetchFn(`/api/v1/popups?route=${encodeURIComponent(this.route)}`, { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: { threadId?: string | null; popups?: unknown } } | null
        if (!body?.ok || !Array.isArray(body.data?.popups)) return
        const list = (body.data!.popups as PopupCandidate[]).filter((p) => p && typeof p.id === 'string' && !this.dismissed.has(p.id))
        list.forEach((p) => this.kinds.set(p.id, p.kind))
        this.queue = list.sort(byImportance)
        this.bindThread(body.data!.threadId ?? null)
      } catch {
        /* silence: the page works without the layer */
      }
    }
    this.inflight = run().finally(() => { this.inflight = null; this.refresh() })
    return this.inflight
  }

  private bindThread(threadId: string | null): void {
    if (threadId === this.threadId) return
    this.unsubscribe?.()
    this.unsubscribe = null
    this.threadId = threadId
    if (threadId) this.unsubscribe = this.deps.subscribe(threadId, (row) => this.onRealtimeRow(row))
  }

  private onRealtimeRow(row: Record<string, unknown>): void {
    if (typeof row.id !== 'string' || typeof row.body !== 'string') return
    const c = candidateFromMessage({
      id: row.id,
      author_kind: row.author_kind as never,
      author_name: (row.author_name as string | null) ?? null,
      subject: (row.subject as string | null) ?? null,
      body: row.body,
      flags: (row.flags as never) ?? {},
      created_at: typeof row.created_at === 'string' ? row.created_at : new Date(this.now()).toISOString(),
      direction: row.direction as never,
      channel: row.channel as never,
    })
    if (!c || this.dismissed.has(c.id) || this.queue.some((p) => p.id === c.id)) return
    // One modal per day is the server's rule; a second one in the same visit is shown as a card.
    const candidate = c.display === 'modal' && this.modalsShown > 0 ? { ...c, display: 'card' as const } : c
    this.kinds.set(candidate.id, candidate.kind)
    this.queue = [...this.queue, candidate].sort(byImportance)
    this.refresh()
  }

  // ── user actions ───────────────────────────────────────────────────────
  private remove(id: string): void {
    this.dismissed.add(id)
    this.queue = this.queue.filter((p) => p.id !== id)
    if (this.current?.id === id) this.current = null
    this.refresh()
  }

  private async patch(id: string, body: Record<string, unknown>): Promise<void> {
    const kind = this.kinds.get(id)
    const payload = kind === 'insight' || kind === 'recommendation' ? { ...body, kind } : body
    try {
      await this.deps.fetchFn(`/api/v1/popups/${encodeURIComponent(id)}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(payload) })
    } catch {
      /* a lost write only means the window may come back after a reload */
    }
  }

  async markSeen(id: string): Promise<void> {
    if (this.seenSent.has(id)) return
    this.seenSent.add(id)
    await this.patch(id, { action: 'seen' })
  }

  async dismiss(id: string): Promise<void> {
    this.remove(id)
    await this.patch(id, { action: 'dismiss' })
  }

  async snooze(id: string, days: PopupSnoozeDays): Promise<void> {
    if (!(POPUP_SNOOZE_DAYS as readonly number[]).includes(days)) return
    this.remove(id)
    await this.patch(id, { action: 'snooze', days })
  }

  /** «Открыть» on an insight / a recommendation: the user went to it — the card leaves and the invite is «acted». */
  async act(id: string): Promise<void> {
    this.remove(id)
    await this.patch(id, { action: 'acted' })
  }

  /** Quick reply from the window: an inbound message in the user's conversation, then the window closes. */
  async reply(id: string, text: string): Promise<void> {
    const body = text.trim()
    if (!body) throw new Error('Введите текст ответа')
    const res = await this.deps.fetchFn('/api/v1/comm/messages', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ body }) })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (!res.ok || !data?.ok) throw new Error(data?.error || 'Не удалось отправить ответ')
    this.remove(id)
    await this.patch(id, { action: 'acted' })
  }
}

// ── DOM-free helpers (the component feeds them real elements) ────────────

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'])

/** A control where the user types (or picks from a list): a window must not open over it. */
export function isTextEntry(el: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = (el.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((el.type ?? 'text').toLowerCase())
  return false
}

/**
 * Focus trap of the modal: which element to focus on Tab / Shift+Tab, or null
 * when the browser's own move stays inside the dialog.
 */
export function nextTrapIndex(count: number, activeIndex: number, shift: boolean): number | null {
  if (count <= 0) return null
  if (activeIndex < 0) return shift ? count - 1 : 0
  if (!shift && activeIndex === count - 1) return 0
  if (shift && activeIndex === 0) return count - 1
  return null
}
