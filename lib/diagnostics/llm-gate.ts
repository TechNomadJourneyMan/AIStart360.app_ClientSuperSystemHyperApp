/**
 * lib/diagnostics/llm-gate.ts — may the MODEL stages of the diagnostic
 * pipeline («Гипотезы ИИ», «Рекомендации») call the model in this session?
 * (ревью R3-PA M3)
 *
 * The B2 fix made the automatic pipeline run after every written Point A
 * (questionnaire autosave → queue, nightly recalculation, a document) — with
 * two paid model stages, for a Free owner and for a preliminary assessment
 * too. An AUTOMATIC session (trigger event / schedule / agent) calls the model
 * only when:
 *   • the official Point A has a score (no paid analysis of a score that does
 *     not exist — R-033, the same rule as the client's AI analysis);
 *   • the owner's Точка А is open (the paid-section decision for the OWNER,
 *     lib/point-a/diagnostic-row.ts paidFanOutPaths — Free: no paid calls);
 *   • the stage has not called the model for this company within
 *     AUTO_LLM_MIN_INTERVAL_MS (the input-hash cache already skips equal
 *     evidence; this bounds a company whose data keep changing).
 * A MANUAL session (staff: GIGA / the admin bot «Запустить диагностику», or a
 * recalculation by staff — snapshot trigger 'expert') runs as before.
 * The deterministic part of every stage runs either way.
 */
export const AUTO_LLM_MIN_INTERVAL_MS = 6 * 60 * 60_000

export type LlmGateReason = 'no_score' | 'free' | 'interval'
export type LlmGateDecision = { allowed: true } | { allowed: false; reason: LlmGateReason }

export const LLM_GATE_TEXT: Record<LlmGateReason, string> = {
  no_score: 'у Точки А нет официальной оценки',
  free: 'Точка А владельца закрыта (бесплатный тариф)',
  interval: 'модель уже вызывалась для компании в последние 6 ч',
}

export function llmGateDecision(i: {
  trigger: string | null
  officialState: string | null
  ownerPaid: boolean
  lastModelRunAt: Date | null
  now: Date
}): LlmGateDecision {
  if (i.trigger === 'manual') return { allowed: true }
  if (i.officialState !== 'scored') return { allowed: false, reason: 'no_score' }
  if (!i.ownerPaid) return { allowed: false, reason: 'free' }
  if (i.lastModelRunAt && i.now.getTime() - i.lastModelRunAt.getTime() < AUTO_LLM_MIN_INTERVAL_MS) return { allowed: false, reason: 'interval' }
  return { allowed: true }
}
