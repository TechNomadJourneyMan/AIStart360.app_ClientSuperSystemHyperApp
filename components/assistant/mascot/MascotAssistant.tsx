'use client'

/**
 * components/assistant/mascot/MascotAssistant.tsx — the orchestrator.
 *
 * Owns the whole mascot lifecycle (ТЗ §4–§9): polls GET /api/v1/assistant/context
 * on navigation, merges server hint candidates with local ones (greeting, idle,
 * education, celebrate), runs the pure trigger engine, renders the cat + bubble
 * + controls, and opens the EXISTING AssistantChatPanel for the full chat —
 * scripted bubbles never call the LLM.
 *
 * Hard anti-annoyance blocks live here (typing, dialogs, scrolling, on-screen
 * keyboard, FirstRunWizard on screen) because they need the DOM; all timing
 * rules are pure in lib/assistant/mascot/triggers.ts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AssistantChatPanel } from '@/components/assistant/AssistantChatPanel'
import {
  localCandidate,
  normalizeScreen,
  resolveHint,
  screenAllowed,
  type HintAction,
  type ResolvedHint,
} from '@/lib/assistant/mascot/hints'
import { pickHint, RULES } from '@/lib/assistant/mascot/triggers'
import { useMascotStore } from '@/lib/assistant/mascot/state'
import { trackMascotEvent } from '@/lib/assistant/mascot/analytics'
import { useMascotBehavior } from '@/lib/assistant/mascot/behavior'
import { useSafeScreenPosition } from '@/lib/assistant/mascot/useSafeScreenPosition'
import {
  isMascotHidden,
  type AssistantContextPayload,
  type HidePeriod,
  type MascotSettings,
} from '@/lib/assistant/mascot/types'
import { getCharacter } from '@/lib/assistant/mascot/characters'
import { tourForScreen, type TourStep } from '@/lib/assistant/mascot/tours'
import { MascotAvatar } from './MascotAvatar'
import { MascotBubble } from './MascotBubble'
import { MascotCoachmarks } from './MascotCoachmarks'
import { MascotControls } from './MascotControls'
import { MascotWelcome } from './MascotWelcome'

const CONTEXT_STALE_MS = 60_000
const BUBBLE_AUTO_CLEAR_MS = 20_000
const TICK_MS = 45_000
const AUTO_INSIGHT_DELAY_MS = 75_000
/** Screens where the once-per-session auto AI-insight makes sense. */
const AUTO_INSIGHT_SCREENS = [
  '/dashboard',
  '/client/dashboard',
  '/gri',
  '/pulse',
  '/client/point-a',
  '/point-a',
  '/client/point-b',
  '/point-b',
]

// ─── DOM-level hard blocks (ТЗ §9) ───────────────────────────────────────────

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  )
}

/** A foreign modal is open (our chat panel is excluded via data-mascot-panel). */
function foreignDialogOpen(): boolean {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
  for (const d of Array.from(dialogs)) {
    if (d.closest('[data-mascot-panel]')) continue
    const r = d.getBoundingClientRect()
    // The assistant slide-over parks off-screen when closed — treat off-screen
    // dialogs as closed.
    if (r.width > 0 && r.left < window.innerWidth && r.right > 0) return true
  }
  return false
}

function wizardOnScreen(): boolean {
  return !!document.querySelector('[data-first-run-wizard]')
}

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const update = () => setDesktop(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return desktop
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MascotAssistant() {
  const pathname = usePathname() ?? '/'
  const screen = useMemo(() => normalizeScreen(pathname), [pathname])
  const router = useRouter()
  const isDesktop = useIsDesktop()

  const {
    state,
    activeHint,
    chatOpen,
    context,
    contextFetchedAt,
    sessionShownCount,
    idleFired,
    sessionHidden,
    cooldowns,
    minimized,
    settings,
    lastCompletedSections,
    setContext,
    showHint,
    clearHint,
    setChatOpen,
    setMinimized,
    setSessionHidden,
    markIdleFired,
    applySettings,
    setLastCompletedSections,
  } = useMascotStore()

  const [controlsOpen, setControlsOpen] = useState(false)
  const [scrolling, setScrolling] = useState(false)
  const [tabHidden, setTabHidden] = useState(false)
  const [hoverWave, setHoverWave] = useState(false)
  const lastWaveRef = useRef(0)
  const waveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [tourSteps, setTourSteps] = useState<TourStep[] | null>(null)
  const tourSessionRef = useRef<Set<string>>(new Set())
  const [showWelcome, setShowWelcome] = useState(false)

  const screenRef = useRef(screen)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shownOnceRef = useRef(false)
  const insightBusyRef = useRef(false)
  const autoInsightDoneRef = useRef(false)

  const hiddenNow = sessionHidden || isMascotHidden(settings, Date.now())
  const reducedMotion = useReducedMotion()

  const baseBottom = isDesktop ? 24 : 80
  // Zone ≈ avatar size + bubble headroom (desktop cat is 168px since v1.3.1).
  const { extraBottom, keyboardOpen } = useSafeScreenPosition(baseBottom, isDesktop ? 210 : 150)

  const character = settings.character
  const characterName = getCharacter(character).name
  const mascotColor = settings.color

  // Idle-life engine: strolls/rubs (desktop, unless disabled) + sleep.
  const behaviorBusy =
    !!activeHint || chatOpen || controlsOpen || minimized || keyboardOpen || scrolling || !!tourSteps
  const behavior = useMascotBehavior({
    busy: behaviorBusy,
    walkingEnabled: settings.behavior.walking && isDesktop && !reducedMotion,
    sleepEnabled: settings.behavior.sleep,
    paused: tabHidden,
  })
  const behaviorVisualRef = useRef(behavior.visual)
  behaviorVisualRef.current = behavior.visual

  // ── Context polling (light, no LLM) ─────────────────────────────────────────
  const fetchContext = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/assistant/context', {
        cache: 'no-store',
        credentials: 'include',
      })
      if (!res.ok) return
      const json = (await res.json()) as AssistantContextPayload | { ok: false }
      if (json.ok) {
        useMascotStore.getState().setContext(json)
        // Initialize the celebrate watermark on the very first snapshot so an
        // old account doesn't get congratulated for past sections on day one.
        const st = useMascotStore.getState()
        if (st.lastCompletedSections == null) {
          st.setLastCompletedSections(json.progress.completedSections)
        }
      }
    } catch {
      // Offline/failed — the mascot just stays quiet.
    }
  }, [])

  useEffect(() => {
    if (hiddenNow) return
    const stale = Date.now() - contextFetchedAt > CONTEXT_STALE_MS
    if (screenRef.current !== screen || stale || !context) {
      screenRef.current = screen
      void fetchContext()
    }
    setControlsOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, hiddenNow])

  // ── Candidate assembly + evaluation ────────────────────────────────────────
  const evaluate = useCallback(
    (extra: ResolvedHint[] = []) => {
      const s = useMascotStore.getState()
      if (
        sessionHidden ||
        isMascotHidden(s.settings, Date.now()) ||
        s.chatOpen ||
        s.minimized ||
        s.activeHint
      )
        return
      if (document.visibilityState === 'hidden') return
      if (isTypingTarget(document.activeElement)) return
      if (foreignDialogOpen()) return

      // Возвращение в портал: короткая волна-приветствие раз за браузер-сессию
      // (сессионный ритуал — уважает жёсткие блоки выше, минует cooldown-движок).
      if (
        s.settings.greeted &&
        typeof window !== 'undefined' &&
        !window.sessionStorage.getItem('aistart_gree_welcomed')
      ) {
        window.sessionStorage.setItem('aistart_gree_welcomed', '1')
        const wb = localCandidate('welcome_back', { name: getCharacter(s.settings.character).name })
        const r = wb ? resolveHint(wb) : null
        if (r) {
          s.showHint(r, screen, Date.now())
          trackMascotEvent('hint_shown', { screen, refId: 'welcome_back' })
          return
        }
      }

      // Спит — будим только ради важного (ошибки/незавершённое/следующий шаг);
      // мотивационные и обучающие пузыри сон не прерывают.
      const sleeping = behaviorVisualRef.current === 'sleep'

      const candidates: ResolvedHint[] = [...extra]

      for (const c of s.context?.hints ?? []) {
        const r = resolveHint(c)
        if (r) candidates.push(r)
      }

      // Greeting bubble — once ever, never next to the FirstRunWizard
      // (scenario 1). Пропускаем, когда первым входом владеет welcome-модалка
      // (tourGuide.status='pending' → MascotWelcome сам поприветствует и поставит
      // greeted=true); пузырь-приветствие остаётся лишь для легаси-пути.
      if (
        !s.settings.greeted &&
        s.settings.tourGuide.status !== 'pending' &&
        !wizardOnScreen()
      ) {
        const g = localCandidate('greeting', { name: getCharacter(s.settings.character).name })
        const r = g ? resolveHint(g) : null
        if (r) candidates.push(r)
      }

      // Education nudge on the survey (scenario 4).
      if (screen === '/client/onboarding') {
        const c = localCandidate('complex_section')
        const r = c ? resolveHint(c) : null
        if (r) candidates.push(r)
      }

      // Celebrate fresh section completion (scenario 5).
      const done = s.context?.progress.completedSections
      if (
        done != null &&
        s.lastCompletedSections != null &&
        done > s.lastCompletedSections
      ) {
        const c = localCandidate('celebrate_progress', {
          nextLabel: s.context?.progress.nextSection?.label ?? null,
        })
        const r = c ? resolveHint(c) : null
        if (r) candidates.push(r)
        // One shot per increase — even if the pick loses to a cooldown.
        s.setLastCompletedSections(done)
      }

      const eligible = sleeping ? candidates.filter((c) => c.priority <= 2) : candidates

      const picked = pickHint({
        now: Date.now(),
        screen,
        candidates: eligible,
        cooldowns: s.cooldowns,
        settings: s.settings,
        sessionShownCount: s.sessionShownCount,
      })
      if (!picked) return

      s.showHint(picked, screen, Date.now())
      trackMascotEvent('hint_shown', { screen, refId: picked.id })

      if (picked.id === 'greeting') {
        s.applySettings({ greeted: true })
        void fetch('/api/v1/assistant/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ greeted: true }),
        }).catch(() => undefined)
      }
    },
    [screen, sessionHidden],
  )

  // Evaluate shortly after landing on a screen (greeting waits its 5 s).
  useEffect(() => {
    if (hiddenNow) return
    const t = setTimeout(() => evaluate(), RULES.greetingDelayMs)
    return () => clearTimeout(t)
  }, [screen, hiddenNow, evaluate])

  // Evaluate when a fresh context snapshot lands.
  useEffect(() => {
    if (hiddenNow || !context) return
    const t = setTimeout(() => evaluate(), 1_200)
    return () => clearTimeout(t)
  }, [contextFetchedAt, hiddenNow]) // eslint-disable-line react-hooks/exhaustive-deps

  // Soft periodic re-check while visible (cleared when hidden). Also self-heals
  // a missing/stale context snapshot — a failed navigation fetch would otherwise
  // leave the trigger engine data-blind until the next screen change.
  useEffect(() => {
    if (hiddenNow) return
    const id = setInterval(() => {
      const s = useMascotStore.getState()
      if (!s.context || Date.now() - s.contextFetchedAt > CONTEXT_STALE_MS) {
        void fetchContext()
      }
      evaluate()
    }, TICK_MS)
    return () => clearInterval(id)
  }, [hiddenNow, evaluate, fetchContext])

  // Idle nudge (scenario 3) — once per screen per session.
  useEffect(() => {
    if (hiddenNow) return
    const idleMs = isDesktop ? RULES.idleMsDesktop : RULES.idleMsMobile
    let timer: ReturnType<typeof setTimeout> | null = null

    const fire = () => {
      const s = useMascotStore.getState()
      if (s.idleFired.includes(screen)) return
      const c = localCandidate('idle_help')
      const r = c ? resolveHint(c) : null
      if (!r || !screenAllowed(r, screen)) return
      markIdleFired(screen)
      evaluate([r])
    }
    const reset = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(fire, idleMs)
    }
    const events: Array<keyof WindowEventMap> = [
      'pointerdown',
      'pointermove',
      'keydown',
      'wheel',
      'touchstart',
    ]
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => {
      if (timer) clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [screen, hiddenNow, isDesktop, evaluate, markIdleFired])

  // Scroll dimming + suppression (§6).
  useEffect(() => {
    const onScroll = () => {
      setScrolling(true)
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
      scrollTimer.current = setTimeout(() => setScrolling(false), 400)
    }
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
    }
  }, [])

  // Pause loops when the tab is hidden.
  useEffect(() => {
    const onVis = () => setTabHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // Auto-clear a bubble that nobody touched.
  useEffect(() => {
    if (!activeHint) return
    const t = setTimeout(() => clearHint('auto', Date.now()), BUBBLE_AUTO_CLEAR_MS)
    return () => clearTimeout(t)
  }, [activeHint, clearHint])

  // Esc closes the bubble (the chat panel handles its own Esc first).
  useEffect(() => {
    if (!activeHint || chatOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearHint('auto', Date.now())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeHint, chatOpen, clearHint])

  // First paint of the widget → one mascot_shown event.
  useEffect(() => {
    if (hiddenNow || shownOnceRef.current) return
    shownOnceRef.current = true
    trackMascotEvent('mascot_shown', { screen })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenNow])

  // ── Handlers ────────────────────────────────────────────────────────────────
  const openChat = useCallback(
    (source: 'avatar' | 'bubble' | 'badge') => {
      if (activeHint) clearHint('action', Date.now())
      setChatOpen(true)
      trackMascotEvent('chat_opened', { screen, meta: { source } })
    },
    [activeHint, clearHint, setChatOpen, screen],
  )

  const onBubbleAction = useCallback(
    (action: HintAction) => {
      const hintId = activeHint?.id
      if (hintId) trackMascotEvent('hint_clicked', { screen, refId: hintId })
      clearHint('action', Date.now())
      if (action.kind === 'navigate' && action.href) router.push(action.href)
      else if (action.kind === 'open_chat') openChat('bubble')
    },
    [activeHint, clearHint, router, openChat, screen],
  )

  const onBubbleClose = useCallback(() => {
    if (activeHint) {
      trackMascotEvent('hint_dismissed', {
        screen,
        refId: activeHint.id,
        meta: { dismiss: 'close' },
      })
    }
    clearHint('close', Date.now())
  }, [activeHint, clearHint, screen])

  const onMuteType = useCallback(() => {
    if (!activeHint) return
    const nextDismissed = Array.from(new Set([...settings.dismissedHints, activeHint.type]))
    applySettings({ dismissedHints: nextDismissed })
    trackMascotEvent('hint_dismissed', {
      screen,
      refId: activeHint.id,
      meta: { dismiss: 'mute_type' },
    })
    clearHint('close', Date.now())
    void fetch('/api/v1/assistant/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ dismissedHints: nextDismissed }),
    }).catch(() => undefined)
  }, [activeHint, settings.dismissedHints, applySettings, clearHint, screen])

  const onMinimize = useCallback(() => {
    setControlsOpen(false)
    setMinimized(true)
    trackMascotEvent('mascot_minimized', { screen })
  }, [setMinimized, screen])

  const onRestore = useCallback(() => {
    setMinimized(false)
    trackMascotEvent('mascot_restored', { screen })
  }, [setMinimized, screen])

  /**
   * AI-инсайт через OpenRouter (единственный LLM-вызов проактивного маскота).
   * manual=true — явный запрос из меню «⋯»: кот «думает», пузырь показывается
   * сразу; auto — раз за сессию, идёт через общий движок cooldown'ов.
   */
  const requestInsight = useCallback(
    async (manual: boolean) => {
      if (insightBusyRef.current) return
      insightBusyRef.current = true
      const s = useMascotStore.getState()
      if (manual) {
        if (s.activeHint) s.clearHint('action', Date.now())
        s.setState('loading')
      }
      try {
        const res = await fetch('/api/v1/assistant/insight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ screen }),
        })
        const json = (await res.json().catch(() => null)) as
          | { ok: boolean; insight?: string | null }
          | null
        const text = json?.ok ? (json.insight ?? null) : null

        if (manual) {
          const resolved = resolveHint({
            id: 'ai_insight',
            priority: 3,
            params: {
              text:
                text ??
                'Пока не хватает данных для инсайта — заполните ещё немного анкеты, и я вернусь с наблюдением 🐾',
            },
          })
          if (resolved) {
            useMascotStore.getState().showHint(resolved, screen, Date.now())
            trackMascotEvent('hint_shown', { screen, refId: 'ai_insight' })
          }
        } else if (text) {
          const resolved = resolveHint({ id: 'ai_insight', priority: 3, params: { text } })
          if (resolved) evaluate([resolved])
        }
      } catch {
        if (manual) {
          const s2 = useMascotStore.getState()
          s2.setState(s2.minimized ? 'minimized' : 'idle')
        }
      } finally {
        insightBusyRef.current = false
      }
    },
    [screen, evaluate],
  )

  // Авто-инсайт: один раз за сессию, на экранах с результатами, если включено.
  useEffect(() => {
    if (hiddenNow || autoInsightDoneRef.current) return
    if (!AUTO_INSIGHT_SCREENS.includes(screen)) return
    const t = setTimeout(() => {
      const s = useMascotStore.getState()
      if (
        autoInsightDoneRef.current ||
        !s.settings.behavior.aiInsights ||
        !s.context?.results.hasDiagnostic
      )
        return
      autoInsightDoneRef.current = true
      void requestInsight(false)
    }, AUTO_INSIGHT_DELAY_MS)
    return () => clearTimeout(t)
  }, [screen, hiddenNow, requestInsight])

  const onInsightClick = useCallback(() => {
    setControlsOpen(false)
    void requestInsight(true)
  }, [requestInsight])

  // ── Welcome первого входа (заменяет пер-страничный автозапуск туров) ────────
  // Пер-страничный автозапуск ощущался как «туры постоянно», поэтому единственный
  // авто-показ теперь — welcome от Гри при первом входе. Показываем один раз,
  // когда контекст загружен и Гри ещё не поздоровался (greeted=false и
  // tourGuide.status='pending'). Откладываем, пока онбордингом владеет
  // FirstRunWizard (тот же DOM-маркер, что глушит пузырь-приветствие), открыт
  // чужой диалог, чат или маскот свёрнут — чтобы welcome не наслаивался.
  // greeted/статус пишутся ТОЛЬКО по выбору в модалке — само появление ничего не
  // помечает, поэтому показ строго одноразовый (см. onWelcome* + persistSettings).
  useEffect(() => {
    if (hiddenNow) {
      setShowWelcome(false)
      return
    }
    if (!context || showWelcome) return
    if (settings.greeted || settings.tourGuide.status !== 'pending') return

    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    const tryShow = () => {
      if (cancelled) return
      const s = useMascotStore.getState()
      if (s.settings.greeted || s.settings.tourGuide.status !== 'pending') return
      if (wizardOnScreen() || foreignDialogOpen() || s.chatOpen || s.minimized) {
        timer = setTimeout(tryShow, 800)
        return
      }
      setShowWelcome(true)
    }
    timer = setTimeout(tryShow, 1_200)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [context, hiddenNow, showWelcome, settings.greeted, settings.tourGuide.status])

  // Settings «Сбросить обучение»: clear the per-session guard so tours re-run.
  useEffect(() => {
    const onReplay = () => {
      tourSessionRef.current.clear()
      const steps = tourForScreen(screen)
      if (steps) setTourSteps(steps)
    }
    window.addEventListener('aistart:tutorial:replay', onReplay)
    return () => window.removeEventListener('aistart:tutorial:replay', onReplay)
  }, [screen])

  /** Menu «Тур по этой странице» — run the current screen's tour now. */
  const onPageTour = useCallback(() => {
    setControlsOpen(false)
    const steps = tourForScreen(screen)
    if (steps) setTourSteps(steps)
  }, [screen])

  /**
   * applySettings + ОДИН PATCH (лимит записи 10/мин — welcome/«Обучение»
   * дёргают ровно один PATCH на действие пользователя). Локальное применение
   * мгновенно, сервер — источник истины, /context пере-синхронит на след. фетче.
   */
  const persistSettings = useCallback(
    (patch: Partial<MascotSettings>) => {
      applySettings(patch)
      void fetch('/api/v1/assistant/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      }).catch(() => undefined)
    },
    [applySettings],
  )

  // ── Welcome-модалка: выбор пользователя (ровно один PATCH на действие) ──────
  const onWelcomeStartTour = useCallback(() => {
    setShowWelcome(false)
    persistSettings({ greeted: true, tourGuide: { status: 'active', stepIdx: 0 } })
    // Батч B: полноценная экскурсия. Пока — интерим: сразу запускаем тур текущего
    // экрана, чтобы кнопка «Провести экскурсию» делала что-то видимое.
    const steps = tourForScreen(screen)
    if (steps) setTourSteps(steps)
  }, [persistSettings, screen])

  const onWelcomeDismiss = useCallback(() => {
    setShowWelcome(false)
    persistSettings({ greeted: true, tourGuide: { status: 'dismissed', stepIdx: 0 } })
  }, [persistSettings])

  const closeTour = useCallback(
    (_done: boolean) => {
      setTourSteps(null)
      const s = useMascotStore.getState()
      const next = Array.from(new Set([...s.settings.toursDone, screen])).slice(0, 50)
      applySettings({ toursDone: next })
      void fetch('/api/v1/assistant/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ toursDone: next }),
      }).catch(() => undefined)
    },
    [applySettings, screen],
  )

  /** Наведение: стоп на месте + короткое махание лапой (не чаще раза в 30 с). */
  const onAvatarEnter = useCallback(() => {
    behavior.setHold(true)
    const s = useMascotStore.getState()
    const now = Date.now()
    if (
      !s.activeHint &&
      !s.chatOpen &&
      s.state === 'idle' &&
      behavior.visual !== 'sleep' &&
      !reducedMotion &&
      now - lastWaveRef.current > 30_000
    ) {
      lastWaveRef.current = now
      setHoverWave(true)
      if (waveTimer.current) clearTimeout(waveTimer.current)
      waveTimer.current = setTimeout(() => setHoverWave(false), 1_800)
    }
  }, [behavior, reducedMotion])

  const onAvatarLeave = useCallback(() => {
    behavior.setHold(false)
  }, [behavior])

  useEffect(
    () => () => {
      if (waveTimer.current) clearTimeout(waveTimer.current)
    },
    [],
  )

  const onHide = useCallback(
    (period: HidePeriod) => {
      setControlsOpen(false)
      if (period === 'session') setSessionHidden(true)
      else if (period === 'forever') applySettings({ mascotEnabled: false })
      // The server computes hiddenUntil for 24h/7d; mirror it when it answers.
      void fetch('/api/v1/assistant/hide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ period }),
      })
        .then(async (res) => {
          const json = (await res.json()) as { ok: boolean; hiddenUntil?: string | null }
          if (json.ok && (period === '24h' || period === '7d')) {
            applySettings({ hiddenUntil: json.hiddenUntil ?? null })
          }
        })
        .catch(() => undefined)
    },
    [applySettings, setSessionHidden],
  )

  // ── Render ──────────────────────────────────────────────────────────────────
  if (hiddenNow) return null

  const pendingBadge = !!context && context.hints.length > 0
  const avatarPose = chatOpen ? 'idle' : hoverWave && state === 'idle' ? 'greeting' : state
  const paused = tabHidden || scrolling

  return (
    <>
    <div
      role="complementary"
      aria-label={`${characterName} — ассистент`}
      className="fixed right-4 lg:right-6 z-30 flex flex-col items-end gap-2"
      style={{
        bottom: baseBottom + extraBottom,
        visibility: keyboardOpen ? 'hidden' : 'visible',
        opacity: scrolling ? 0.5 : 1,
        transition: 'opacity 200ms ease, bottom 250ms ease',
      }}
    >
      {/* Idle-life carrier: the whole stack (menu, bubble, cat) strolls together,
          so the bubble tail always points at the cat wherever it stands.
          onUpdate feeds the live x back so interruptions keep a constant px/s. */}
      <motion.div
        className="flex flex-col items-end gap-2"
        animate={{ x: behavior.x }}
        transition={{ duration: behavior.moveDuration, ease: [0.45, 0.05, 0.55, 0.95] }}
        onUpdate={(latest) => {
          if (typeof latest.x === 'number') behavior.onMove(latest.x)
        }}
        onAnimationComplete={behavior.onArrive}
      >
      <AnimatePresence>
        {controlsOpen && !minimized && (
          <MascotControls
            characterName={characterName}
            onMinimize={onMinimize}
            onHide={onHide}
            onInsight={settings.behavior.aiInsights ? onInsightClick : undefined}
            onPageTour={tourForScreen(screen) ? onPageTour : undefined}
            onClose={() => setControlsOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeHint && !chatOpen && !minimized && !controlsOpen && (
          <MascotBubble
            hint={activeHint}
            compact={!isDesktop}
            onAction={onBubbleAction}
            onClose={onBubbleClose}
            onMuteType={onMuteType}
          />
        )}
      </AnimatePresence>

      {minimized ? (
        <button
          onClick={onRestore}
          aria-label={`Развернуть ассистента ${characterName}`}
          className="relative w-10 h-10 rounded-full bg-[#12151c]/95 border border-white/[0.1] shadow-lg shadow-black/40 flex items-center justify-center hover:border-primary/40 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <MascotAvatar pose="minimized" character={character} color={mascotColor} size={30} headOnly paused />
          {pendingBadge && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary shadow shadow-primary/50"
            />
          )}
        </button>
      ) : (
        <div
          className="relative group"
          // Наведение = «стой, я к тебе»: кот останавливается, машет лапой
          // и ждёт клика (ТЗ v1.1/v1.2).
          onPointerEnter={onAvatarEnter}
          onPointerLeave={onAvatarLeave}
        >
          <button
            onClick={() => openChat('avatar')}
            onContextMenu={(e) => {
              e.preventDefault()
              setControlsOpen((v) => !v)
            }}
            aria-label={`${characterName} — открыть чат с ассистентом`}
            title={`${characterName} — ваш ассистент`}
            className="block rounded-full focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-[#0A0B0F] hover:scale-[1.04] active:scale-[0.98] transition-transform"
          >
            {/* Mirror only the mascot while it walks left; bubbles stay unflipped. */}
            <motion.span
              style={{ display: 'block' }}
              animate={{ scaleX: behavior.facing === 'left' ? -1 : 1 }}
              transition={{ duration: 0.25 }}
            >
              <MascotAvatar
                pose={avatarPose}
                character={character}
                color={mascotColor}
                behavior={behavior.visual}
                size={isDesktop ? 126 : 64}
                paused={paused}
              />
            </motion.span>
          </button>
          <button
            onClick={() => setControlsOpen((v) => !v)}
            aria-label="Управление ассистентом"
            aria-haspopup="menu"
            aria-expanded={controlsOpen}
            className={`absolute -top-1 -left-2 w-6 h-6 rounded-full bg-[#12151c]/95 border border-white/[0.12] text-on-surface-variant flex items-center justify-center transition-opacity focus:outline-none focus:ring-2 focus:ring-primary/40 ${
              isDesktop
                ? 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                : 'opacity-70'
            } ${controlsOpen ? 'opacity-100' : ''}`}
          >
            <span className="material-symbols-outlined text-sm">more_horiz</span>
          </button>
        </div>
      )}
      </motion.div>
    </div>

    {/* Full chat — the existing panel (fixed-position, renders outside the
        corner stack so the flex gap never offsets the avatar). */}
    <div data-mascot-panel>
      <AssistantChatPanel open={chatOpen} onClose={() => setChatOpen(false)} currentScreen={screen} />
    </div>

    {/* Coachmark tour — the mascot points at real interface elements. */}
    {tourSteps && (
      <MascotCoachmarks
        steps={tourSteps}
        character={character}
        color={mascotColor}
        onClose={closeTour}
      />
    )}

    {/* Welcome первого входа — единственный авто-показ; выбор ведёт в экскурсию
        (Батч B) либо помечает её dismissed. Больше не повторяется (greeted). */}
    <AnimatePresence>
      {showWelcome && !chatOpen && !minimized && (
        <MascotWelcome
          characterName={characterName}
          character={character}
          color={mascotColor}
          onStartTour={onWelcomeStartTour}
          onDismiss={onWelcomeDismiss}
        />
      )}
    </AnimatePresence>
    </>
  )
}
