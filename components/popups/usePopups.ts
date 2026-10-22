'use client'

/**
 * components/popups/usePopups.ts — binds PopupController to the page: the
 * pathname, focus (a window waits while the user types), Realtime
 * (comm_messages of the user's conversation, RLS keeps it to his own) and the
 * tab visibility. All rules live in the controller.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { PopupCandidate, PopupSnoozeDays } from '@/lib/popups/types'
import { PopupController, isTextEntry } from './popupController'

export interface UsePopups {
  popups: PopupCandidate[]
  /** The window to draw now (null: nothing yet / quiet period / user is typing / suppressed page). */
  current: PopupCandidate | null
  dismiss: (id: string) => Promise<void>
  snooze: (id: string, days: PopupSnoozeDays) => Promise<void>
  markSeen: (id: string) => Promise<void>
  reply: (id: string, body: string) => Promise<void>
  /** «Открыть» on an insight / a recommendation. */
  act: (id: string) => Promise<void>
}

function userIsTyping(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el || el.closest?.('[data-popup-layer]')) return false
  return isTextEntry(el)
}

function subscribeRealtime(threadId: string, onRow: (row: Record<string, unknown>) => void): () => void {
  try {
    const sb = createClient()
    const channel = sb
      .channel(`popups-${threadId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comm_messages', filter: `thread_id=eq.${threadId}` }, (payload) => {
        onRow((payload.new ?? {}) as Record<string, unknown>)
      })
      .subscribe()
    return () => { void sb.removeChannel(channel) }
  } catch {
    // No Realtime (blocked / misconfigured): the 2-minute poll still delivers.
    return () => {}
  }
}

export function usePopups(): UsePopups {
  const pathname = usePathname() ?? '/'
  const ctrl = useMemo(() => new PopupController({
    fetchFn: (...a) => fetch(...a),
    isTyping: userIsTyping,
    isVisible: () => document.visibilityState === 'visible',
    subscribe: subscribeRealtime,
  }), [])

  useEffect(() => {
    ctrl.start()
    const onIn = () => ctrl.refresh()
    // On focusout the next element is not focused yet: look after the event.
    const onOut = () => { setTimeout(() => ctrl.refresh(), 0) }
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => {
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
      ctrl.stop()
    }
  }, [ctrl])

  useEffect(() => { void ctrl.setRoute(pathname) }, [ctrl, pathname])

  const snap = useSyncExternalStore(ctrl.subscribe, ctrl.getSnapshot, ctrl.getSnapshot)
  const dismiss = useCallback((id: string) => ctrl.dismiss(id), [ctrl])
  const snooze = useCallback((id: string, days: PopupSnoozeDays) => ctrl.snooze(id, days), [ctrl])
  const markSeen = useCallback((id: string) => ctrl.markSeen(id), [ctrl])
  const reply = useCallback((id: string, body: string) => ctrl.reply(id, body), [ctrl])
  const act = useCallback((id: string) => ctrl.act(id), [ctrl])
  return { popups: snap.popups, current: snap.current, dismiss, snooze, markSeen, reply, act }
}
