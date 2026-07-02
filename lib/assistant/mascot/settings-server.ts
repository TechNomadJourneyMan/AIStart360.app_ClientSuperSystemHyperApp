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
  type HintFrequency,
  type MascotBehaviorSettings,
  type MascotCorner,
  type MascotSettings,
} from './types'

const FREQUENCIES: HintFrequency[] = ['normal', 'rare', 'off']
const CORNERS: MascotCorner[] = ['br', 'bl', 'tr', 'tl']

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

/** A settings patch; `behavior` may itself be partial (merged per-key). */
export type MascotSettingsPatch = Partial<Omit<MascotSettings, 'behavior'>> & {
  behavior?: Partial<MascotBehaviorSettings>
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
  // behavior merges per-key (a {behavior:{walking:false}} patch must not reset
  // the user's other behavior switches to defaults).
  const merged: MascotSettings = normalizeMascotSettings({
    ...current,
    ...patch,
    behavior: { ...current.behavior, ...(patch.behavior ?? {}) },
  })

  const { error } = await sb
    .from('profiles')
    .update({ preferences: { ...prefs, assistant: merged } })
    .eq('id', userId)

  if (error) throw error
  return merged
}
