'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { PointBStateController, type PointBStateSnapshot } from './pointBStateController'

/** One load per mount: the model result («Обзор») and the approved scenarios («Сценарии»). */
export function usePointBState(): { ctl: PointBStateController; snap: PointBStateSnapshot } {
  const ctl = useMemo(() => new PointBStateController((input, init) => fetch(input, init)), [])
  useEffect(() => { void ctl.load() }, [ctl])
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)
  return { ctl, snap }
}
