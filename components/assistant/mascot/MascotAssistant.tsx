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
import { AnimatePresence } from 'framer-motion'
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
import { useSafeScreenPosition } from '@/lib/assistant/mascot/useSafeScreenPosition'
import {
  isMascotHidden,
  type AssistantContextPayload,
  type HidePeriod,
} from '@/lib/assistant/mascot/types'
import { MascotAvatar } from './MascotAvatar'
import { MascotBubble } from './MascotBubble'
import { MascotControls } from './MascotControls'

const CONTEXT_STALE_MS = 60_000
const BUBBLE_AUTO_CLEAR_MS = 20_000
const TICK_MS = 45_000

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

  const screenRef = useRef(screen)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shownOnceRef = useRef(false)

  const hiddenNow = sessionHidden || isMascotHidden(settings, Date.now())

  const baseBottom = isDesktop ? 24 : 80
  const { extraBottom, keyboardOpen } = useSafeScreenPosition(baseBottom)

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

      const candidates: ResolvedHint[] = [...extra]

      for (const c of s.context?.hints ?? []) {
        const r = resolveHint(c)
        if (r) candidates.push(r)
      }

      // Greeting — once ever, never next to the FirstRunWizard (scenario 1).
      if (!s.settings.greeted && !wizardOnScreen()) {
        const g = localCandidate('greeting')
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

      const picked = pickHint({
        now: Date.now(),
        screen,
        candidates,
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
  const avatarPose = chatOpen ? 'idle' : state
  const paused = tabHidden || scrolling

  return (
    <>
    <div
      role="complementary"
      aria-label="Гри — ассистент"
      className="fixed right-4 lg:right-6 z-30 flex flex-col items-end gap-2"
      style={{
        bottom: baseBottom + extraBottom,
        visibility: keyboardOpen ? 'hidden' : 'visible',
        opacity: scrolling ? 0.5 : 1,
        transition: 'opacity 200ms ease, bottom 250ms ease',
      }}
    >
      <AnimatePresence>
        {controlsOpen && !minimized && (
          <MascotControls onMinimize={onMinimize} onHide={onHide} onClose={() => setControlsOpen(false)} />
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
          aria-label="Развернуть ассистента Гри"
          className="relative w-10 h-10 rounded-full bg-[#12151c]/95 border border-white/[0.1] shadow-lg shadow-black/40 flex items-center justify-center hover:border-primary/40 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <MascotAvatar pose="minimized" size={30} headOnly paused />
          {pendingBadge && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary shadow shadow-primary/50"
            />
          )}
        </button>
      ) : (
        <div className="relative group">
          <button
            onClick={() => openChat('avatar')}
            onContextMenu={(e) => {
              e.preventDefault()
              setControlsOpen((v) => !v)
            }}
            aria-label="Гри — открыть чат с ассистентом"
            title="Гри — ваш ассистент"
            className="block rounded-full focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-[#0A0B0F] hover:scale-[1.04] active:scale-[0.98] transition-transform"
          >
            <MascotAvatar pose={avatarPose} size={isDesktop ? 84 : 56} paused={paused} />
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

    </div>

    {/* Full chat — the existing panel (fixed-position, renders outside the
        corner stack so the flex gap never offsets the avatar). */}
    <div data-mascot-panel>
      <AssistantChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
    </>
  )
}
