'use client'

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { StrategyEditor, type StrategySnapshot } from './strategyController'

/**
 * One editor per (client, version): a new version starts a new editor. When the version is reloaded from the server
 * (after a save, an approval…) the editor takes the stored tree unless there are unsaved edits.
 */
export function useStrategyEditor(
  userId: string, versionId: string, stored: unknown, editable: boolean, onSaved?: () => void,
): { ctl: StrategyEditor; snap: StrategySnapshot } {
  const saved = useRef(onSaved)
  saved.current = onSaved
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `stored` only seeds a new editor; later changes go through sync()
  const ctl = useMemo(() => new StrategyEditor(userId, versionId, stored, (input, init) => fetch(input, init), { editable, onSaved: () => saved.current?.() }), [userId, versionId, editable])
  useEffect(() => { ctl.sync(stored) }, [ctl, stored])
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)
  return { ctl, snap }
}
