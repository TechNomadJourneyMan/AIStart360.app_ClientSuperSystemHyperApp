/**
 * components/point-b/planController.ts — the client side of the Point B plan workflow
 * (plan Phase 1 Task 10), free of React and of the DOM so it can be tested with a fetch
 * double (see components/popups/popupController.ts for the approach).
 *
 * Contract (plan Task 7):
 *   GET  /api/v1/point-b/plan  → { ok, data: { status: 'none'|'preparing'|'published',
 *          version: { number, approvedAt, expertNotes, authorName, goals } | null,
 *          goalReviews: [{ id, metricKey, metricLabel, status, from, to, reason, createdAt }] } }
 *   POST /api/v1/point-b/goals/:reviewId/respond { accept } → { ok } (403 while an admin views the cabinet)
 * The user comes from the session; the server returns only the approved version.
 *
 * Failure of the GET is silence: the banner and the cards are supplementary, the page
 * below them works without them. Failure of a response is shown on its card.
 */

export type PlanStatus = 'none' | 'preparing' | 'published'

export interface PlanVersionInfo {
  number: number
  approvedAt: string | null
  expertNotes: string | null
  authorName: string | null
}

export interface GoalCorrection {
  id: string
  metricLabel: string
  from: number | null
  to: number | null
  reason: string | null
  createdAt: string | null
}

export interface ClientPlanSnapshot {
  loaded: boolean
  status: PlanStatus
  version: PlanVersionInfo | null
  /** Corrections waiting for the owner's answer (status `corrected`). */
  corrections: GoalCorrection[]
  /** Review ids with a response in flight. */
  responding: string[]
  /** Server text of a failed response, by review id. */
  errors: Record<string, string>
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function parseClientPlan(body: unknown): Pick<ClientPlanSnapshot, 'status' | 'version' | 'corrections'> | null {
  if (!isObj(body) || body.ok !== true || !isObj(body.data)) return null
  const d = body.data
  const status: PlanStatus = d.status === 'preparing' || d.status === 'published' ? d.status : 'none'
  const v = isObj(d.version) ? d.version : null
  const version: PlanVersionInfo | null = v && typeof v.number === 'number'
    ? { number: v.number, approvedAt: str(v.approvedAt), expertNotes: str(v.expertNotes), authorName: str(v.authorName) }
    : null
  const corrections = (Array.isArray(d.goalReviews) ? d.goalReviews : [])
    .filter(isObj)
    .filter((r) => r.status === 'corrected' && typeof r.id === 'string')
    .map((r): GoalCorrection => ({
      id: r.id as string,
      metricLabel: str(r.metricLabel) ?? 'Цель',
      from: numOrNull(r.from),
      to: numOrNull(r.to),
      reason: str(r.reason),
      createdAt: str(r.createdAt),
    }))
  return { status, version, corrections }
}

const RESPOND_ERROR: Record<number, string> = {
  0: 'Нет связи с сервером. Проверьте соединение и повторите.',
  401: 'Сессия закончилась — войдите заново',
  403: 'В режиме просмотра от имени пользователя отвечать нельзя',
  404: 'Это предложение уже закрыто или не найдено',
}

export class ClientPlanController {
  private snap: ClientPlanSnapshot = { loaded: false, status: 'none', version: null, corrections: [], responding: [], errors: {} }
  private listeners = new Set<() => void>()

  constructor(private readonly fetchFn: typeof fetch) {}

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): ClientPlanSnapshot => this.snap

  private set(patch: Partial<ClientPlanSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  async load(): Promise<void> {
    try {
      const res = await this.fetchFn('/api/v1/point-b/plan', { cache: 'no-store' })
      if (!res.ok) return
      const parsed = parseClientPlan(await res.json().catch(() => null))
      if (!parsed) return
      // Keep corrections the owner is answering right now out of a racing reload.
      this.set({ loaded: true, ...parsed, corrections: parsed.corrections.filter((c) => !this.snap.responding.includes(c.id)) })
    } catch {
      /* silence: the page works without the banner */
    }
  }

  /** «Согласен» (accept) / «Не согласен» (dispute). On success the card is closed. */
  async respond(reviewId: string, accept: boolean): Promise<boolean> {
    if (this.snap.responding.includes(reviewId)) return false
    const { [reviewId]: _drop, ...errors } = this.snap.errors
    void _drop
    this.set({ responding: [...this.snap.responding, reviewId], errors })
    let ok = false
    let message: string | null = null
    try {
      const res = await this.fetchFn(`/api/v1/point-b/goals/${encodeURIComponent(reviewId)}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept }),
      })
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null
      ok = res.ok && body?.ok !== false
      if (!ok) message = (typeof body?.error === 'string' && body.error.trim() ? body.error : RESPOND_ERROR[res.status]) ?? `Не удалось отправить ответ (${res.status})`
    } catch {
      message = RESPOND_ERROR[0]
    }
    const responding = this.snap.responding.filter((id) => id !== reviewId)
    if (ok) {
      this.set({ responding, corrections: this.snap.corrections.filter((c) => c.id !== reviewId) })
    } else {
      this.set({ responding, errors: { ...this.snap.errors, [reviewId]: message! } })
    }
    return ok
  }
}

// ── Wording ─────────────────────────────────────────────────────────────

export function fmtGoalNumber(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

export function fmtLongDate(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}
