/**
 * lib/survey/export.ts — turns a user's survey rows into ONE spreadsheet row
 * (fixed identity columns + every wizard question, grouped by step) and pushes
 * it to Google Sheets. Also builds the short admin summary used by the Telegram
 * «анкета заполнена» notification.
 */

import { SURVEY_KEY_STEP, SURVEY_TOTAL_STEPS, surveyProgressFromRows, type SurveyStepRow } from '@/lib/survey/steps'
import { SURVEY_LABELS, SURVEY_STEP_LABELS, formatSurveyValue } from '@/lib/survey-labels'
import { stripMarkdown } from '@/lib/survey/markdown'
import { fromAnswerEnvelope, unwrapAnswer } from '@/lib/survey/answer-value'
import { upsertRowByKey, googleSheetsConfigured, spreadsheetUrl } from '@/lib/integrations/google-sheets'
import { absoluteFileHref, fileRefName, isSurveyFileKey, surveyFileRef } from '@/lib/documents/survey-files'
import { getSiteUrl } from '@/lib/site-url'
import { formatAttributionDate } from '@/lib/survey/attribution-label'
import { ANSWER_VIA, type AnswerVia } from '@/lib/survey/attribution'
import { expressDetails, type SurveyStaffStatus } from '@/lib/survey/staff-status'
import type { SurveyMode } from '@/lib/survey/modes'

export interface SurveyExportMeta {
  userId: string
  email?: string | null
  updatedAt?: Date
  /** How the client fills in the questionnaire (survey Ф5): the «Режим анкеты» / «Экспресс» columns. */
  status?: SurveyStaffStatus | null
}

/** A survey row with the path of the answer (migration 134), when the column is there. */
export type SurveyExportRow = SurveyStepRow & { updated_via?: string | null }

export interface SurveySummary {
  company: string
  contact: string
  phone: string
  email: string
  industry: string
  revenue: string
  goal12m: string
  completedSteps: number
  totalSteps: number
}

/** Ordered wizard keys: by step, then by declaration order inside the table. */
export const SURVEY_EXPORT_KEYS: readonly string[] = Object.keys(SURVEY_KEY_STEP).sort(
  (a, b) => SURVEY_KEY_STEP[a] - SURVEY_KEY_STEP[b],
)

const IDENTITY_HEADERS = [
  'user_id',
  'Обновлено',
  'Email',
  'Компания',
  'Контакт',
  'Телефон',
  'Отрасль',
  'Шагов заполнено',
] as const

/** question_key → value; «не знаю» / «примерно» stay marks, so the sheet says «Не знаю». */
export function answersFromRows(rows: ReadonlyArray<SurveyStepRow>): Record<string, unknown> {
  const answers: Record<string, unknown> = {}
  for (const r of rows) answers[r.question_key] = fromAnswerEnvelope(r.answer)
  return answers
}

function text(answers: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = unwrapAnswer(answers[k])
    if (typeof v === 'string' && v.trim()) return stripMarkdown(v).trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return ''
}

export function buildSurveySummary(rows: ReadonlyArray<SurveyStepRow>, meta: Pick<SurveyExportMeta, 'email'> = {}): SurveySummary {
  const answers = answersFromRows(rows)
  const progress = surveyProgressFromRows(rows)
  return {
    company: text(answers, ['s1_company_name', 's1_brand']),
    contact: text(answers, ['s1_contact_name']),
    phone: text(answers, ['s1_contact_phone']),
    email: text(answers, ['s1_contact_email']) || (meta.email ?? ''),
    industry: text(answers, ['s1_industry', 's1_niche']),
    revenue: text(answers, ['s1_current_revenue_year', 's9n_revenue_2024', 's1_current_revenue_month']),
    goal12m: text(answers, ['s1_goal_12m_revenue_year', 's2n_goal_12m_what']),
    completedSteps: progress.completed,
    totalSteps: SURVEY_TOTAL_STEPS,
  }
}

/**
 * Force a cell to be stored as literal text. Apps Script `setValues` parses
 * strings like a user typing: «=IMPORTXML(…)» in a company name would run as a
 * live formula in the staff sheet, and «+7 701 …» became a number / #ERROR!.
 * A leading apostrophe is hidden by Sheets and keeps the value verbatim.
 */
export function asSheetText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

/**
 * Survey Ф5 columns. They go AFTER the questions: the Apps Script rewrites only
 * the header row and writes values by position, so a column inserted in the
 * middle would shift every existing row until it is synced again.
 */
export const MODE_HEADERS = ['Режим анкеты', 'Экспресс', 'Путь ответов'] as const

const MODE_SHEET_NAME: Readonly<Record<SurveyMode, string>> = { full: 'Полная анкета', express: 'Экспресс + блоки', chat: 'Беседа с ИИ' }
const VIA_SHEET_NAME: Readonly<Record<AnswerVia, string>> = {
  full: 'полная', express: 'экспресс', chat: 'беседа', helper: 'помощник', document: 'документы', staff: 'эксперт', system: 'система',
}

/** «полная 40 · экспресс 20 · беседа 5 · без отметки 16» — how the answers were given. */
export function answerPathSummary(rows: ReadonlyArray<SurveyExportRow>): string {
  const counts = new Map<string, number>()
  let unmarked = 0
  for (const r of rows) {
    const via = r.updated_via
    if (via && (ANSWER_VIA as readonly string[]).includes(via)) counts.set(via, (counts.get(via) ?? 0) + 1)
    else unmarked++
  }
  const parts = ANSWER_VIA.filter((v) => counts.get(v)).map((v) => `${VIA_SHEET_NAME[v]} ${counts.get(v)}`)
  if (unmarked && parts.length) parts.push(`без отметки ${unmarked}`)
  return parts.join(' · ')
}

/** The three survey Ф5 cells: mode (since when), express, answer paths. */
export function buildModeCells(rows: ReadonlyArray<SurveyExportRow>, status: SurveyStaffStatus | null | undefined): string[] {
  const since = formatAttributionDate(status?.modeSince)
  const mode = status?.mode ? `${MODE_SHEET_NAME[status.mode]}${since ? ` с ${since}` : ''}` : ''
  const e = status?.express
  const details = e ? expressDetails(e) : null
  const express = e ? `пройден ${formatAttributionDate(e.completedAt) ?? ''}${details ? ` · ${details.toLowerCase()}` : ''}`.trim() : ''
  return [mode, express, answerPathSummary(rows)]
}

/** Sheet header (row 1) — identity columns + «Шаг N · Вопрос» for every wizard key + the mode columns. */
export function buildSurveySheetHeaders(): string[] {
  return [
    ...IDENTITY_HEADERS,
    ...SURVEY_EXPORT_KEYS.map((k) => {
      const step = SURVEY_KEY_STEP[k]
      return `Шаг ${step} · ${SURVEY_STEP_LABELS[step] ?? ''} · ${SURVEY_LABELS[k] || k}`
    }),
    ...MODE_HEADERS,
  ]
}

/** One row per user, same column order as `buildSurveySheetHeaders()`. */
export function buildSurveySheetRow(rows: ReadonlyArray<SurveyExportRow>, meta: SurveyExportMeta): string[] {
  const answers = answersFromRows(rows)
  const summary = buildSurveySummary(rows, meta)
  const updated = (meta.updatedAt ?? new Date()).toISOString().replace('T', ' ').slice(0, 19)
  const identity = [
    meta.userId,
    updated,
    summary.email,
    summary.company,
    summary.contact,
    summary.phone,
    summary.industry,
    `${summary.completedSteps}/${summary.totalSteps}`,
  ]
  const cells = SURVEY_EXPORT_KEYS.map((k) => {
    if (!(k in answers)) return ''
    // A file answer: a link to the portal's access-checked route, never to Storage.
    const file = isSurveyFileKey(k) ? surveyFileRef(answers[k]) : null
    if (file) return `${fileRefName(file)} — ${absoluteFileHref(file, getSiteUrl())}`
    const v = formatSurveyValue(k, answers[k])
    return v === '—' ? '' : v
  })
  return [...identity, ...cells, ...buildModeCells(rows, meta.status)].map(asSheetText)
}

export interface SurveySheetSyncResult {
  ok: boolean
  skipped?: 'not_configured'
  url: string | null
  error?: string
}

/** Mirror the user's answers into the configured Google Sheet (best-effort). */
export async function syncSurveyToGoogleSheet(
  rows: ReadonlyArray<SurveyExportRow>,
  meta: SurveyExportMeta,
): Promise<SurveySheetSyncResult> {
  if (!googleSheetsConfigured()) return { ok: false, skipped: 'not_configured', url: null }
  const result = await upsertRowByKey(buildSurveySheetHeaders(), buildSurveySheetRow(rows, meta))
  return { ok: result.ok, url: result.url ?? spreadsheetUrl(), error: result.error }
}
