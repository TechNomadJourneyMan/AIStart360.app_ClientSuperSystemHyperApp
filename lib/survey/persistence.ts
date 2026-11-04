import type { SupabaseClient } from '@supabase/supabase-js'
import {
  syncSurveyAnswersToGoogleSheet,
  type SurveySheetSyncResult,
} from '@/lib/google-sheets/survey-sync'

const MAX_ANSWERS_PER_REQUEST = 250
const MAX_QUESTION_KEY_LENGTH = 160

export interface SurveyAnswerEnvelope {
  value: unknown
}

export interface SaveSurveyInput {
  userId: string
  companyId: string | null
  step: number
  answers: Record<string, SurveyAnswerEnvelope>
}

export type SaveSurveyResult =
  | {
      ok: true
      saved: number
      sheetSync:
        | SurveySheetSyncResult
        | { status: 'failed'; reason: 'sync_error' }
    }
  | { ok: false; error: unknown }

export function parseSurveyAnswers(
  value: unknown,
): Record<string, SurveyAnswerEnvelope> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
  if (entries.length === 0 || entries.length > MAX_ANSWERS_PER_REQUEST) return null

  const parsed: Record<string, SurveyAnswerEnvelope> = {}
  for (const [questionKey, answer] of entries) {
    if (
      !questionKey.trim() ||
      questionKey.length > MAX_QUESTION_KEY_LENGTH ||
      !answer ||
      typeof answer !== 'object' ||
      Array.isArray(answer) ||
      !Object.prototype.hasOwnProperty.call(answer, 'value')
    ) {
      return null
    }
    parsed[questionKey] = answer as SurveyAnswerEnvelope
  }
  return parsed
}

export function isValidSurveyStep(step: unknown): step is number {
  return Number.isInteger(step) && Number(step) >= 0 && Number(step) <= 12
}

export function surveyStepForQuestionKey(
  questionKey: string,
  fallbackStep: number,
): number {
  const match = /^s(\d+)[a-z]*_/.exec(questionKey)
  if (!match) return fallbackStep

  const inferred = Number(match[1])
  return isValidSurveyStep(inferred) ? inferred : fallbackStep
}

export function unwrapStoredSurveyAnswer(answer: unknown): unknown {
  if (
    answer &&
    typeof answer === 'object' &&
    !Array.isArray(answer) &&
    Object.prototype.hasOwnProperty.call(answer, 'value')
  ) {
    return (answer as SurveyAnswerEnvelope).value
  }
  // Tolerate legacy/imported rows that stored a bare JSON value.
  return answer
}

export async function saveSurveyAnswers(
  sb: SupabaseClient,
  input: SaveSurveyInput,
): Promise<SaveSurveyResult> {
  const answeredAt = new Date().toISOString()
  const rows = Object.entries(input.answers).map(([questionKey, answer]) => ({
    user_id: input.userId,
    company_id: input.companyId,
    step: surveyStepForQuestionKey(questionKey, input.step),
    question_key: questionKey,
    answer,
    answered_at: answeredAt,
  }))

  const { error } = await sb
    .from('survey_answers')
    .upsert(rows, { onConflict: 'user_id,question_key' })

  if (error) return { ok: false, error }

  try {
    const sheetSync = await syncSurveyAnswersToGoogleSheet(
      rows.map((row) => ({
        userId: row.user_id,
        companyId: row.company_id,
        step: row.step,
        questionKey: row.question_key,
        answer: row.answer,
        answeredAt: row.answered_at,
      })),
    )
    return { ok: true, saved: rows.length, sheetSync }
  } catch (error) {
    // Supabase is authoritative. A secondary projection failure must never make
    // the client retry and overwrite/duplicate an already-successful DB save.
    console.error(
      '[survey] Google Sheets sync failed after DB save',
      error instanceof Error ? error.message : 'unknown error',
    )
    return {
      ok: true,
      saved: rows.length,
      sheetSync: { status: 'failed', reason: 'sync_error' },
    }
  }
}
