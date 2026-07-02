/**
 * lib/assistant/mascot/types.ts — shared client/server types for the mascot
 * assistant «Гри» (docs/TZ-mascot-assistant.md §4, §16, §17).
 *
 * Types + pure constants only — import-safe from both route handlers and
 * client components.
 */

// ─── Mascot finite states (ТЗ §4.2) ─────────────────────────────────────────

export type MascotState =
  | 'idle'
  | 'greeting'
  | 'hint'
  | 'question'
  | 'insight'
  | 'loading'
  | 'error'
  | 'minimized'
  | 'hidden'

// ─── Per-user settings (profiles.preferences.assistant) ─────────────────────

export type HintFrequency = 'normal' | 'rare' | 'off'
export type MascotCorner = 'br' | 'bl' | 'tr' | 'tl'
export type HidePeriod = 'session' | '24h' | '7d' | 'forever'

/** Idle-life visual overlays (ТЗ v1.1 «живой кот»): rendered by MascotAvatar
 *  on top of the functional pose while the mascot has nothing to say. */
export type MascotBehaviorVisual = 'walk' | 'sleep' | 'rub' | null

/** Advanced behavior switches (Settings › Ассистент › Поведение). */
export interface MascotBehaviorSettings {
  /** Occasional strolls along the bottom edge (desktop only). */
  walking: boolean
  /** Falls asleep after ~2 min without user activity. */
  sleep: boolean
  /** AI-generated insights via OpenRouter (auto once per session + menu). */
  aiInsights: boolean
}

export interface MascotSettings {
  /** Master switch; false = «скрыть навсегда» until re-enabled in settings. */
  mascotEnabled: boolean
  /** ISO timestamp until which the mascot stays hidden (24h/7d hide), or null. */
  hiddenUntil: string | null
  hintFrequency: HintFrequency
  /** Preferred corner (drag is v1.1; only 'br' is produced by the MVP UI). */
  position: { corner: MascotCorner } | null
  /** Hint TYPES the user opted out of («не показывать такие советы»). */
  dismissedHints: string[]
  /** One-time greeting shown (scenario 1) — never repeats once true. */
  greeted: boolean
  behavior: MascotBehaviorSettings
}

export const DEFAULT_MASCOT_BEHAVIOR: MascotBehaviorSettings = {
  walking: true,
  sleep: true,
  aiInsights: true,
}

export const DEFAULT_MASCOT_SETTINGS: MascotSettings = {
  mascotEnabled: true,
  hiddenUntil: null,
  hintFrequency: 'normal',
  position: null,
  dismissedHints: [],
  greeted: false,
  behavior: DEFAULT_MASCOT_BEHAVIOR,
}

/** True when the mascot must not render at all (master switch or timed hide). */
export function isMascotHidden(s: MascotSettings, now: number): boolean {
  if (!s.mascotEnabled) return true
  if (s.hiddenUntil) {
    const t = Date.parse(s.hiddenUntil)
    if (Number.isFinite(t) && t > now) return true
  }
  return false
}

// ─── Hint candidates (GET /api/v1/assistant/context → trigger engine) ───────

/**
 * A server- or client-computed hint candidate. The SERVER sends only
 * {id, priority, params}; texts/actions live in the client catalog
 * (lib/assistant/mascot/hints.ts) so no copy ships twice.
 */
export interface HintCandidate {
  id: string
  /** 1 = highest (errors/incomplete) … 5 = lowest (motivation), per ТЗ §9. */
  priority: number
  params?: Record<string, string | number | null>
}

// ─── GET /api/v1/assistant/context payload ──────────────────────────────────

export interface AssistantContextPayload {
  ok: true
  progress: {
    completionPct: number
    completedSections: number
    totalSections: number
    status: string
    /** First unfinished survey section (by step order), for CTA copy. */
    nextSection: { label: string; step: number } | null
  }
  results: {
    hasDiagnostic: boolean
    griIndex: number | null
    topLimit: string | null
    realismLevel: string | null
  }
  hints: HintCandidate[]
  settings: MascotSettings
}
