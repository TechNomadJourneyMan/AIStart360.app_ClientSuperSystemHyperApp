'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { track } from '@/lib/events/client'

/**
 * Wraps calculations (components/survey/FieldCalc) and reports
 * SURVEY_CALC_EXPANDED when «Как посчитано» is opened (spec §15). `toggle`
 * does not bubble, so it is caught in the capture phase.
 */
export function CalcTracker({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onToggle = (e: Event) => {
      const d = e.target as HTMLDetailsElement | null
      if (!d || d.tagName !== 'DETAILS' || !d.open) return
      const calc = d.closest('[data-calc]')?.getAttribute('data-calc')
      if (calc) track('SURVEY_CALC_EXPANDED', { metadata: { calc } })
    }
    el.addEventListener('toggle', onToggle, true)
    return () => el.removeEventListener('toggle', onToggle, true)
  }, [])
  return <div ref={ref}>{children}</div>
}
