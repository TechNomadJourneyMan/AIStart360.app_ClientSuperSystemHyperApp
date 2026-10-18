'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { ScenariosController, type ScenariosSnapshot } from './scenariosController'

/** One controller per client; the panel resets nothing by itself — results are tagged with their version. */
export function useScenariosController(userId: string): { ctl: ScenariosController; snap: ScenariosSnapshot } {
  const ctl = useMemo(() => new ScenariosController(userId, (input, init) => fetch(input, init)), [userId])
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)
  return { ctl, snap }
}
