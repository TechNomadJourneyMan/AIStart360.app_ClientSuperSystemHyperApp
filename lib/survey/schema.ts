/**
 * lib/survey/schema.ts — shape and size limits of POST /api/v1/onboarding/survey.
 *
 * The route used to accept any object: arbitrary key names, unbounded values.
 * Key *ownership* (which keys a client may write) stays in lib/survey/steps.ts
 * (`isWritableSurveyKey`); this file only guards shape and size.
 */
import { z } from 'zod'

export const SURVEY_MAX_ANSWERS = 400
const MAX_VALUE_BYTES = 64 * 1024
const KEY_RE = /^[a-z][a-z0-9_]{1,79}$/

const answerEnvelope = z
  .object({ value: z.unknown() })
  .strict()
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
