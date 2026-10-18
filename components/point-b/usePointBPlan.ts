'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { ClientPlanController, type ClientPlanSnapshot } from './planController'

/** One load per mount; the controller answers the cards' «Согласен» / «Не согласен». */
export function usePointBPlan(): { ctl: ClientPlanController; snap: ClientPlanSnapshot } {
  const ctl = useMemo(() => new ClientPlanController((input, init) => fetch(input, init)), [])
  useEffect(() => { void ctl.load() }, [ctl])
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)
  return { ctl, snap }
}
