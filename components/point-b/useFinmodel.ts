'use client'

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { FinmodelController, previewFetch, type FinmodelSnapshot, type FinmodelStateView } from './finmodelController'

/**
 * One controller per mount of the «Финмодель» tab (the tab is mounted when it is first opened).
 * `onSaved` runs after a successful save — the page reloads the calculation from the new money.
 * `preview` serves a fixture instead of the network (/dev/point-b-preview).
 */
export function useFinmodel(opts: { onSaved?: () => void; preview?: FinmodelStateView } = {}): { ctl: FinmodelController; snap: FinmodelSnapshot } {
  const onSaved = useRef(opts.onSaved)
  onSaved.current = opts.onSaved
  const ctl = useMemo(
    () => new FinmodelController(opts.preview ? previewFetch(opts.preview) : (input, init) => fetch(input, init), { onSaved: () => onSaved.current?.() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  useEffect(() => { void ctl.load() }, [ctl])
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)
  return { ctl, snap }
}
