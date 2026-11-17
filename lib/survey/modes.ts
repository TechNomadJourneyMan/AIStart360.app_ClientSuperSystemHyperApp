/**
 * lib/survey/modes.ts — the three ways to fill in the questionnaire (spec
 * 2026-10-23 §5.2; PO answers §18.3):
 *   full     «Расширенная полная анкета» — the 12 steps; THE questionnaire:
 *            «Анкета заполнена» (QUESTIONNAIRE_COMPLETED, bot reminders,
 *            waiting room) stays tied to submitting it;
 *   express  «Экспресс + блоки» (phase Ф2);
 *   chat     «Диагностическая беседа с ИИ» (phase Ф4).
 * Which modes a client may pick is a GIGA setting since R4-B4 (R-027), not the
 * build flag NEXT_PUBLIC_SURVEY_MODES any more: `survey_modes` in
 * lib/settings/registry.ts (express on/off + the mode offered first to a new
 * client) plus the existing `survey_chat_enabled` for the chat (the AI helper —
 * not duplicated). The server reads them (lib/survey/modes-server.ts) and hands
 * the result to the client screens (app/client/onboarding/layout.tsx →
 * SurveyModesContext); nothing here reads the environment. While only one mode is
 * available nobody sees the chooser — a choice of one would be an extra click.
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

/**
 * A comma list of modes (the format of the former build flag) → the modes
 * switched on, «full» always included. Kept for tests and old notes; the
 * running app decides by the GIGA setting (resolveSurveyModes).
 */
export function availableSurveyModes(raw?: string | null): SurveyMode[] {
  const on = new Set<SurveyMode>(['full'])
  for (const part of (raw ?? '').split(',')) {
    const m = part.trim()
    if (isSurveyMode(m)) on.add(m)
  }
  return SURVEY_MODE_ORDER.filter((m) => on.has(m))
}

/**
 * Modes whose screens exist. Ф1 builds the full questionnaire, Ф4 the chat
 * (/client/onboarding/chat), Ф2 the express flow + blocks (/client/onboarding/express).
 * A mode that is switched off or not built is not offered at all (no «Скоро»).
 */
export const SURVEY_MODES_BUILT: readonly SurveyMode[] = ['full', 'express', 'chat']

/** A comma list (the former flag format) → the modes a client can actually pick: switched on AND built. */
export function enabledSurveyModes(raw?: string | null, built: readonly SurveyMode[] = SURVEY_MODES_BUILT): SurveyMode[] {
  return availableSurveyModes(raw).filter((m) => built.includes(m))
}

// ─── The GIGA setting (R4-B4, R-027) ─────────────────────────────────────────

/**
 * The stored value of the setting `survey_modes` (lib/settings/registry.ts).
 * The full questionnaire is always on, so it has no switch; the chat is
 * `survey_chat_enabled` (the AI helper of the questionnaire).
 */
export interface SurveyModesSetting {
  /** «Экспресс + блоки» (with the «Снимок бизнеса» and the blocks). */
  express: boolean
  /** Offered first, marked «Рекомендуем», to a new client (no answers, no choice). */
  default_mode: SurveyMode
}

/** PO, Round 4: full + express on, express first for new clients. */
export const SURVEY_MODES_SETTING_DEFAULT: Readonly<SurveyModesSetting> = { express: true, default_mode: 'express' }

/** What the client screens get from the server. */
export interface SurveyModesConfig {
  /** Modes a client can pick, in SURVEY_MODE_ORDER; «full» always. */
  enabled: SurveyMode[]
  /** The mode a new client is offered first; always one of `enabled`. */
  defaultMode: SurveyMode
}

/** The default mode when the chosen one is off: express if on, else the full questionnaire. */
function fallbackDefault(enabled: readonly SurveyMode[], wanted: SurveyMode | undefined): SurveyMode {
  if (wanted && enabled.includes(wanted)) return wanted
  return enabled.includes('express') ? 'express' : 'full'
}

/**
 * The setting + the AI-helper switch → the modes of the client. A malformed or
 * missing value means the default (the registry already coerces, this is the
 * second fence for the browser-side default).
 */
export function resolveSurveyModes(
  setting: Partial<SurveyModesSetting> | null | undefined,
  chatEnabled: boolean,
  built: readonly SurveyMode[] = SURVEY_MODES_BUILT,
): SurveyModesConfig {
  const express = typeof setting?.express === 'boolean' ? setting.express : SURVEY_MODES_SETTING_DEFAULT.express
  const wanted = isSurveyMode(setting?.default_mode) ? setting.default_mode : SURVEY_MODES_SETTING_DEFAULT.default_mode
  const on = new Set<SurveyMode>(['full'])
  if (express) on.add('express')
  if (chatEnabled) on.add('chat')
  const enabled = SURVEY_MODE_ORDER.filter((m) => on.has(m) && (m === 'full' || built.includes(m)))
  return { enabled, defaultMode: fallbackDefault(enabled, wanted) }
}

/** The behaviour without a stored setting (and the context default in the browser). */
export const DEFAULT_SURVEY_MODES_CONFIG: Readonly<SurveyModesConfig> = resolveSurveyModes(SURVEY_MODES_SETTING_DEFAULT, true)

/**
 * `?off=<mode>` — the server page of a switched-off mode sent the client back
 * (surveyModeOffRedirect). The browser may still hold the older list (the
 * onboarding layout is not re-rendered on soft navigation), so that mode is
 * dropped from it: no loop «full → saved express → off → full».
 */
export function withoutSwitchedOff(config: SurveyModesConfig, off: string | null | undefined): SurveyModesConfig {
  if (!isSurveyMode(off) || off === 'full' || !config.enabled.includes(off)) return config
  const enabled = config.enabled.filter((m) => m !== off)
  return { enabled, defaultMode: fallbackDefault(enabled, config.defaultMode) }
}

/** The screens of each mode (the blocks and the snapshot belong to «Экспресс + блоки»). */
export type GatedSurveyMode = Exclude<SurveyMode, 'full'>

/**
 * The server page of a mode that is switched off → where to send the client:
 * the full questionnaire with `?off=<mode>` (a notice, not a 404 and not a loop).
 * null — the mode is on, render the page.
 */
export function surveyModeOffRedirect(mode: GatedSurveyMode, config: Pick<SurveyModesConfig, 'enabled'>): string | null {
  return config.enabled.includes(mode) ? null : `/client/onboarding?off=${mode}`
}

/**
 * The mode whose screens a cabinet link opens (R4 W3B-7): the express flow, the
 * snapshot and the blocks belong to «Экспресс + блоки», the chat page to the
 * chat; anything else (the full questionnaire, «Мои ответы») — null.
 */
export function surveyModeOfHref(href: string): GatedSurveyMode | null {
  const path = href.split(/[?#]/)[0].replace(/\/+$/, '')
  if (/^\/client\/onboarding\/(express|snapshot|blocks)(\/|$)/.test(path)) return 'express'
  if (/^\/client\/onboarding\/chat(\/|$)/.test(path)) return 'chat'
  return null
}

/** A link that does not lead into a mode switched off in GIGA. */
export function surveyHrefOpen(href: string, enabled: readonly SurveyMode[]): boolean {
  const mode = surveyModeOfHref(href)
  return mode === null || enabled.includes(mode)
}

/** The notice above the full questionnaire after such a redirect. */
export const SURVEY_MODE_OFF_NOTICE: Readonly<Record<GatedSurveyMode, string>> = {
  express: '«Экспресс + блоки» сейчас недоступен. Продолжите в полной анкете — ответы, которые вы уже дали, сохранены и уже в ней.',
  chat: 'Беседа с ИИ сейчас недоступна. Продолжите в полной анкете — всё, что вы записали в беседе, сохранено и уже в ней.',
}

/** The chooser's cards: the recommended mode first, then the rest in the usual order; only modes a client can pick. */
export function surveyModeCardOrder(enabled: readonly SurveyMode[], recommended: SurveyMode): SurveyMode[] {
  const rest = SURVEY_MODE_ORDER.filter((m) => m !== recommended && enabled.includes(m))
  return enabled.includes(recommended) ? [recommended, ...rest] : rest
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

/**
 * New clients → the default mode of the GIGA setting (express unless changed),
 * when it is available; anyone who already started → the full questionnaire.
 */
export function recommendedSurveyMode(answeredCount: number, available: readonly SurveyMode[], defaultMode?: SurveyMode): SurveyMode {
  if (answeredCount > 0) return 'full'
  return fallbackDefault(available, defaultMode)
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
 *  • a new client → the chooser, when there is something to choose from, with
 *    the default mode of the GIGA setting first and marked «Рекомендуем» (R4-B4:
 *    one click, the choice is the client's own — nothing is saved for him).
 */
export function resolveSurveyEntry(input: {
  preference: SurveyPreference
  answeredCount: number
  available: readonly SurveyMode[]
  explicitStep?: boolean
  /** SurveyModesConfig.defaultMode (express by default). */
  defaultMode?: SurveyMode
}): SurveyEntry {
  const { preference, answeredCount, available } = input
  const choice = available.length > 1
  const banner = choice && !preference.mode && !preference.banner_dismissed_at && answeredCount > 0
  if (input.explicitStep) return { screen: 'mode', mode: 'full', banner }
  if (preference.mode) return { screen: 'mode', mode: available.includes(preference.mode) ? preference.mode : 'full', banner: false }
  if (answeredCount > 0 || !choice) return { screen: 'mode', mode: 'full', banner }
  return { screen: 'chooser', recommended: recommendedSurveyMode(answeredCount, available, input.defaultMode) }
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
