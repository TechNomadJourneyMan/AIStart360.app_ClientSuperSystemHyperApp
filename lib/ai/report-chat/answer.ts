/**
 * lib/ai/report-chat/answer.ts — parse + harden the chat's structured answer.
 *
 * The model returns a structured answer (JSON schema in spec 01 §5). We validate
 * it and then DETERMINISTICALLY drop any used_sources citation whose ref was not
 * actually placed in context — the "ссылка на источник, которого нет" control.
 * Pure; the route calls parse → sanitize → validation pipeline.
 */

import { z } from 'zod'

const usedSourceSchema = z.object({
  type: z.string(),
  ref: z.string(),
  label: z.string(),
  quote: z.string().max(200).optional(),
})

export const reportChatAnswerSchema = z.object({
  can_answer: z.boolean(),
  answer: z.string().max(2200),
  confidence: z.enum(['low', 'medium', 'high']),
  used_sources: z.array(usedSourceSchema).max(8).default([]),
  assumptions: z.array(z.string()).max(3).optional(),
  needs_expert: z.boolean().default(false),
  suggested_next: z.array(z.string()).max(3).default([]),
})

export type ReportChatAnswer = z.infer<typeof reportChatAnswerSchema>

/** Validate the model's raw output; returns null on any schema violation. */
export function parseReportChatAnswer(raw: unknown, _providedSources: string[]): ReportChatAnswer | null {
  const parsed = reportChatAnswerSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Remove citations to sources that were never provided in the prompt context. */
export function sanitizeUsedSources(answer: ReportChatAnswer, providedSources: string[]): ReportChatAnswer {
  const allowed = new Set(providedSources)
  return {
    ...answer,
    used_sources: answer.used_sources.filter((s) => allowed.has(s.ref)),
  }
}
