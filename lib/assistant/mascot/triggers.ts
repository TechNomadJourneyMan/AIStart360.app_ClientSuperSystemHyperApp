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
  /** Проблемные советы (type==='problem', Батч D): свой короткий global-кулдаун,
   *  чтобы срочный сигнал не тонул 90с за любым другим пузырём. */
  problemGlobalGapMs: 30_000,
  /** Первые N проблемных показов НЕ считаются в лимит сессии (потом — считаются). */
  problemSessionBudget: 2,
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
  /** Проблемные советы (type==='problem') уже показанные в этой сессии (Батч D). */
  problemShownCount?: number
}

/**
 * Choose the single hint allowed to show now, or null. Applies, in order:
 * frequency switch → per-candidate eligibility (screen, muted type, greeting
 * once-ever, 24h repeat, 7d closed) → priority sort → class-aware gates on the
 * WINNER: session cap (problem hints get a budget-based exemption), global gap
 * (shorter for problems), per-screen gap. Greeting (priority 0) wins ties;
 * ties otherwise keep candidate order.
 */
export function pickHint(input: PickInput): ResolvedHint | null {
  const { now, screen, candidates, cooldowns, settings, sessionShownCount } = input
  const problemShownCount = input.problemShownCount ?? 0

  if (settings.hintFrequency === 'off') return null

  const rare = settings.hintFrequency === 'rare'
  const gapMul = rare ? RULES.rareGapMultiplier : 1
  const sessionMax = rare ? RULES.rareSessionMax : RULES.sessionMax

  // Per-candidate eligibility first — the winner's CLASS decides the gates below.
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
  const winner = [...eligible].sort((a, b) => a.priority - b.priority)[0]
  if (!winner) return null
  const isProblem = winner.type === 'problem'

  // Session cap — problem hints are exempt for the first `problemSessionBudget`
  // shows, so a fresh alert isn't swallowed by an otherwise chatty session; once
  // the budget is spent they respect the cap like any other bubble.
  if (isProblem) {
    if (problemShownCount >= RULES.problemSessionBudget && sessionShownCount >= sessionMax) {
      return null
    }
  } else if (sessionShownCount >= sessionMax) {
    return null
  }

  // Global gap — shorter for time-sensitive problem hints.
  const globalGap = (isProblem ? RULES.problemGlobalGapMs : RULES.globalGapMs) * gapMul
  if (now - cooldowns.lastGlobalAt < globalGap) return null

  // Per-screen gap — one bubble per screen per window, all classes.
  const lastOnScreen = cooldowns.perScreen[screen] ?? 0
  if (now - lastOnScreen < RULES.perScreenGapMs * gapMul) return null

  return winner
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
