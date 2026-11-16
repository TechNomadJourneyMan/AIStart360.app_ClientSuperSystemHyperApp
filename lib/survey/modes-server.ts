/**
 * lib/survey/modes-server.ts — the survey modes of the platform, read on the
 * server from the GIGA settings (R4-B4, R-027): `survey_modes` (express on/off,
 * the mode offered first to a new client) and `survey_chat_enabled` (the chat =
 * the AI helper of the questionnaire). Replaces the build flag
 * NEXT_PUBLIC_SURVEY_MODES: a change in GIGA works within seconds (the settings
 * snapshot lives 5 s), no rebuild.
 *
 * Fail-safe: a settings read that fails resolves to the registry defaults
 * (full + express + chat, express first) — the same as a missing row.
 *
 * Readers: app/client/onboarding/layout.tsx (→ SurveyModesContext), the server
 * pages of the modes (express, chat, snapshot, blocks — surveyModeOffRedirect),
 * /dashboard (the free next step), the Free notices (lib/notifications/product.ts,
 * lib/survey/completion-notice.ts) and the GIGA funnel of the modes.
 */
import { DEFAULT_SURVEY_MODES_CONFIG, resolveSurveyModes, type SurveyModesConfig } from './modes'

export async function getSurveyModes(): Promise<SurveyModesConfig> {
  try {
    const { getSetting } = await import('@/lib/settings/store')
    const [modes, chat] = await Promise.all([getSetting('survey_modes'), getSetting('survey_chat_enabled')])
    return resolveSurveyModes(modes, chat !== false)
  } catch {
    return { ...DEFAULT_SURVEY_MODES_CONFIG, enabled: [...DEFAULT_SURVEY_MODES_CONFIG.enabled] }
  }
}

/**
 * «Снимок бизнеса» is a screen of «Экспресс + блоки»: a Free notice may lead
 * there only while the express mode is on (otherwise the page sends the client
 * back to the full questionnaire).
 */
export async function freeSnapshotAvailable(): Promise<boolean> {
  return (await getSurveyModes()).enabled.includes('express')
}
