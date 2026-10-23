/**
 * lib/survey/modes.ts — the three ways to fill in the questionnaire (spec
 * 2026-10-23 §5.2; PO answers §18.3):
 *   full     «Расширенная полная анкета» — the 12 steps; THE questionnaire:
 *            «Анкета заполнена» (QUESTIONNAIRE_COMPLETED, bot reminders,
 *            waiting room) stays tied to submitting it;
 *   express  «Экспресс + блоки» (phase Ф2);
 *   chat     «Диагностическая беседа с ИИ» (phase Ф4).
 * Modes that are not built yet are switched off by NEXT_PUBLIC_SURVEY_MODES
 * (comma list; default «full»): while only one mode is available nobody sees
 * the chooser — a choice of one would be an extra click.
 *
 * The choice lives in profiles.preferences.survey (PATCH /api/v1/settings/
 * preferences, deep merge) — no migration. Pure and browser-safe.
 */

export const SURVEY_MODES = ['full', 'express', 'chat'] as const
export type SurveyMode = (typeof SURVEY_MODES)[number]

export function isSurveyMode(v: unknown): v is SurveyMode {
  return typeof v === 'string' && (SURVEY_MODES as readonly string[]).includes(v)
}

export interface SurveyModeInfo {
  title: string
  /** Segment label in the switcher. */
  short: string
  subtitle: string
  /** Time estimate on the card. */
  time: string
  icon: string
  /** Where the mode lives. */
  href: string
}

export const SURVEY_MODE_INFO: Readonly<Record<SurveyMode, SurveyModeInfo>> = {
  full: {
    title: 'Расширенная полная анкета',
    short: 'Полная',
    subtitle: '12 разделов, все вопросы сразу. Можно частями — всё сохраняется. Это основная анкета: после неё эксперт получает полную картину',
    time: '~1,5 ч чистого ввода',
    icon: 'assignment',
    href: '/client/onboarding',
  },
  express: {
    title: 'Экспресс + блоки',
    short: 'Экспресс',
    subtitle: '15 коротких экранов → снимок бизнеса и первичная Точка А. Детали — блоками, когда удобно',
    time: '7–9 мин до первичной Точки А',
    icon: 'bolt',
    href: '/client/onboarding/express',
  },
  chat: {
    title: 'Диагностическая беседа с ИИ',
    short: 'Беседа',
    subtitle: 'Отвечайте своими словами. Помощник объяснит вопрос и подскажет, где взять цифру. В анкету — только то, что вы подтвердите',
    time: '10–15 мин до первичной Точки А',
    icon: 'forum',
    href: '/client/onboarding/chat',
  },
}

/** Order of the cards: the full questionnaire is the main one (PO §18.3 item 1). */
export const SURVEY_MODE_ORDER: readonly SurveyMode[] = ['full', 'express', 'chat']

/** Modes switched on (always includes «full»). */
export function availableSurveyModes(raw: string | null | undefined = process.env.NEXT_PUBLIC_SURVEY_MODES): SurveyMode[] {
  const on = new Set<SurveyMode>(['full'])
  for (const part of (raw ?? '').split(',')) {
    const m = part.trim()
    if (isSurveyMode(m)) on.add(m)
  }
  return SURVEY_MODE_ORDER.filter((m) => on.has(m))
}

/**
 * Modes whose screens exist. Ф1 builds the full questionnaire, Ф4 the chat
 * (/client/onboarding/chat); Ф2 adds 'express'. A mode switched on by the flag but not built yet is
 * shown on the chooser as «Скоро» and cannot be picked.
 */
export const SURVEY_MODES_BUILT: readonly SurveyMode[] = ['full', 'chat']

/** Modes a client can actually pick: switched on AND built. */
export function enabledSurveyModes(raw?: string | null, built: readonly SurveyMode[] = SURVEY_MODES_BUILT): SurveyMode[] {
  return availableSurveyModes(raw === undefined ? process.env.NEXT_PUBLIC_SURVEY_MODES : raw).filter((m) => built.includes(m))
}

export interface SurveyPreference {
  mode?: SurveyMode
  chosen_at?: string
  switched_at?: string
  /** The one-time «Новые способы заполнить» banner was closed. */
  banner_dismissed_at?: string
}

/** profiles.preferences → the survey part (anything malformed is dropped). */
export function readSurveyPreference(preferences: unknown): SurveyPreference {
  const raw = preferences && typeof preferences === 'object' ? (preferences as { survey?: unknown }).survey : null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  const out: SurveyPreference = {}
  if (isSurveyMode(r.mode)) out.mode = r.mode
  for (const k of ['chosen_at', 'switched_at', 'banner_dismissed_at'] as const) if (typeof r[k] === 'string') out[k] = r[k] as string
  return out
}

/** New clients → express (when available); anyone who already started → the full questionnaire. */
export function recommendedSurveyMode(answeredCount: number, available: readonly SurveyMode[]): SurveyMode {
  if (answeredCount > 0) return 'full'
  return available.includes('express') ? 'express' : 'full'
}

export type SurveyEntry =
  | { screen: 'chooser'; recommended: SurveyMode }
  | { screen: 'mode'; mode: SurveyMode; banner: boolean }

/**
 * What /client/onboarding opens (spec §5.2):
 *  • a deep link to a step (`?step=N` from the bot, emails, the cabinet) → the full questionnaire;
 *  • a saved choice → that mode (the full one when the mode is switched off);
 *  • a client who already started without a choice (all current clients) → the
 *    full questionnaire where they were, plus a one-time banner about the new modes;
 *  • a new client → the chooser, when there is something to choose from.
 */
export function resolveSurveyEntry(input: {
  preference: SurveyPreference
  answeredCount: number
  available: readonly SurveyMode[]
  explicitStep?: boolean
}): SurveyEntry {
  const { preference, answeredCount, available } = input
  const choice = available.length > 1
  const banner = choice && !preference.mode && !preference.banner_dismissed_at && answeredCount > 0
  if (input.explicitStep) return { screen: 'mode', mode: 'full', banner }
  if (preference.mode) return { screen: 'mode', mode: available.includes(preference.mode) ? preference.mode : 'full', banner: false }
  if (answeredCount > 0 || !choice) return { screen: 'mode', mode: 'full', banner }
  return { screen: 'chooser', recommended: recommendedSurveyMode(answeredCount, available) }
}

/** The PATCH body for /api/v1/settings/preferences when a mode is chosen or switched. */
export function surveyPreferencePatch(prev: SurveyPreference, mode: SurveyMode, now: Date = new Date()): { survey: SurveyPreference } {
  const at = now.toISOString()
  const survey: SurveyPreference = { mode, chosen_at: prev.chosen_at ?? at }
  if (prev.mode && prev.mode !== mode) survey.switched_at = at
  return { survey }
}

/** The PATCH body that closes the one-time banner. */
export function surveyBannerDismissPatch(now: Date = new Date()): { survey: SurveyPreference } {
  return { survey: { banner_dismissed_at: now.toISOString() } }
}

/** SURVEY_MODE_CHOSEN metadata (spec §15). */
export function modeChosenMetadata(prev: SurveyPreference, mode: SurveyMode, from: 'chooser' | 'switch'): { mode: SurveyMode; previous: SurveyMode | null; from: 'chooser' | 'switch' } {
  return { mode, previous: prev.mode ?? null, from }
}
