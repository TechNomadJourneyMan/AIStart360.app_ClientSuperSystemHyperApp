'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { WhatIfController, whatIfPreviewFetch, type WhatIfPreviewData, type WhatIfSnapshot } from './whatIfController'

/**
 * One controller per mount of the «Что если» tab (mounted when the tab is first opened). Closing the page stops
 * the timer and the request in flight. `preview` serves a fixture instead of the network (/dev/point-b-preview).
 */
export function useWhatIf(opts: { preview?: WhatIfPreviewData } = {}): { ctl: WhatIfController; snap: WhatIfSnapshot } {
  const ctl = useMemo(
    () => new WhatIfController(
      opts.preview ? whatIfPreviewFetch(opts.preview) : (input, init) => fetch(input, init),
      { initialChanges: opts.preview?.changes },
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  useEffect(() => {
    void ctl.init()
    return () => ctl.dispose()
  }, [ctl])
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)
  return { ctl, snap }
}
