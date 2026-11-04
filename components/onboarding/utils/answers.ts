/**
 * Survey fields retired from the client questionnaire.
 *
 * Existing rows may still be present in Supabase or an older localStorage
 * draft, so the UI strips them while hydrating and before saving.
 */
export const RETIRED_SURVEY_KEYS = new Set([
  's1_business_model',
  's6_expectations',
])

function unwrapAnswer(value: unknown): unknown {
  let current = value

  // Supabase survey answers historically used one or more `{ value }`
  // wrappers. Accept both wrapped and already-flat API responses.
  while (
    typeof current === 'object'
    && current !== null
    && !Array.isArray(current)
    && Object.prototype.hasOwnProperty.call(current, 'value')
  ) {
    current = (current as Record<string, unknown>).value
  }

  return current
}

export function normalizeSurveyAnswers(
  answers: unknown,
): Record<string, unknown> {
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
    return {}
  }

  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(answers)) {
    if (RETIRED_SURVEY_KEYS.has(key)) continue
    normalized[key] = unwrapAnswer(value)
  }
  return normalized
}

export function mergeSurveyAnswerSources(
  serverAnswers: unknown,
  localAnswers: unknown,
): Record<string, unknown> {
  return {
    ...normalizeSurveyAnswers(serverAnswers),
    ...normalizeSurveyAnswers(localAnswers),
  }
}
