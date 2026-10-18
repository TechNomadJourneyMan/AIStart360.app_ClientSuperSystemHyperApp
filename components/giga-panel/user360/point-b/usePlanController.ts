'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { PlanController, type PlanSnapshot } from './planController'

/** One controller per client: the plan panel and the goal panel share it. */
export function usePlanController(userId: string): { ctl: PlanController; snap: PlanSnapshot } {
  const ctl = useMemo(() => new PlanController(userId, (input, init) => fetch(input, init)), [userId])
  useEffect(() => { void ctl.load() }, [ctl])
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)
  return { ctl, snap }
}
