'use client'

/**
 * lib/assistant/mascot/behavior.ts — the idle-life engine of «Гри».
 *
 * A tiny state machine that makes the cat feel alive while it has nothing to
 * say: occasional strolls along the bottom edge (desktop), a back-rub against
 * the screen corner, and falling asleep after ~2 min without user activity.
 *
 * The hook owns the PHASES and TARGETS; the actual movement is rendered by the
 * parent (framer-motion animates `x`, then calls `onArrive`). Any «busy»
 * moment (bubble, chat, menu, minimized, keyboard, scrolling) sends the cat
 * home fast and freezes idle life; user activity wakes it from sleep.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MascotBehaviorVisual } from './types'

type Phase = 'home' | 'stroll' | 'pause' | 'return' | 'sleep' | 'rub'

export interface MascotBehavior {
  /** Overlay for MascotAvatar. */
  visual: MascotBehaviorVisual
  /** translateX target in px (0 = home corner; negative = to the left). */
  x: number
  /** Seconds the current x-transition should take (walking speed). */
  moveDuration: number
  /** Mirror the cat while it moves left. */
  facing: 'left' | 'right'
  /** Parent must call this when the x-animation completes. */
  onArrive: () => void
  /**
   * Feed the LIVE animated x back (framer onUpdate). Interruptions compute
   * distance/speed from the real position — without this a mid-walk retarget
   * would use the stale TARGET and the cat would crawl or teleport.
   */
  onMove: (latestX: number) => void
  /** Hover freeze: true while the cursor is over the cat — it stops and waits. */
  setHold: (hold: boolean) => void
}

const WALK_SPEED = 70 // px/s — a calm stroll
const RETURN_SPEED = 160 // px/s — hurrying home when something happens
const SLEEP_AFTER_MS = 120_000
const NEXT_ACT_MIN_MS = 25_000
const NEXT_ACT_MAX_MS = 65_000

const rand = (min: number, max: number) => min + Math.random() * (max - min)

export function useMascotBehavior(opts: {
  /** Bubble/chat/menu/minimized/hidden/keyboard/scrolling — no idle life. */
  busy: boolean
  /** settings.behavior.walking && desktop && !reduced-motion. */
  walkingEnabled: boolean
  /** settings.behavior.sleep. */
  sleepEnabled: boolean
  /** Tab hidden — freeze scheduling. */
  paused: boolean
}): MascotBehavior {
  const { busy, walkingEnabled, sleepEnabled, paused } = opts

  const [phase, setPhase] = useState<Phase>('home')
  const [x, setX] = useState(0)
  const [moveDuration, setMoveDuration] = useState(0)
  const [facing, setFacing] = useState<'left' | 'right'>('right')

  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const xRef = useRef(x)
  xRef.current = x
  const busyRef = useRef(busy)
  busyRef.current = busy
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  const actTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastActivity = useRef(Date.now())
  /** The real, currently RENDERED x (fed by framer onUpdate via onMove). */
  const liveX = useRef(0)
  const holdRef = useRef(false)

  const clearActTimer = () => {
    if (actTimer.current) {
      clearTimeout(actTimer.current)
      actTimer.current = null
    }
  }

  const goHome = useCallback((fast: boolean) => {
    // Distance from the REAL rendered position — a mid-walk interruption must
    // keep the px/s speed constant, not stretch it to the stale target.
    const dist = Math.abs(liveX.current)
    if (dist < 1) {
      setPhase('home')
      setX(0)
      return
    }
    setFacing('right')
    setMoveDuration(dist / (fast ? RETURN_SPEED : WALK_SPEED))
    setPhase('return')
    setX(0)
  }, [])

  const startStroll = useCallback(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
    const maxLeft = Math.max(140, Math.min(vw * 0.6, vw - 300))
    const target = -rand(140, maxLeft)
    setFacing(target < liveX.current ? 'left' : 'right')
    setMoveDuration(Math.abs(target - liveX.current) / WALK_SPEED)
    setPhase('stroll')
    setX(target)
  }, [])

  const scheduleNextAct = useCallback(() => {
    clearActTimer()
    if (!walkingEnabled) return
    actTimer.current = setTimeout(() => {
      if (busyRef.current || pausedRef.current || holdRef.current || phaseRef.current !== 'home') {
        scheduleNextAct()
        return
      }
      if (Math.random() < 0.3) {
        // Rub against the corner, then settle back.
        setPhase('rub')
        actTimer.current = setTimeout(() => {
          if (phaseRef.current === 'rub') setPhase('home')
          scheduleNextAct()
        }, rand(4000, 7000))
      } else {
        startStroll()
      }
    }, rand(NEXT_ACT_MIN_MS, NEXT_ACT_MAX_MS))
  }, [walkingEnabled, startStroll])

  /** The x-animation finished — advance the walk phases. */
  const onArrive = useCallback(() => {
    liveX.current = xRef.current
    const p = phaseRef.current
    if (p === 'stroll') {
      setPhase('pause')
      actTimer.current = setTimeout(() => {
        if (busyRef.current || holdRef.current || phaseRef.current !== 'pause') return
        if (Math.random() < 0.45) startStroll()
        else goHome(false)
      }, rand(2000, 5000))
    } else if (p === 'return') {
      setPhase('home')
      setFacing('right')
      scheduleNextAct()
    }
  }, [startStroll, goHome, scheduleNextAct])

  const onMove = useCallback((latestX: number) => {
    liveX.current = latestX
  }, [])

  /**
   * Hover freeze: the cat stops right where it is and waits while the cursor
   * is over it (so it never walks away from a click); on leave it strolls
   * home after a short beat.
   */
  const setHold = useCallback(
    (hold: boolean) => {
      if (holdRef.current === hold) return
      holdRef.current = hold
      if (hold) {
        clearActTimer()
        const p = phaseRef.current
        if (p === 'stroll' || p === 'return') {
          // Soft stop at the real current position, turn to face the user.
          setMoveDuration(0.15)
          setPhase('pause')
          setX(Math.round(liveX.current))
          setFacing('right')
        } else if (p === 'rub') {
          setPhase('home')
        }
      } else {
        actTimer.current = setTimeout(() => {
          if (busyRef.current || holdRef.current) return
          if (phaseRef.current === 'pause') goHome(false)
          else if (phaseRef.current === 'home') scheduleNextAct()
        }, 800)
      }
    },
    [goHome, scheduleNextAct],
  )

  // Busy → hurry home / wake up; free again → resume idle scheduling.
  useEffect(() => {
    if (busy) {
      clearActTimer()
      const p = phaseRef.current
      if (p === 'stroll' || p === 'pause') goHome(true)
      else if (p === 'rub' || p === 'sleep') setPhase('home')
    } else {
      scheduleNextAct()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, walkingEnabled])

  // User-activity tracking: wakes from sleep, feeds the sleep timer.
  useEffect(() => {
    const onActivity = () => {
      lastActivity.current = Date.now()
      if (phaseRef.current === 'sleep') {
        setPhase('home')
        scheduleNextAct()
      }
    }
    const events: Array<keyof WindowEventMap> = [
      'pointerdown',
      'pointermove',
      'keydown',
      'wheel',
      'touchstart',
    ]
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    return () => events.forEach((e) => window.removeEventListener(e, onActivity))
  }, [scheduleNextAct])

  // Sleep watcher (a hovered cat is being watched — it doesn't doze off).
  useEffect(() => {
    if (!sleepEnabled) return
    const id = setInterval(() => {
      if (
        !busyRef.current &&
        !pausedRef.current &&
        !holdRef.current &&
        phaseRef.current === 'home' &&
        Date.now() - lastActivity.current > SLEEP_AFTER_MS
      ) {
        clearActTimer()
        setPhase('sleep')
      }
    }, 10_000)
    return () => clearInterval(id)
  }, [sleepEnabled])

  // Cleanup.
  useEffect(() => () => clearActTimer(), [])

  const visual: MascotBehaviorVisual =
    phase === 'stroll' || phase === 'return'
      ? 'walk'
      : phase === 'sleep'
        ? 'sleep'
        : phase === 'rub'
          ? 'rub'
          : null

  return { visual, x, moveDuration, facing, onArrive, onMove, setHold }
}
