/**
 * lib/survey/staff-status.ts — how a client fills in the questionnaire, as the
 * expert and GIGA see it (spec 2026-10-23 §5.2, §10; phase Ф5):
 *   • the mode the client chose and since when («Заполняет: экспресс + блоки (с 23.10)»),
 *     plus the history of switches (SURVEY_MODE_CHOSEN);
 *   • the express status («Экспресс пройден 23.10 · первичная Точка А»);
 *   • whether the FULL questionnaire was submitted — PO §18.3 item 1: only the
 *     full questionnaire is «анкета заполнена» (lib/survey/completion.ts);
 *   • «застрял на экспрессе» = express done, full not submitted.
 * Pure and browser-safe: the server loader is lib/survey/staff-status-load.ts.
 */
import { isSurveyMode, readSurveyPreference, type SurveyMode } from './modes'

export interface SurveyModeHistoryItem {
  mode: SurveyMode
  previous: SurveyMode | null
  from: 'chooser' | 'switch' | null
  at: string
}

export interface SurveyStaffFacts {
  /** profiles.preferences (the survey part is read from it). */
  preferences?: unknown
  /** The first SURVEY_EXPRESS_COMPLETED. */
  expressCompleted?: { at: string; metadata?: unknown } | null
  /** When the full questionnaire was submitted (admin_survey_completions / QUESTIONNAIRE_COMPLETED). */
  fullSubmittedAt?: string | null
  /** SURVEY_MODE_CHOSEN events, any order. */
  modeEvents?: ReadonlyArray<{ at: string; metadata?: unknown }>
}

export interface SurveyExpressStatus {
  completedAt: string
  answered: number | null
  unknown: number | null
  total: number | null
}

export interface SurveyStaffStatus {
  mode: SurveyMode | null
  modeSince: string | null
  express: SurveyExpressStatus | null
  fullSubmittedAt: string | null
  /** The full questionnaire is not submitted yet. */
  fullPending: boolean
  /** Express done, the full questionnaire not submitted. */
  stuckOnExpress: boolean
  /** Newest first, at most 10. */
  history: SurveyModeHistoryItem[]
}

export const HISTORY_LIMIT = 10

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const time = (iso: string): number => {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

export function modeHistoryFromEvents(events: ReadonlyArray<{ at: string; metadata?: unknown }>): SurveyModeHistoryItem[] {
  const out: SurveyModeHistoryItem[] = []
  for (const e of events) {
    const m = rec(e.metadata)
    if (!isSurveyMode(m.mode)) continue
    out.push({
      mode: m.mode,
      previous: isSurveyMode(m.previous) ? m.previous : null,
      from: m.from === 'chooser' || m.from === 'switch' ? m.from : null,
      at: e.at,
    })
  }
  return out.sort((a, b) => time(b.at) - time(a.at)).slice(0, HISTORY_LIMIT)
}

export function buildSurveyStaffStatus(f: SurveyStaffFacts): SurveyStaffStatus {
  const pref = readSurveyPreference(f.preferences)
  const history = modeHistoryFromEvents(f.modeEvents ?? [])
  // The preference is the truth; the last event covers a PATCH that did not land.
  const mode = pref.mode ?? history[0]?.mode ?? null
  const modeSince = pref.mode ? pref.switched_at ?? pref.chosen_at ?? null : history[0]?.at ?? null
  let express: SurveyExpressStatus | null = null
  if (f.expressCompleted?.at) {
    const m = rec(f.expressCompleted.metadata)
    const answered = num(m.answered)
    const skipped = num(m.skipped)
    express = {
      completedAt: f.expressCompleted.at,
      answered,
      unknown: num(m.unknown),
      total: answered !== null && skipped !== null ? answered + skipped : null,
    }
  }
  const fullSubmittedAt = f.fullSubmittedAt ?? null
  return {
    mode,
    modeSince,
    express,
    fullSubmittedAt,
    fullPending: !fullSubmittedAt,
    stuckOnExpress: !!express && !fullSubmittedAt,
    history,
  }
}

// ─── labels ─────────────────────────────────────────────────────────────────

/** The mode as staff name it in a sentence. */
export const SURVEY_MODE_STAFF_NAME: Readonly<Record<SurveyMode, string>> = {
  full: 'полная анкета',
  express: 'экспресс + блоки',
  chat: 'беседа с ИИ',
}

/** 23.10 (the year only when it is not the current one). */
export function shortDate(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const dm = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
  return d.getFullYear() === now.getFullYear() ? dm : `${dm}.${d.getFullYear()}`
}

export type SurveyChipTone = 'neutral' | 'primary' | 'amber' | 'green'

export interface SurveyStatusChip {
  key: 'mode' | 'express' | 'full'
  label: string
  /** Details for the tooltip / screen reader. */
  title?: string
  tone: SurveyChipTone
  icon: string
}

export function expressDetails(e: SurveyExpressStatus): string | null {
  if (e.answered === null) return null
  const of = e.total !== null ? ` из ${e.total}` : ''
  return `Ответов ${e.answered}${of}${e.unknown ? `, «не знаю» — ${e.unknown}` : ''}`
}

/**
 * The chips of the questionnaire status. A client who never met the modes
 * (no choice, no express) gets no chips: they fill the full questionnaire as
 * before and their step progress is shown elsewhere.
 */
export function surveyStatusChips(s: SurveyStaffStatus | null | undefined, now: Date = new Date()): SurveyStatusChip[] {
  if (!s) return []
  const chips: SurveyStatusChip[] = []
  if (s.mode) {
    const since = shortDate(s.modeSince, now)
    chips.push({
      key: 'mode',
      label: `Заполняет: ${SURVEY_MODE_STAFF_NAME[s.mode]}${since ? ` (с ${since})` : ''}`,
      title: s.history.length > 1 ? `Переключений: ${s.history.length - 1}` : undefined,
      tone: 'primary',
      icon: s.mode === 'express' ? 'bolt' : s.mode === 'chat' ? 'forum' : 'assignment',
    })
  }
  if (s.express) {
    const at = shortDate(s.express.completedAt, now)
    chips.push({
      key: 'express',
      label: `Экспресс пройден${at ? ` ${at}` : ''} · первичная Точка А`,
      title: expressDetails(s.express) ?? undefined,
      tone: s.stuckOnExpress ? 'amber' : 'neutral',
      icon: 'bolt',
    })
  }
  if (s.fullSubmittedAt) {
    const at = shortDate(s.fullSubmittedAt, now)
    chips.push({ key: 'full', label: `Полная анкета отправлена${at ? ` ${at}` : ''}`, tone: 'green', icon: 'task_alt' })
  } else if (s.mode || s.express) {
    chips.push({ key: 'full', label: 'Полная анкета не отправлена', tone: s.stuckOnExpress ? 'amber' : 'neutral', icon: 'pending' })
  }
  return chips
}

/** «23.10 · экспресс + блоки (выбор)», «24.10 · полная анкета (переключение с экспресс + блоки)». */
export function historyLine(h: SurveyModeHistoryItem, now: Date = new Date()): string {
  const at = shortDate(h.at, now) ?? ''
  const how = h.from === 'switch' ? `переключение${h.previous ? ` с «${SURVEY_MODE_STAFF_NAME[h.previous]}»` : ''}` : h.from === 'chooser' ? 'выбор' : null
  return `${at} · ${SURVEY_MODE_STAFF_NAME[h.mode]}${how ? ` (${how})` : ''}`
}

// ─── lists ──────────────────────────────────────────────────────────────────

export const SURVEY_STATUS_FILTERS = ['all', 'full_pending', 'stuck_express'] as const
export type SurveyStatusFilter = (typeof SURVEY_STATUS_FILTERS)[number]

export const SURVEY_STATUS_FILTER_LABELS: Readonly<Record<SurveyStatusFilter, string>> = {
  all: 'Все',
  full_pending: 'Без отправленной полной анкеты',
  stuck_express: 'Застряли на экспрессе',
}

export function isSurveyStatusFilter(v: unknown): v is SurveyStatusFilter {
  return typeof v === 'string' && (SURVEY_STATUS_FILTERS as readonly string[]).includes(v)
}

/** Does a client match the filter? A client whose status is unknown matches only «Все». */
export function matchesSurveyFilter(s: SurveyStaffStatus | null | undefined, filter: SurveyStatusFilter): boolean {
  if (filter === 'all') return true
  if (!s) return false
  return filter === 'stuck_express' ? s.stuckOnExpress : s.fullPending
}

export function filterBySurveyStatus<T extends { survey?: SurveyStaffStatus | null }>(rows: readonly T[], filter: SurveyStatusFilter): T[] {
  return rows.filter((r) => matchesSurveyFilter(r.survey, filter))
}

export function countBySurveyFilter<T extends { survey?: SurveyStaffStatus | null }>(rows: readonly T[]): Record<SurveyStatusFilter, number> {
  return {
    all: rows.length,
    full_pending: rows.filter((r) => matchesSurveyFilter(r.survey, 'full_pending')).length,
    stuck_express: rows.filter((r) => matchesSurveyFilter(r.survey, 'stuck_express')).length,
  }
}
