/**
 * lib/admin/journey.ts — the customer journey (CJM) of one user, computed from
 * facts in the database (not from events), so it is right for users who came
 * before tracking existed. Same stage order as SQL admin_journey_stages().
 */

export const JOURNEY_STAGES = [
  { key: 'registered', label: 'Регистрация' },
  { key: 'approved', label: 'Доступ открыт' },
  { key: 'survey_started', label: 'Анкета начата' },
  { key: 'survey_completed', label: 'Анкета заполнена' },
  { key: 'point_a', label: 'Точка А' },
  { key: 'gri_started', label: 'GRI начат' },
  { key: 'gri_completed', label: 'GRI пройден' },
  { key: 'point_b', label: 'Точка Б' },
  { key: 'content', label: 'Обучение / материалы' },
] as const

export type JourneyStageKey = (typeof JOURNEY_STAGES)[number]['key']

export type JourneyFacts = Partial<Record<JourneyStageKey, string | null>>

export interface JourneyStage { key: JourneyStageKey; label: string; at: string | null; done: boolean }

export interface Journey {
  stages: JourneyStage[]
  current: JourneyStage | null
  previous: JourneyStage | null
  next: JourneyStage | null
  completed: number
  total: number
  /** Days since the last reached stage (null when nothing reached). */
  daysInStage: number | null
}

export function buildJourney(facts: JourneyFacts, now = Date.now()): Journey {
  const stages: JourneyStage[] = JOURNEY_STAGES.map((s) => ({ key: s.key, label: s.label, at: facts[s.key] ?? null, done: !!facts[s.key] }))
  let lastIdx = -1
  stages.forEach((s, i) => { if (s.done) lastIdx = i })
  const current = lastIdx >= 0 ? stages[lastIdx] : null
  const previous = lastIdx > 0 ? [...stages.slice(0, lastIdx)].reverse().find((s) => s.done) ?? null : null
  const next = stages.find((s, i) => i > lastIdx && !s.done) ?? stages.find((s) => !s.done) ?? null
  const at = current?.at ? new Date(current.at).getTime() : NaN
  return {
    stages,
    current,
    previous,
    next,
    completed: stages.filter((s) => s.done).length,
    total: stages.length,
    daysInStage: Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 86_400_000)) : null,
  }
}

export const JOURNEY_LABEL: Record<string, string> = Object.fromEntries(JOURNEY_STAGES.map((s) => [s.key, s.label]))
