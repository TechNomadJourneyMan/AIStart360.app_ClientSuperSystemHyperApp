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
  DEFAULT_MASCOT_BEHAVIOR,
  DEFAULT_MASCOT_SETTINGS,
  DEFAULT_TOUR_GUIDE,
  type AssistantContextPayload,
  type MascotSettings,
  type MascotState,
  type TourGuideState,
  type TourGuideStatus,
} from './types'

/**
 * Ранг статуса экскурсии для защиты от даунгрейда протухшим /context (I3):
 * done/dismissed (терминальные) > active > pending. Когда прогон НЕ идёт,
 * сервер выигрывает, только если его ранг НЕ ниже локального — иначе stale
 * 'pending'/'active' откатил бы уже завершённую/dismissed экскурсию.
 */
function tourGuideRank(status: TourGuideStatus): number {
  if (status === 'done' || status === 'dismissed') return 2
  if (status === 'active') return 1
  return 0 // pending
}

/**
 * Слить локальный и серверный tourGuide (см. setContext, I3):
 *  • guideRunning=true  → локальный целиком (мы — единственный источник прогресса);
 *  • guideRunning=false → адаптируем серверный (кросс-девайс/резюм), НО не даём
 *    ему понизить ранг локального; при равном ранге терминалы держим локально
 *    (не переключаем done↔dismissed), active↔active/pending↔pending берём сервер.
 */
export function mergeTourGuide(
  local: TourGuideState,
  server: TourGuideState,
  guideRunning: boolean,
): TourGuideState {
  if (guideRunning) return local
  const rl = tourGuideRank(local.status)
  const rs = tourGuideRank(server.status)
  if (rs > rl) return server
  if (rs < rl) return local
  return rl >= 2 ? local : server
}

/** The persisted slice shape (partialize output). */
type MascotPersistedSlice = Pick<
  MascotStore,
  'cooldowns' | 'minimized' | 'settings' | 'lastCompletedSections'
>

/**
 * Миграция персиста 'aistart_mascot_v1' (v2, Фаза 3): блобы, записанные до
 * появления settings.tourGuide, не содержат этого поля — без бэкфила первый же
 * setContext падал бы на `settings.tourGuide.status` и маскот умирал молча.
 * Мержим ПО-ПОЛЬНО поверх дефолтов (toursDone/dismissedHints пользователя не
 * теряем), behavior и tourGuide — глубоко. Экспортирована для юнит-тестов.
 */
export function migrateMascotPersist(persisted: unknown): MascotPersistedSlice {
  const p = (persisted && typeof persisted === 'object' ? persisted : {}) as Record<
    string,
    unknown
  > & { settings?: Partial<MascotSettings> }
  const s = (p.settings && typeof p.settings === 'object' ? p.settings : {}) as Partial<
    MascotSettings
  >
  return {
    ...(p as Partial<MascotPersistedSlice>),
    cooldowns: (p.cooldowns as CooldownState) ?? EMPTY_COOLDOWNS,
    minimized: p.minimized === true,
    lastCompletedSections:
      typeof p.lastCompletedSections === 'number' ? p.lastCompletedSections : null,
    settings: {
      ...DEFAULT_MASCOT_SETTINGS,
      ...s,
      behavior: { ...DEFAULT_MASCOT_BEHAVIOR, ...(s.behavior ?? {}) },
      tourGuide: { ...DEFAULT_TOUR_GUIDE, ...(s.tourGuide ?? {}) },
      toursDone: Array.isArray(s.toursDone) ? s.toursDone : [],
      dismissedHints: Array.isArray(s.dismissedHints) ? s.dismissedHints : [],
    },
  }
}

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
  /**
   * Нормализованный экран, тур которого просит меню «Обучение» после перехода
   * на другую страницу; MascotAssistant при совпадении screen запускает тур и
   * сбрасывает поле. Транзиентно — не персистится.
   */
  requestedTourScreen: string | null
  /**
   * Экскурсия «Первые шаги» идёт ПРЯМО СЕЙЧАС в этой вкладке (in-memory прогон).
   * Транзиентно (НЕ персистится): прогресс живёт в settings.tourGuide, а этот
   * флаг лишь отделяет «активно ведём» от «пауза/резюм после перезагрузки».
   * Пока true — локальный tourGuide источник истины (см. setContext, I3), чтобы
   * протухший /context не откатил stepIdx и не воскресил уже пройденный шаг.
   * Пережить router.push/ремоунт между layout-группами помогает то, что стор —
   * модуль-синглтон; полная перезагрузка сбрасывает флаг в false (→ резюм). Сам
   * маршрут детерминирован (tour-guide.visibleSteps) и в сторе не хранится.
   */
  guideRunning: boolean

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
  setRequestedTourScreen: (screen: string | null) => void
  setGuideRunning: (running: boolean) => void
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
      requestedTourScreen: null,
      guideRunning: false,

      cooldowns: EMPTY_COOLDOWNS,
      minimized: false,
      settings: DEFAULT_MASCOT_SETTINGS,
      lastCompletedSections: null,

      setContext: (payload) =>
        set((s) => {
          // Защитные чтения: до миграции v2 в зеркале (или в старом серверном
          // bag'е) tourGuide может отсутствовать — не падаем, берём дефолт.
          const localTG = s.settings.tourGuide ?? DEFAULT_TOUR_GUIDE
          const serverTG = payload.settings.tourGuide ?? DEFAULT_TOUR_GUIDE
          // I3 — источник истины для tourGuide (см. mergeTourGuide):
          //  • guideRunning=true  → локальный целиком; протухший /context (в полёте
          //    до оптимистичного PATCH) не откатит stepIdx и не воскресит
          //    done→active/dismissed→active — прогресс двигаем только мы;
          //  • guideRunning=false → сервер (кросс-девайс/резюм) с ранг-защитой:
          //    done/dismissed > active > pending, даунгрейд запрещён.
          const tourGuide = mergeTourGuide(localTG, serverTG, s.guideRunning)
          return {
            context: payload,
            contextFetchedAt: Date.now(),
            // Server settings win, EXCEPT monotonically-progressing fields: a stale
            // /context response (in-flight before an optimistic PATCH) must not
            // clobber a tour completed a second ago, revert greeted, or pull the
            // welcome/экскурсия back to 'pending' after the user already chose.
            settings: {
              ...payload.settings,
              greeted: payload.settings.greeted || s.settings.greeted,
              toursDone: Array.from(
                new Set([...(payload.settings.toursDone ?? []), ...(s.settings.toursDone ?? [])]),
              ).slice(0, 50),
              dismissedHints: Array.from(
                new Set([
                  ...(payload.settings.dismissedHints ?? []),
                  ...(s.settings.dismissedHints ?? []),
                ]),
              ).slice(0, 50),
              tourGuide,
            },
          }
        }),

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

      setRequestedTourScreen: (screen) => set({ requestedTourScreen: screen }),

      setGuideRunning: (running) => set({ guideRunning: running }),

      markIdleFired: (screen) =>
        set((s) => (s.idleFired.includes(screen) ? s : { idleFired: [...s.idleFired, screen] })),

      applySettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      setLastCompletedSections: (n) => set({ lastCompletedSections: n }),

      setState: (state) => set({ state }),
    }),
    {
      name: 'aistart_mascot_v1',
      // v2 (Фаза 3): settings.tourGuide появился — старые блобы бэкфилим.
      version: 2,
      migrate: (persisted) => migrateMascotPersist(persisted),
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
