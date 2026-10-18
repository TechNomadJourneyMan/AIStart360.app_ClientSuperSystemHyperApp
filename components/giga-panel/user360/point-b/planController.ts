/**
 * components/giga-panel/user360/point-b/planController.ts — the brain of the
 * expert / admin plan UI (User 360 → «Точка Б», the «Разбор» tab), free of React
 * and of the DOM so it can be tested with a fetch double (the repo has neither
 * jsdom nor Testing Library; same approach as components/popups/popupController.ts).
 * `usePlanController` binds it to the panels; they only draw `getSnapshot()`.
 *
 * It speaks the contract of plan Task 6 (all under /api/giga-admin/users/:id/point-b/plan):
 *   GET  …/plan                                  → { ok, data: { plan, versions, open, published, goals?, canApprove } }
 *   POST …/plan/versions            {}           → draft (409 open_exists if one is already open)
 *   PATCH …/plan/versions/:vid  { expertNotes?, changeReason? }       (409 unless draft)
 *   POST …/plan/versions/:vid/submit {}
 *   POST …/plan/versions/:vid/approve { exceptionReason? }            (approver only; 409 { reasons } if conditions fail)
 *   POST …/plan/versions/:vid/reject  { reason }                      (approver only, ≥ 5 chars)
 *   POST …/plan/goals/:metricKey/review { periodLabel, action: 'verify'|'correct', value?, deadline?, reason? }
 * Errors are `{ ok:false, error, reasons?, field? }`; 400 carries the field (profanity).
 * Nothing here decides a business rule the server owns: it only shows what the server
 * says and avoids obviously doomed requests (too short a reason).
 */
import type { GoalReviewStatus, PlanGoalItem, PlanGoalsSnapshot, PlanVersionRow, PlanVersionStatus } from '@/lib/point-b/plan/types'
import {
  EXCEPTION_REASON_MIN,
  REASON_NO_PRIMARY_GOAL,
  REASON_PRIMARY_NOT_VERIFIED,
} from '@/lib/point-b/plan/status'

export const REJECT_REASON_MIN = 5
export const NOTES_MAX = 8000

export const STATUS_LABEL: Record<PlanVersionStatus, string> = {
  draft: 'Черновик',
  in_review: 'На проверке',
  approved: 'Одобрена',
  superseded: 'Заменена',
}

export type BadgeTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'violet'

export const STATUS_TONE: Record<PlanVersionStatus, BadgeTone> = {
  draft: 'neutral',
  in_review: 'amber',
  approved: 'green',
  superseded: 'violet',
}

export const GOAL_STATUS_INFO: Record<GoalReviewStatus, { label: string; tone: BadgeTone; hint: string }> = {
  owner_draft: { label: 'Ждёт проверки', tone: 'amber', hint: 'Цель поставил владелец, эксперт её ещё не проверял' },
  verified: { label: 'Подтверждена', tone: 'green', hint: 'Эксперт проверил цель' },
  corrected: { label: 'Ждёт согласия владельца', tone: 'blue', hint: 'Эксперт предложил исправление, владелец ещё не ответил' },
  agreed: { label: 'Согласована владельцем', tone: 'green', hint: 'Владелец согласился с исправлением' },
  disputed: { label: 'Оспорена владельцем', tone: 'red', hint: 'Владелец не согласен с исправлением — цель нужно пересмотреть' },
}

// ── State parsed from the server ─────────────────────────────────────────

export interface PlanState {
  versions: PlanVersionRow[]
  /** The open version (draft or in_review), if any — one per plan. */
  open: PlanVersionRow | null
  published: PlanVersionRow | null
  /** Live goals with their verification statuses. */
  goals: PlanGoalsSnapshot
  canApprove: boolean
}

const EMPTY_GOALS: PlanGoalsSnapshot = { primary: null, items: [] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const asVersion = (v: unknown): PlanVersionRow | null => (isObj(v) && typeof v.id === 'string' ? (v as unknown as PlanVersionRow) : null)

function asGoals(v: unknown): PlanGoalsSnapshot | null {
  if (!isObj(v) || !Array.isArray(v.items)) return null
  return {
    primary: isObj(v.primary) && typeof v.primary.metricKey === 'string' && typeof v.primary.periodLabel === 'string'
      ? { metricKey: v.primary.metricKey, periodLabel: v.primary.periodLabel }
      : null,
    items: (v.items as unknown[]).filter(isObj) as unknown as PlanGoalItem[],
  }
}

/** Tolerant: a missing plan (a client without one yet) is an empty state, not an error. */
export function parsePlanState(body: unknown): PlanState {
  const d = isObj(body) && isObj(body.data) ? body.data : {}
  const versions = (Array.isArray(d.versions) ? d.versions : []).map(asVersion).filter((v): v is PlanVersionRow => !!v)
  const byRecency = [...versions].sort((a, b) => b.version - a.version)
  const open = asVersion(d.open) ?? byRecency.find((v) => v.status === 'draft' || v.status === 'in_review') ?? null
  const published = asVersion(d.published) ?? byRecency.find((v) => v.status === 'approved') ?? null
  const goals = asGoals(d.goals) ?? asGoals(open?.goals) ?? asGoals(published?.goals) ?? EMPTY_GOALS
  return { versions: byRecency, open, published, goals, canApprove: d.canApprove === true }
}

// ── What the role may do with a version ─────────────────────────────────

export interface VersionActions { edit: boolean; submit: boolean; approve: boolean; reject: boolean }

/**
 * `canApprove` is `canApprovePointB(role)` from the server: only Admin / Super Admin
 * approve or return; an expert only edits a draft and sends it on.
 */
export function versionActions(status: PlanVersionStatus, canApprove: boolean): VersionActions {
  return {
    edit: status === 'draft',
    submit: status === 'draft',
    approve: status === 'in_review' && canApprove,
    reject: status === 'in_review' && canApprove,
  }
}

/** The exception dialog is only useful when every failed condition can be waived by it. */
export function offersException(reasons: string[]): boolean {
  return reasons.length > 0 && reasons.every((r) => r === REASON_NO_PRIMARY_GOAL || r === REASON_PRIMARY_NOT_VERIFIED)
}

export function validateException(reason: string): string | null {
  return reason.trim().length >= EXCEPTION_REASON_MIN ? null : `Причина исключения — не короче ${EXCEPTION_REASON_MIN} символов`
}

export function validateRejectReason(reason: string): string | null {
  return reason.trim().length >= REJECT_REASON_MIN ? null : `Напишите, что поправить, — не короче ${REJECT_REASON_MIN} символов`
}

// ── Requests ────────────────────────────────────────────────────────────

export interface UiError { message: string; reasons: string[]; field: string | null; status: number }

const FIELD_ALIASES: Record<string, string> = {
  expert_notes: 'expertNotes', change_reason: 'changeReason', exception_reason: 'exceptionReason',
}

const DEFAULT_ERROR: Record<number, string> = {
  0: 'Нет связи с сервером. Проверьте соединение и повторите.',
  401: 'Сессия закончилась — войдите заново',
  403: 'Недостаточно прав',
  404: 'Не найдено',
  409: 'Версия уже изменилась — обновите страницу',
}

interface Reply { ok: boolean; status: number; body: Record<string, unknown> | null }

async function call(fetchFn: typeof fetch, method: string, url: string, json?: unknown): Promise<Reply> {
  try {
    const res = await fetchFn(url, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: json !== undefined ? JSON.stringify(json) : undefined,
    })
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    return { ok: res.ok && body?.ok !== false, status: res.status, body }
  } catch {
    return { ok: false, status: 0, body: null }
  }
}

function toUiError(r: Reply): UiError {
  const b = r.body ?? {}
  const text = typeof b.error === 'string' && b.error.trim() ? b.error : typeof b.message === 'string' ? b.message : ''
  const field = typeof b.field === 'string' ? (FIELD_ALIASES[b.field] ?? b.field) : null
  return {
    message: text || DEFAULT_ERROR[r.status] || `Ошибка сервера (${r.status})`,
    reasons: Array.isArray(b.reasons) ? b.reasons.filter((x): x is string => typeof x === 'string') : [],
    field,
    status: r.status,
  }
}

// ── Controller ──────────────────────────────────────────────────────────

export interface PlanSnapshot {
  phase: 'loading' | 'ready' | 'error'
  plan: PlanState | null
  loadError: string | null
  /** Name of the running action, e.g. 'approve', 'save', 'goal:revenue'. */
  busy: string | null
  /** The last failed action (shown next to the buttons). */
  error: UiError | null
  /** Approval failed on waivable conditions: the exception dialog is offered. */
  exception: { versionId: string; reasons: string[]; error: UiError | null } | null
  notice: string | null
  /** Which panel the notice / error belongs to (the plan and the goals share one controller). */
  scope: 'plan' | 'goal'
}

export interface GoalReviewInput {
  metricKey: string
  periodLabel: string
  action: 'verify' | 'correct'
  value?: number
  deadline?: string | null
  reason?: string
}

export class PlanController {
  private snap: PlanSnapshot = { phase: 'loading', plan: null, loadError: null, busy: null, error: null, exception: null, notice: null, scope: 'plan' }
  private listeners = new Set<() => void>()
  private seq = 0

  constructor(private readonly userId: string, private readonly fetchFn: typeof fetch) {}

  private get base(): string { return `/api/giga-admin/users/${this.userId}/point-b/plan` }

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): PlanSnapshot => this.snap

  private set(patch: Partial<PlanSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  async load(): Promise<void> {
    const my = ++this.seq
    const r = await call(this.fetchFn, 'GET', this.base)
    if (my !== this.seq) return // a newer load superseded this one
    if (!r.ok) {
      this.set({ phase: 'error', loadError: toUiError(r).message })
      return
    }
    this.set({ phase: 'ready', plan: parsePlanState(r.body), loadError: null })
  }

  dismissNotice(): void { this.set({ notice: null, error: null }) }
  closeException(): void { this.set({ exception: null }) }

  /** Runs one mutation: busy flag, error capture, reload on success. */
  private async act(key: string, run: () => Promise<Reply>, ok: string | null): Promise<Reply> {
    if (this.snap.busy) return { ok: false, status: 0, body: null }
    this.set({ busy: key, error: null, notice: null, scope: key.startsWith('goal:') ? 'goal' : 'plan' })
    const r = await run()
    if (r.ok) {
      this.set({ busy: null, notice: ok })
      await this.load()
    } else {
      this.set({ busy: null, error: toUiError(r) })
    }
    return r
  }

  async createDraft(): Promise<boolean> {
    return (await this.act('create', () => call(this.fetchFn, 'POST', `${this.base}/versions`, {}), 'Создан черновик новой версии')).ok
  }

  async saveDraft(versionId: string, form: { expertNotes: string; changeReason: string }): Promise<boolean> {
    return (await this.act('save', () => call(this.fetchFn, 'PATCH', `${this.base}/versions/${versionId}`, {
      expertNotes: form.expertNotes.trim() || null,
      changeReason: form.changeReason.trim() || null,
    }), 'Черновик сохранён')).ok
  }

  /** Saves the form, then sends the version to the approvers. */
  async submitDraft(versionId: string, form: { expertNotes: string; changeReason: string }): Promise<boolean> {
    if (this.snap.busy) return false
    this.set({ busy: 'submit', error: null, notice: null, scope: 'plan' })
    const saved = await call(this.fetchFn, 'PATCH', `${this.base}/versions/${versionId}`, {
      expertNotes: form.expertNotes.trim() || null,
      changeReason: form.changeReason.trim() || null,
    })
    if (!saved.ok) { this.set({ busy: null, error: toUiError(saved) }); return false }
    const r = await call(this.fetchFn, 'POST', `${this.base}/versions/${versionId}/submit`, {})
    if (!r.ok) { this.set({ busy: null, error: toUiError(r) }); return false }
    this.set({ busy: null, notice: 'Версия отправлена на одобрение' })
    await this.load()
    return true
  }

  /**
   * Approve. When the server refuses on waivable conditions (409 with reasons) and no
   * exception was given, the exception dialog is offered instead of a dead end.
   */
  async approve(versionId: string, exceptionReason?: string): Promise<boolean> {
    if (exceptionReason !== undefined) {
      const bad = validateException(exceptionReason)
      if (bad) {
        this.set({ exception: this.snap.exception ? { ...this.snap.exception, error: { message: bad, reasons: [], field: 'exceptionReason', status: 400 } } : null })
        return false
      }
    }
    if (this.snap.busy) return false
    this.set({ busy: 'approve', error: null, notice: null, scope: 'plan' })
    const r = await call(this.fetchFn, 'POST', `${this.base}/versions/${versionId}/approve`, exceptionReason !== undefined ? { exceptionReason: exceptionReason.trim() } : {})
    if (r.ok) {
      this.set({ busy: null, exception: null, notice: 'Версия одобрена — клиент увидит её в Точке Б' })
      await this.load()
      return true
    }
    const err = toUiError(r)
    if (r.status === 409 && exceptionReason === undefined && offersException(err.reasons)) {
      this.set({ busy: null, error: err, exception: { versionId, reasons: err.reasons, error: null } })
    } else if (this.snap.exception) {
      this.set({ busy: null, exception: { ...this.snap.exception, error: err } })
    } else {
      this.set({ busy: null, error: err })
    }
    return false
  }

  async reject(versionId: string, reason: string): Promise<boolean> {
    const bad = validateRejectReason(reason)
    if (bad) { this.set({ scope: 'plan', error: { message: bad, reasons: [], field: 'reason', status: 400 } }); return false }
    return (await this.act('reject', () => call(this.fetchFn, 'POST', `${this.base}/versions/${versionId}/reject`, { reason: reason.trim() }), 'Версия возвращена эксперту с комментарием')).ok
  }

  async reviewGoal(input: GoalReviewInput): Promise<boolean> {
    if (input.action === 'correct') {
      if (!Number.isFinite(input.value)) { this.set({ scope: 'goal', error: { message: 'Укажите новое значение цели', reasons: [], field: 'value', status: 400 } }); return false }
      if (!input.reason || !input.reason.trim()) { this.set({ scope: 'goal', error: { message: 'Объясните владельцу, почему цель исправлена', reasons: [], field: 'reason', status: 400 } }); return false }
    }
    const body: Record<string, unknown> = { periodLabel: input.periodLabel, action: input.action }
    if (input.action === 'correct') {
      body.value = input.value
      body.deadline = input.deadline || null
      body.reason = input.reason!.trim()
    }
    const done = input.action === 'verify'
      ? 'Цель подтверждена'
      : 'Исправление отправлено владельцу и ждёт его согласия'
    return (await this.act(`goal:${input.metricKey}`, () => call(this.fetchFn, 'POST', `${this.base}/goals/${encodeURIComponent(input.metricKey)}/review`, body), done)).ok
  }
}

// ── Formatting shared by the panels ─────────────────────────────────────

export function fmtNumber(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}
