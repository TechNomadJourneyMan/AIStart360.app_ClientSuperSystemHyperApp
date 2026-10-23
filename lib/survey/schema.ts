/**
 * lib/survey/schema.ts — shape and size limits of POST /api/v1/onboarding/survey.
 *
 * The route used to accept any object: arbitrary key names, unbounded values.
 * Key *ownership* (which keys a client may write) stays in lib/survey/steps.ts
 * (`isWritableSurveyKey`); this file only guards shape and size.
 */
import { z } from 'zod'
import { isMarkedAnswer } from './answer-value'
import { BODY_ANSWER_VIA } from './attribution'

export const SURVEY_MAX_ANSWERS = 400
const MAX_VALUE_BYTES = 64 * 1024
const KEY_RE = /^[a-z][a-z0-9_]{1,79}$/

// `{ value }`, or a mark (lib/survey/answer-value.ts): «не знаю»
// `{ value: null, unknown: true }`, «примерно» `{ value, approx: true, range: [min, max] }`.
const answerEnvelope = z
  .object({
    value: z.unknown(),
    unknown: z.literal(true).optional(),
    approx: z.literal(true).optional(),
    range: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  })
  .strict()
  .refine((a) => {
    if (a.unknown) return a.value === null && !a.approx && a.range === undefined
    if (a.approx) {
      if (!a.range || typeof a.value !== 'number' || !Number.isFinite(a.value)) return false
      const [min, max] = a.range
      return min <= max && a.value >= min && a.value <= max
    }
    // A mark nested in { value } would be stored as an answer object nobody reads.
    return a.range === undefined && !isMarkedAnswer(a.value)
  }, 'inconsistent «не знаю» / «примерно» answer')
  .refine((a) => {
    try {
      return JSON.stringify(a.value ?? null).length <= MAX_VALUE_BYTES
    } catch {
      return false
    }
  }, 'answer is too large')

export const surveySaveBodySchema = z
  .object({
    user_id: z.string().max(64).nullish(),
    // Accepted for backwards compatibility; the server resolves the company itself.
    company_id: z.string().max(64).nullish(),
    step: z.number().int().min(1).max(12),
    answers: z
      .record(z.string().regex(KEY_RE, 'invalid question key'), answerEnvelope)
      .refine((a) => Object.keys(a).length <= SURVEY_MAX_ANSWERS, 'too many answers'),
    /** Background save while typing: no Sheets mirror, never announces completion. */
    autosave: z.boolean().optional().default(false),
    /** The user pressed «Отправить анкету». */
    final: z.boolean().optional().default(false),
    /**
     * How the owner is filling in (survey_answers.updated_via, migration 134):
     * the full questionnaire and «Мои ответы» → 'full' (default), the express
     * flow and blocks → 'express', a value from the field «Помощник» → 'helper'.
     * 'chat' and 'staff' are never accepted from the browser.
     */
    via: z.enum(BODY_ANSWER_VIA).optional(),
    /**
     * Keys whose value the owner accepted from a document suggestion (answer
     * attributed to «ИИ (из документов)») or confirmed in the field «Помощник»
     * ('chat' → path 'helper'); lib/survey/attribution.ts.
     */
    origins: z
      .record(z.string().regex(KEY_RE, 'invalid question key'), z.enum(['document', 'chat']))
      .refine((o) => Object.keys(o).length <= SURVEY_MAX_ANSWERS, 'too many origins')
      .optional(),
  })
  .refine((b) => !(b.autosave && b.final), 'autosave cannot be final')

export type SurveySaveBody = z.infer<typeof surveySaveBodySchema>

export function parseSurveySaveBody(
  body: unknown,
): { ok: true; data: SurveySaveBody } | { ok: false; error: string } {
  const r = surveySaveBodySchema.safeParse(body)
  if (r.success) return { ok: true, data: r.data }
  const issue = r.error.issues[0]
  return { ok: false, error: `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}` }
}
