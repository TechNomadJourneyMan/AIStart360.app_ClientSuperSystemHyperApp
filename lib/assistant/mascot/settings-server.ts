/**
 * lib/assistant/mascot/settings-server.ts — read/write mascot settings.
 *
 * Storage: profiles.preferences.assistant (the migration-035 «single JSONB
 * bag» convention — deliberately NOT a new table). All reads/writes go through
 * the caller's session-scoped Supabase client so RLS keeps them to the
 * caller's own profile row; user identity always comes from the session
 * (IDOR-safe), never from a request param.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DEFAULT_MASCOT_BEHAVIOR,
  DEFAULT_MASCOT_SETTINGS,
  DEFAULT_TOUR_GUIDE,
  type HintFrequency,
  type MascotBehaviorSettings,
  type MascotCorner,
  type MascotSettings,
  type TourGuideState,
  type TourGuideStatus,
} from './types'

const FREQUENCIES: HintFrequency[] = ['normal', 'rare', 'off']
const CORNERS: MascotCorner[] = ['br', 'bl', 'tr', 'tl']
const TOUR_GUIDE_STATUSES: TourGuideStatus[] = ['pending', 'active', 'done', 'dismissed']

/** Coerce an unknown value into a valid TourGuideState (stepIdx clamped 0..50 int). */
function normalizeTourGuide(raw: unknown): TourGuideState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_TOUR_GUIDE }
  const o = raw as Record<string, unknown>
  const status = TOUR_GUIDE_STATUSES.includes(o.status as TourGuideStatus)
    ? (o.status as TourGuideStatus)
    : DEFAULT_TOUR_GUIDE.status
  const rawIdx = typeof o.stepIdx === 'number' && Number.isFinite(o.stepIdx) ? o.stepIdx : 0
  const stepIdx = Math.min(50, Math.max(0, Math.trunc(rawIdx)))
  return { status, stepIdx }
}

/** Coerce an unknown preferences.assistant value into a valid MascotSettings. */
export function normalizeMascotSettings(raw: unknown): MascotSettings {
  const d = DEFAULT_MASCOT_SETTINGS
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...d }
  const o = raw as Record<string, unknown>

  const hiddenUntil =
    typeof o.hiddenUntil === 'string' && Number.isFinite(Date.parse(o.hiddenUntil))
      ? o.hiddenUntil
      : null

  const corner =
    o.position && typeof o.position === 'object'
      ? (o.position as Record<string, unknown>).corner
      : null

  const rawBehavior =
    o.behavior && typeof o.behavior === 'object' && !Array.isArray(o.behavior)
      ? (o.behavior as Record<string, unknown>)
      : {}
  const behavior: MascotBehaviorSettings = {
    walking:
      typeof rawBehavior.walking === 'boolean'
        ? rawBehavior.walking
        : DEFAULT_MASCOT_BEHAVIOR.walking,
    sleep:
      typeof rawBehavior.sleep === 'boolean' ? rawBehavior.sleep : DEFAULT_MASCOT_BEHAVIOR.sleep,
    aiInsights:
      typeof rawBehavior.aiInsights === 'boolean'
        ? rawBehavior.aiInsights
        : DEFAULT_MASCOT_BEHAVIOR.aiInsights,
  }

  const CHARACTERS = ['cat', 'dog', 'capybara', 'owl'] as const
  const character = CHARACTERS.includes(o.character as (typeof CHARACTERS)[number])
    ? (o.character as MascotSettings['character'])
    : d.character

  const COLORS = ['ginger', 'graphite', 'snow', 'cocoa'] as const
  const color = COLORS.includes(o.color as (typeof COLORS)[number])
    ? (o.color as MascotSettings['color'])
    : d.color

  return {
    mascotEnabled: typeof o.mascotEnabled === 'boolean' ? o.mascotEnabled : d.mascotEnabled,
    hiddenUntil,
    hintFrequency: FREQUENCIES.includes(o.hintFrequency as HintFrequency)
      ? (o.hintFrequency as HintFrequency)
      : d.hintFrequency,
    position: CORNERS.includes(corner as MascotCorner)
      ? { corner: corner as MascotCorner }
      : null,
    dismissedHints: Array.isArray(o.dismissedHints)
      ? o.dismissedHints.filter((x): x is string => typeof x === 'string').slice(0, 50)
      : [],
    greeted: o.greeted === true,
    behavior,
    character,
    color,
    tutorialDone: o.tutorialDone === true,
    toursDone: Array.isArray(o.toursDone)
      ? o.toursDone.filter((x): x is string => typeof x === 'string').slice(0, 50)
      : [],
    tourGuide: normalizeTourGuide(o.tourGuide),
  }
}

/** Read the caller's mascot settings (defaults when the bag is empty). */
export async function readMascotSettings(
  sb: SupabaseClient,
  userId: string,
): Promise<MascotSettings> {
  const { data } = await sb
    .from('profiles')
    .select('preferences')
    .eq('id', userId)
    .maybeSingle()

  const prefs = (data?.preferences ?? {}) as Record<string, unknown>
  return normalizeMascotSettings(prefs.assistant)
}

/** A settings patch; `behavior` and `tourGuide` may be partial (merged per-key). */
export type MascotSettingsPatch = Partial<Omit<MascotSettings, 'behavior' | 'tourGuide'>> & {
  behavior?: Partial<MascotBehaviorSettings>
  tourGuide?: Partial<TourGuideState>
}

/**
 * Merge `patch` into profiles.preferences.assistant and return the result.
 * Read-merge-write like /api/v1/settings/preferences: sibling preference
 * namespaces (appearance, notifications, socials) are preserved untouched.
 */
export async function writeMascotSettings(
  sb: SupabaseClient,
  userId: string,
  patch: MascotSettingsPatch,
): Promise<MascotSettings> {
  const { data } = await sb
    .from('profiles')
    .select('preferences')
    .eq('id', userId)
    .maybeSingle()

  const prefs = (data?.preferences ?? {}) as Record<string, unknown>
  const current = normalizeMascotSettings(prefs.assistant)
  // behavior/tourGuide merge per-key (a {behavior:{walking:false}} or
  // {tourGuide:{stepIdx:3}} patch must not reset the object's other keys) —
  // Батч B шлёт {tourGuide:{stepIdx}} на каждом шаге экскурсии.
  const merged: MascotSettings = normalizeMascotSettings({
    ...current,
    ...patch,
    behavior: { ...current.behavior, ...(patch.behavior ?? {}) },
    tourGuide: { ...current.tourGuide, ...(patch.tourGuide ?? {}) },
  })

  const { data: updated, error } = await sb
    .from('profiles')
    .update({ preferences: { ...prefs, assistant: merged } })
    .eq('id', userId)
    .select('id')

  if (error) throw error
  if (!updated || updated.length === 0) {
    // RLS silently dropped the UPDATE — surfacing it beats "tours forever".
    throw new Error(`mascot settings update affected 0 rows for user ${userId}`)
  }
  return merged
}
