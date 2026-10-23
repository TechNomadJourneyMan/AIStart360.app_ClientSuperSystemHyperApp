/**
 * lib/survey/mode-switch.ts — switching the way of filling in the
 * questionnaire without losing anything (spec 2026-10-23 §5.1 invariant 4):
 *   1. unsaved edits are saved first — when that fails, we stay (the error is
 *      shown where the user is; the local draft still holds the edits);
 *   2. the choice is remembered (profiles.preferences.survey, PATCH);
 *   3. SURVEY_MODE_CHOSEN { mode, previous, from: 'switch' };
 *   4. the new mode opens and reads the answers from the server again.
 * Side effects are passed in: pure, tested without a browser.
 */
import { SURVEY_MODE_INFO, modeChosenMetadata, readSurveyPreference, surveyPreferencePatch, type SurveyMode, type SurveyPreference } from './modes'

export interface ModeSwitchDeps {
  /** Save unsaved edits of the current mode. */
  save: () => Promise<{ ok: boolean; error?: string }>
  /** PATCH /api/v1/settings/preferences (deep merge). */
  patchPreferences: (body: { survey: SurveyPreference }) => Promise<void>
  track: (name: 'SURVEY_MODE_CHOSEN', metadata: Record<string, unknown>) => void
  navigate: (href: string) => void
}

export async function switchSurveyMode(
  input: { to: SurveyMode; preference: SurveyPreference; now?: Date },
  deps: ModeSwitchDeps,
): Promise<{ ok: true; href: string } | { ok: false; error: string }> {
  const saved = await deps.save()
  if (!saved.ok) return { ok: false, error: saved.error ?? 'Не удалось сохранить ответы — режим не переключён, введённое сохранено на этом устройстве.' }
  deps.track('SURVEY_MODE_CHOSEN', modeChosenMetadata(input.preference, input.to, 'switch'))
  await deps.patchPreferences(surveyPreferencePatch(input.preference, input.to, input.now)).catch(() => undefined)
  const href = SURVEY_MODE_INFO[input.to].href
  deps.navigate(href)
  return { ok: true, href }
}

/** The browser PATCH of the survey preference (errors are swallowed: the switch still happens). */
export async function patchSurveyPreference(body: { survey: SurveyPreference }): Promise<void> {
  await fetch('/api/v1/settings/preferences', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined)
}

/** GET the saved survey preference (empty when unknown). */
export async function loadSurveyPreference(): Promise<SurveyPreference> {
  const json = await fetch('/api/v1/settings/preferences', { credentials: 'include' }).then((r) => r.json()).catch(() => null)
  return readSurveyPreference((json as { data?: unknown } | null)?.data)
}
