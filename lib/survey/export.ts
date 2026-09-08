/**
 * lib/survey/export.ts — turns a user's survey rows into ONE spreadsheet row
 * (fixed identity columns + every wizard question, grouped by step) and pushes
 * it to Google Sheets. Also builds the short admin summary used by the Telegram
 * «анкета заполнена» notification.
 */

import { SURVEY_KEY_STEP, SURVEY_TOTAL_STEPS, surveyProgressFromRows, type SurveyStepRow } from '@/lib/survey/steps'
import { SURVEY_LABELS, SURVEY_STEP_LABELS, formatSurveyValue } from '@/lib/survey-labels'
import { upsertRowByKey, googleSheetsConfigured, spreadsheetUrl } from '@/lib/integrations/google-sheets'

export interface SurveyExportMeta {
  userId: string
  email?: string | null
  updatedAt?: Date
}

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

export function answersFromRows(rows: ReadonlyArray<SurveyStepRow>): Record<string, unknown> {
  const answers: Record<string, unknown> = {}
  for (const r of rows) {
    const a = r.answer
    answers[r.question_key] =
      a !== null && typeof a === 'object' && !Array.isArray(a) && 'value' in a ? (a as { value: unknown }).value : a
  }
  return answers
}

function text(answers: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = answers[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
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

/** Sheet header (row 1) — identity columns + «Шаг N · Вопрос» for every wizard key. */
export function buildSurveySheetHeaders(): string[] {
  return [
    ...IDENTITY_HEADERS,
    ...SURVEY_EXPORT_KEYS.map((k) => {
      const step = SURVEY_KEY_STEP[k]
      return `Шаг ${step} · ${SURVEY_STEP_LABELS[step] ?? ''} · ${SURVEY_LABELS[k] || k}`
    }),
  ]
}

/** One row per user, same column order as `buildSurveySheetHeaders()`. */
export function buildSurveySheetRow(rows: ReadonlyArray<SurveyStepRow>, meta: SurveyExportMeta): string[] {
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
    const v = formatSurveyValue(k, answers[k])
    return v === '—' ? '' : v
  })
  return [...identity, ...cells]
}

export interface SurveySheetSyncResult {
  ok: boolean
  skipped?: 'not_configured'
  url: string | null
  error?: string
}

/** Mirror the user's answers into the configured Google Sheet (best-effort). */
export async function syncSurveyToGoogleSheet(
  rows: ReadonlyArray<SurveyStepRow>,
  meta: SurveyExportMeta,
): Promise<SurveySheetSyncResult> {
  if (!googleSheetsConfigured()) return { ok: false, skipped: 'not_configured', url: null }
  const result = await upsertRowByKey(buildSurveySheetHeaders(), buildSurveySheetRow(rows, meta))
  return { ok: result.ok, url: result.url ?? spreadsheetUrl(), error: result.error }
}
