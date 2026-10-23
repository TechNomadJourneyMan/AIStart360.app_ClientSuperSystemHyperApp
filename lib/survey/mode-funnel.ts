/**
 * lib/survey/mode-funnel.ts — the funnel of the three questionnaire modes for
 * GIGA (spec 2026-10-23 §15, §16 Ф5), computed from user_events. Pure.
 *
 * Cohort: clients whose FIRST SURVEY_MODE_CHOSEN falls into the period.
 * Events written in a cabinet opened by staff («от имени», source
 * impersonation / admin) are not the client's and are ignored. A client who
 * submitted the full questionnaire BEFORE choosing a mode is not in the cohort
 * (the submission is not a conversion of the modes).
 *
 * Steps (each = clients of the cohort who have the event at any time; share of
 * the cohort and of the previous step). The funnel is NOT strict: a step does
 * not require the previous one — a client who picked «Полная анкета» goes
 * straight to «отправили полную анкету».
 *   1. chosen            SURVEY_MODE_CHOSEN
 *   2. express_started   SURVEY_EXPRESS_STARTED
 *   3. express_completed SURVEY_EXPRESS_COMPLETED (первичная Точка А)
 *   4. snapshot          SURVEY_SNAPSHOT_VIEWED
 *   5. block_opened      SURVEY_BLOCK_OPENED
 *   6. block_completed   SURVEY_BLOCK_COMPLETED
 *   7. full_submitted    the full questionnaire submitted (admin_survey_completions /
 *                        QUESTIONNAIRE_COMPLETED) after the first choice — PO
 *                        §18.3 item 1: only this is «анкета заполнена».
 * Plus §15 metrics: median minutes of the express, «блок за 7 дней после
 * экспресса», chat cards (shown / applied / edited / rejected), number-guard
 * refusals, escalations, field helper; lists of clients stuck on the express
 * and of the cohort without a submitted questionnaire.
 */
import { SURVEY_MODES, isSurveyMode, type SurveyMode } from './modes'

export const FUNNEL_EVENT_NAMES = [
  'SURVEY_MODE_CHOSEN', 'SURVEY_EXPRESS_STARTED', 'SURVEY_EXPRESS_COMPLETED', 'SURVEY_SNAPSHOT_VIEWED',
  'SURVEY_BLOCK_OPENED', 'SURVEY_BLOCK_COMPLETED', 'QUESTIONNAIRE_COMPLETED',
  'SURVEY_CHAT_PROPOSAL', 'SURVEY_CHAT_GUARD_BLOCKED', 'SURVEY_CHAT_ESCALATED', 'SURVEY_HELPER_OPENED',
] as const

export interface FunnelEvent {
  id?: string | number
  user_id: string | null
  event_name: string
  created_at: string
  metadata?: unknown
  source?: string | null
}

export const FUNNEL_STEPS = [
  { key: 'chosen', label: 'Выбрали способ заполнения', event: 'SURVEY_MODE_CHOSEN' },
  { key: 'express_started', label: 'Начали экспресс', event: 'SURVEY_EXPRESS_STARTED' },
  { key: 'express_completed', label: 'Прошли экспресс — первичная Точка А', event: 'SURVEY_EXPRESS_COMPLETED' },
  { key: 'snapshot', label: 'Открыли «Снимок бизнеса»', event: 'SURVEY_SNAPSHOT_VIEWED' },
  { key: 'block_opened', label: 'Открыли блок углубления', event: 'SURVEY_BLOCK_OPENED' },
  { key: 'block_completed', label: 'Заполнили блок', event: 'SURVEY_BLOCK_COMPLETED' },
  { key: 'full_submitted', label: 'Отправили полную анкету', event: null },
] as const
export type FunnelStepKey = (typeof FUNNEL_STEPS)[number]['key']

export interface FunnelStep {
  key: FunnelStepKey
  label: string
  users: number
  /** % of the cohort (null for an empty cohort). */
  ofCohort: number | null
  /** % of the previous step (null for the first and the last step, or an empty previous step). */
  ofPrevious: number | null
}

export interface StuckClient { userId: string; expressCompletedAt: string; days: number }
export interface PendingClient { userId: string; mode: SurveyMode | null; chosenAt: string; expressCompletedAt: string | null }

export interface ModeFunnel {
  since: string
  until: string
  cohort: number
  steps: FunnelStep[]
  byFirstMode: Record<SurveyMode, number>
  byLastMode: Record<SurveyMode, number>
  /** Cohort clients who switched the mode at least once. */
  switched: number
  express: {
    /** Median minutes from the first express screen to «Готово» (cohort; unknown durations left out). */
    medianMinutes: number | null
    completed: number
    /** Of those: opened a block within 7 days after the express. */
    blockWithin7d: number
    blockWithin7dShare: number | null
  }
  /** Chat events in the period (all clients). */
  chat: {
    shown: number; applied: number; edited: number; rejected: number
    /** applied / (applied + edited + rejected), %. Spec §15 target ≥ 70 %. */
    acceptedWithoutEdit: number | null
    guardBlocked: number; escalated: number; helperOpened: number
  }
  /** Express done, full questionnaire not submitted — all time, longest first. */
  stuck: StuckClient[]
  /** Cohort clients without a submitted questionnaire and without the express. */
  pending: PendingClient[]
}

/** Events written from a cabinet opened by staff are not the client's. */
export const isClientEvent = (e: Pick<FunnelEvent, 'source' | 'user_id'>): boolean =>
  !!e.user_id && e.source !== 'impersonation' && e.source !== 'admin'

const time = (iso: string | null | undefined): number => {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isNaN(t) ? NaN : t
}
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null)
const DAY = 86_400_000

export function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10
}

const emptyModes = (): Record<SurveyMode, number> => Object.fromEntries(SURVEY_MODES.map((m) => [m, 0])) as Record<SurveyMode, number>

export function computeModeFunnel(input: {
  events: readonly FunnelEvent[]
  /** user_id → when the full questionnaire was submitted; null → QUESTIONNAIRE_COMPLETED events decide. */
  submissions: ReadonlyMap<string, string> | null
  since: Date
  until: Date
  now?: Date
  listLimit?: number
}): ModeFunnel {
  const now = input.now ?? input.until
  const limit = input.listLimit ?? 50
  const from = input.since.getTime()
  const to = input.until.getTime()

  // Dedupe (the route reads two overlapping ranges) and drop staff-made events.
  const seen = new Set<string>()
  const byUser = new Map<string, FunnelEvent[]>()
  for (const e of input.events) {
    if (!isClientEvent(e) || Number.isNaN(time(e.created_at))) continue
    const id = e.id !== undefined && e.id !== null ? String(e.id) : `${e.user_id}|${e.event_name}|${e.created_at}`
    if (seen.has(id)) continue
    seen.add(id)
    const list = byUser.get(e.user_id as string) ?? []
    list.push(e)
    byUser.set(e.user_id as string, list)
  }
  for (const list of byUser.values()) list.sort((a, b) => time(a.created_at) - time(b.created_at))

  const submittedAt = (userId: string, own: readonly FunnelEvent[]): number => {
    if (input.submissions) return time(input.submissions.get(userId) ?? null)
    return time(own.find((e) => e.event_name === 'QUESTIONNAIRE_COMPLETED')?.created_at ?? null)
  }

  // ── cohort ──
  const cohort: Array<{ userId: string; own: FunnelEvent[]; chosenAt: number; submitted: number }> = []
  for (const [userId, own] of byUser) {
    const first = own.find((e) => e.event_name === 'SURVEY_MODE_CHOSEN')
    if (!first) continue
    const chosenAt = time(first.created_at)
    if (chosenAt < from || chosenAt > to) continue
    const submitted = submittedAt(userId, own)
    if (!Number.isNaN(submitted) && submitted < chosenAt) continue
    cohort.push({ userId, own, chosenAt, submitted })
  }

  const has = (own: readonly FunnelEvent[], name: string) => own.some((e) => e.event_name === name)
  const counts = FUNNEL_STEPS.map((s) =>
    cohort.filter((c) => (s.event ? has(c.own, s.event) : !Number.isNaN(c.submitted))).length)
  const steps: FunnelStep[] = FUNNEL_STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
    users: counts[i],
    ofCohort: pct(counts[i], cohort.length),
    // «Отправили полную анкету» ends every path (the full mode skips the express
    // steps): it is a share of the cohort only.
    ofPrevious: i === 0 || s.event === null ? null : pct(counts[i], counts[i - 1]),
  }))

  // ── modes ──
  const byFirstMode = emptyModes()
  const byLastMode = emptyModes()
  let switched = 0
  for (const c of cohort) {
    const choices = c.own.filter((e) => e.event_name === 'SURVEY_MODE_CHOSEN').map((e) => rec(e.metadata).mode).filter(isSurveyMode)
    if (choices.length) {
      byFirstMode[choices[0]]++
      byLastMode[choices[choices.length - 1]]++
    }
    if (new Set(choices).size > 1) switched++
  }

  // ── express ──
  const minutes: number[] = []
  let expressDone = 0
  let blockWithin7d = 0
  for (const c of cohort) {
    const done = c.own.find((e) => e.event_name === 'SURVEY_EXPRESS_COMPLETED')
    if (!done) continue
    expressDone++
    const m = rec(done.metadata).minutes
    if (typeof m === 'number' && Number.isFinite(m) && m > 0) minutes.push(m)
    const at = time(done.created_at)
    if (c.own.some((e) => e.event_name === 'SURVEY_BLOCK_OPENED' && time(e.created_at) >= at && time(e.created_at) - at <= 7 * DAY)) blockWithin7d++
  }

  // ── chat (period, all clients) ──
  const chat = { shown: 0, applied: 0, edited: 0, rejected: 0, acceptedWithoutEdit: null as number | null, guardBlocked: 0, escalated: 0, helperOpened: 0 }
  for (const own of byUser.values()) {
    for (const e of own) {
      const t = time(e.created_at)
      if (t < from || t > to) continue
      if (e.event_name === 'SURVEY_CHAT_PROPOSAL') {
        const o = rec(e.metadata).outcome
        if (o === 'shown') chat.shown++
        else if (o === 'applied') chat.applied++
        else if (o === 'edited') chat.edited++
        else if (o === 'rejected') chat.rejected++
      } else if (e.event_name === 'SURVEY_CHAT_GUARD_BLOCKED') chat.guardBlocked++
      else if (e.event_name === 'SURVEY_CHAT_ESCALATED') chat.escalated++
      else if (e.event_name === 'SURVEY_HELPER_OPENED') chat.helperOpened++
    }
  }
  chat.acceptedWithoutEdit = pct(chat.applied, chat.applied + chat.edited + chat.rejected)

  // ── lists ──
  const stuck: StuckClient[] = []
  for (const [userId, own] of byUser) {
    const done = own.find((e) => e.event_name === 'SURVEY_EXPRESS_COMPLETED')
    if (!done) continue
    const submitted = submittedAt(userId, own)
    if (!Number.isNaN(submitted) && submitted >= time(done.created_at)) continue
    stuck.push({ userId, expressCompletedAt: done.created_at, days: Math.max(0, Math.floor((now.getTime() - time(done.created_at)) / DAY)) })
  }
  stuck.sort((a, b) => b.days - a.days || a.userId.localeCompare(b.userId))

  const pending: PendingClient[] = cohort
    .filter((c) => Number.isNaN(c.submitted) && !has(c.own, 'SURVEY_EXPRESS_COMPLETED'))
    .map((c) => {
      const choices = c.own.filter((e) => e.event_name === 'SURVEY_MODE_CHOSEN').map((e) => rec(e.metadata).mode).filter(isSurveyMode)
      return { userId: c.userId, mode: choices[choices.length - 1] ?? null, chosenAt: new Date(c.chosenAt).toISOString(), expressCompletedAt: null }
    })
    .sort((a, b) => a.chosenAt.localeCompare(b.chosenAt))

  return {
    since: input.since.toISOString(),
    until: input.until.toISOString(),
    cohort: cohort.length,
    steps,
    byFirstMode,
    byLastMode,
    switched,
    express: { medianMinutes: median(minutes), completed: expressDone, blockWithin7d, blockWithin7dShare: pct(blockWithin7d, expressDone) },
    chat,
    stuck: stuck.slice(0, limit),
    pending: pending.slice(0, limit),
  }
}

/**
 * Keep only the clients a scoped staff member may see (null = everyone), then
 * cut the lists — compute with an unlimited `listLimit` first so a scoped
 * expert still gets up to `limit` of HIS clients.
 */
export function scopeFunnelLists(f: ModeFunnel, allowed: readonly string[] | null, limit = 50): ModeFunnel {
  const set = allowed ? new Set(allowed) : null
  const keep = (id: string) => !set || set.has(id)
  return { ...f, stuck: f.stuck.filter((s) => keep(s.userId)).slice(0, limit), pending: f.pending.filter((p) => keep(p.userId)).slice(0, limit) }
}
