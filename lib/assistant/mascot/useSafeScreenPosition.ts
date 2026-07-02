'use client'

/**
 * lib/assistant/mascot/useSafeScreenPosition.ts — keep the mascot out of the way.
 *
 * Two responsibilities (ТЗ §5–§6):
 *   1. On-screen keyboard (mobile): when visualViewport shrinks below ~65% of
 *      the window, report `keyboardOpen` so the widget hides entirely until
 *      typing ends.
 *   2. Collisions: elements marked with [data-mascot-avoid] (critical CTA rows,
 *      wizard footers) are measured against the mascot's corner zone; when they
 *      overlap, the hook lifts the mascot just above the highest intruder.
 *
 * Measurement runs on mount, resize/scroll-end and on a lightweight interval-
 * free MutationObserver (childList only) — cheap enough for a fixed widget.
 */

import { useEffect, useState } from 'react'

export interface SafePosition {
  /** Extra px to add to the base `bottom` offset. 0 when the corner is free. */
  extraBottom: number
  /** True while the on-screen keyboard is likely open — hide the mascot. */
  keyboardOpen: boolean
}

/** The corner zone the mascot occupies (right-bottom), viewport-relative. */
const ZONE_WIDTH = 140
const ZONE_HEIGHT = 140
const LIFT_MARGIN = 8
const MAX_LIFT = 240

function measureLift(baseBottom: number): number {
  if (typeof document === 'undefined') return 0
  const vw = window.innerWidth
  const vh = window.innerHeight
  const zone = {
    left: vw - ZONE_WIDTH,
    top: vh - baseBottom - ZONE_HEIGHT,
    right: vw,
    bottom: vh - baseBottom,
  }
  let lift = 0
  const avoid = document.querySelectorAll<HTMLElement>('[data-mascot-avoid]')
  avoid.forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    const overlaps =
      r.left < zone.right && r.right > zone.left && r.top < zone.bottom && r.bottom > zone.top
    if (overlaps) {
      // Lift the mascot so its zone bottom clears the intruder's top.
      const needed = zone.bottom - r.top + LIFT_MARGIN
      lift = Math.max(lift, needed)
    }
  })
  return Math.min(Math.max(0, Math.round(lift)), MAX_LIFT)
}

/**
 * @param baseBottomPx the widget's default CSS bottom offset for the current
 *        breakpoint (e.g. 80 on mobile — above the bottom nav, 24 on lg).
 */
export function useSafeScreenPosition(baseBottomPx: number): SafePosition {
  const [extraBottom, setExtraBottom] = useState(0)
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    let raf = 0
    const remeasure = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setExtraBottom(measureLift(baseBottomPx)))
    }

    remeasure()
    window.addEventListener('resize', remeasure)

    // childList-only observer: cheap, catches wizard/CTA mount/unmount.
    const observer = new MutationObserver(remeasure)
    observer.observe(document.body, { childList: true, subtree: true })

    // On-screen keyboard heuristic via visualViewport.
    const vv = window.visualViewport
    const onViewport = () => {
      if (!vv) return
      setKeyboardOpen(vv.height < window.innerHeight * 0.65)
    }
    vv?.addEventListener('resize', onViewport)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', remeasure)
      observer.disconnect()
      vv?.removeEventListener('resize', onViewport)
    }
  }, [baseBottomPx])

  return { extraBottom, keyboardOpen }
}
