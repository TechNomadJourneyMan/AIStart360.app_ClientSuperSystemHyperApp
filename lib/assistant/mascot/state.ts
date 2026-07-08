'use client'

/**
 * lib/assistant/mascot/state.ts — the mascot's zustand store.
 *
 * One store drives the whole widget: finite state (ТЗ §4.2), the active bubble,
 * chat visibility, the /context snapshot, session counters and the PERSISTED
 * slice (cooldowns + minimized + settings mirror + progress watermark) under
 * localStorage key 'aistart_mascot_v1' (same persist pattern as
 * stores/ui.store.ts). Server settings remain the source of truth — the mirror
 * only makes the first paint instant; /context re-syncs it on every fetch.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ResolvedHint } from './hints'
import {
  EMPTY_COOLDOWNS,
  pruneCooldowns,
  registerClosed,
  registerShown,
  type CooldownState,
} from './triggers'
import {
  DEFAULT_MASCOT_SETTINGS,
  type AssistantContextPayload,
  type MascotSettings,
  type MascotState,
} from './types'

interface MascotStore {
  // ── Volatile (session) ────────────────────────────────────────────────────
  state: MascotState
  activeHint: ResolvedHint | null
  chatOpen: boolean
  context: AssistantContextPayload | null
  contextFetchedAt: number
  sessionShownCount: number
  /** Screens where the idle nudge already fired this session. */
  idleFired: string[]
  /** «Скрыть до конца сессии» — never persisted. */
  sessionHidden: boolean

  // ── Persisted ─────────────────────────────────────────────────────────────
  cooldowns: CooldownState
  minimized: boolean
  settings: MascotSettings
  /** Watermark for the celebrate-progress hint (completed sections count). */
  lastCompletedSections: number | null

  // ── Actions ───────────────────────────────────────────────────────────────
  setContext: (payload: AssistantContextPayload) => void
  showHint: (hint: ResolvedHint, screen: string, now: number) => void
  /** mode: 'action' — user clicked a CTA; 'close' — «×» (7d mute); 'auto' — timeout. */
  clearHint: (mode: 'action' | 'close' | 'auto', now: number) => void
  setChatOpen: (open: boolean) => void
  setMinimized: (minimized: boolean) => void
  setSessionHidden: (hidden: boolean) => void
  markIdleFired: (screen: string) => void
  applySettings: (patch: Partial<MascotSettings>) => void
  setLastCompletedSections: (n: number) => void
  setState: (state: MascotState) => void
}

export const useMascotStore = create<MascotStore>()(
  persist(
    (set) => ({
      state: 'idle',
      activeHint: null,
      chatOpen: false,
      context: null,
      contextFetchedAt: 0,
      sessionShownCount: 0,
      idleFired: [],
      sessionHidden: false,

      cooldowns: EMPTY_COOLDOWNS,
      minimized: false,
      settings: DEFAULT_MASCOT_SETTINGS,
      lastCompletedSections: null,

      setContext: (payload) =>
        set((s) => ({
          context: payload,
          contextFetchedAt: Date.now(),
          // Server settings win, EXCEPT monotonically growing lists: a stale
          // /context response must not clobber a tour completed a second ago.
          settings: {
            ...payload.settings,
            toursDone: Array.from(
              new Set([...payload.settings.toursDone, ...s.settings.toursDone]),
            ).slice(0, 50),
            dismissedHints: Array.from(
              new Set([...payload.settings.dismissedHints, ...s.settings.dismissedHints]),
            ).slice(0, 50),
          },
        })),

      showHint: (hint, screen, now) =>
        set((s) => ({
          activeHint: hint,
          state: hint.state,
          sessionShownCount: s.sessionShownCount + 1,
          cooldowns: registerShown(s.cooldowns, hint.id, screen, now),
        })),

      clearHint: (mode, now) =>
        set((s) => ({
          activeHint: null,
          state: s.minimized ? 'minimized' : 'idle',
          cooldowns:
            mode === 'close' && s.activeHint
              ? registerClosed(s.cooldowns, s.activeHint.id, now)
              : s.cooldowns,
        })),

      setChatOpen: (open) => set({ chatOpen: open }),

      setMinimized: (minimized) =>
        set((s) => ({
          minimized,
          state: minimized ? 'minimized' : 'idle',
          activeHint: minimized ? null : s.activeHint,
        })),

      setSessionHidden: (hidden) => set({ sessionHidden: hidden }),

      markIdleFired: (screen) =>
        set((s) => (s.idleFired.includes(screen) ? s : { idleFired: [...s.idleFired, screen] })),

      applySettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      setLastCompletedSections: (n) => set({ lastCompletedSections: n }),

      setState: (state) => set({ state }),
    }),
    {
      name: 'aistart_mascot_v1',
      partialize: (s) => ({
        cooldowns: s.cooldowns,
        minimized: s.minimized,
        settings: s.settings,
        lastCompletedSections: s.lastCompletedSections,
      }),
      onRehydrateStorage: () => (state) => {
        // Keep the persisted cooldown blob bounded.
        if (state) state.cooldowns = pruneCooldowns(state.cooldowns, Date.now())
      },
    },
  ),
)
