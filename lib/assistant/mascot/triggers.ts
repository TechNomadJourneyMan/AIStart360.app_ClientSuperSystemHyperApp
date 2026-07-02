/**
 * lib/assistant/mascot/triggers.ts — the anti-annoyance trigger engine (ТЗ §9).
 *
 * PURE functions only: given the current candidates, cooldown state and user
 * settings, decide which single hint (if any) may be shown now, and produce the
 * next cooldown state after a show/close. All timing constants live in RULES so
 * tests and future tuning have one knob panel.
 *
 * Hard UI blocks (open modal, focused input, scrolling, on-screen keyboard) are
 * the CALLER's job — this module never touches the DOM.
 */

import { screenAllowed, type ResolvedHint } from './hints'
import type { MascotSettings } from './types'

// ─── Tunables (ТЗ §9 cooldown table) ─────────────────────────────────────────

export const RULES = {
  /** Pause between ANY two proactive bubbles. */
  globalGapMs: 90_000,
  /** One bubble per screen per this window. */
  perScreenGapMs: 3 * 60_000,
  /** The same hint id repeats no more than once per 24 h. */
  perHintGapMs: 24 * 60 * 60_000,
  /** A hint closed with «×» stays away for 7 days. */
  closedGapMs: 7 * 24 * 60 * 60_000,
  /** Proactive bubbles per session. */
  sessionMax: 8,
  /** hintFrequency==='rare': gaps ×3, session cap ↓. */
  rareGapMultiplier: 3,
  rareSessionMax: 3,
  /** Greeting waits this long after the screen settles (ТЗ §9). */
  greetingDelayMs: 5_000,
  /** Idle thresholds (scenario 3). */
  idleMsDesktop: 60_000,
  idleMsMobile: 45_000,
} as const

// ─── Cooldown state (persisted in the zustand store) ────────────────────────

export interface CooldownState {
  /** ts of the last proactive bubble (any id, any screen). */
  lastGlobalAt: number
  /** hint id → last shown ts. */
  perHint: Record<string, number>
  /** screen → last bubble ts. */
  perScreen: Record<string, number>
  /** hint id → ts of an explicit «×» close (7-day mute). */
  closed: Record<string, number>
}

export const EMPTY_COOLDOWNS: CooldownState = {
  lastGlobalAt: 0,
  perHint: {},
  perScreen: {},
  closed: {},
}

// ─── pick ────────────────────────────────────────────────────────────────────

export interface PickInput {
  now: number
  /** Normalized screen (hints.normalizeScreen). */
  screen: string
  /** Already-resolved candidates (server + local), any order. */
  candidates: ResolvedHint[]
  cooldowns: CooldownState
  settings: Pick<MascotSettings, 'hintFrequency' | 'dismissedHints' | 'greeted'>
  /** Proactive bubbles already shown this session. */
  sessionShownCount: number
}

/**
 * Choose the single hint allowed to show now, or null. Applies, in order:
 * frequency switch → per-candidate eligibility (screen, muted type, greeting
 * once-ever, 24h repeat, 7d closed) → session cap → per-screen gap → global
 * gap → priority sort (greeting 0 wins; ties keep candidate order).
 */
export function pickHint(input: PickInput): ResolvedHint | null {
  const { now, screen, candidates, cooldowns, settings, sessionShownCount } = input

  if (settings.hintFrequency === 'off') return null

  const rare = settings.hintFrequency === 'rare'
  const gapMul = rare ? RULES.rareGapMultiplier : 1
  const sessionMax = rare ? RULES.rareSessionMax : RULES.sessionMax

  if (sessionShownCount >= sessionMax) return null
  if (now - cooldowns.lastGlobalAt < RULES.globalGapMs * gapMul) return null
  const lastOnScreen = cooldowns.perScreen[screen] ?? 0
  if (now - lastOnScreen < RULES.perScreenGapMs * gapMul) return null

  const eligible = candidates.filter((c) => {
    if (!screenAllowed(c, screen)) return false
    if (settings.dismissedHints.includes(c.type)) return false
    if (c.id === 'greeting' && settings.greeted) return false
    const closedAt = cooldowns.closed[c.id] ?? 0
    if (now - closedAt < RULES.closedGapMs) return false
    const shownAt = cooldowns.perHint[c.id] ?? 0
    if (now - shownAt < RULES.perHintGapMs) return false
    return true
  })

  if (eligible.length === 0) return null
  // Stable: sort copies, lower priority number first.
  return [...eligible].sort((a, b) => a.priority - b.priority)[0] ?? null
}

// ─── State transitions ───────────────────────────────────────────────────────

/** Record that `hint` was shown on `screen` at `now`. */
export function registerShown(
  cooldowns: CooldownState,
  hintId: string,
  screen: string,
  now: number,
): CooldownState {
  return {
    ...cooldowns,
    lastGlobalAt: now,
    perHint: { ...cooldowns.perHint, [hintId]: now },
    perScreen: { ...cooldowns.perScreen, [screen]: now },
  }
}

/** Record an explicit «×» close (7-day mute for this id). */
export function registerClosed(
  cooldowns: CooldownState,
  hintId: string,
  now: number,
): CooldownState {
  return { ...cooldowns, closed: { ...cooldowns.closed, [hintId]: now } }
}

/**
 * Drop stale entries so the persisted blob never grows unbounded (called on
 * store rehydrate). Keeps anything still inside its longest relevant window.
 */
export function pruneCooldowns(cooldowns: CooldownState, now: number): CooldownState {
  const keep = (ts: number, windowMs: number) => now - ts < windowMs
  const prune = (rec: Record<string, number>, windowMs: number) =>
    Object.fromEntries(Object.entries(rec).filter(([, ts]) => keep(ts, windowMs)))
  return {
    lastGlobalAt: cooldowns.lastGlobalAt,
    perHint: prune(cooldowns.perHint, RULES.perHintGapMs),
    perScreen: prune(cooldowns.perScreen, RULES.perScreenGapMs),
    closed: prune(cooldowns.closed, RULES.closedGapMs),
  }
}
