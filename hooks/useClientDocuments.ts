'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchClientDocuments, type ClientDocument } from '@/lib/documents/client-upload'
import { isDocumentInFlight } from '@/lib/documents/status-view'

/** How often the list is re-read while a document is queued or processing. */
export const DOCUMENTS_POLL_MS = 5_000

/** Window event: a document was added / reprocessed somewhere on the page. */
export const DOCUMENTS_CHANGED_EVENT = 'aistart360:documents-changed'

/** Tell every mounted documents list (FileArea, «Мои данные», …) to re-read. */
export function notifyDocumentsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DOCUMENTS_CHANGED_EVENT))
}

/**
 * The signed-in client's documents (GET /api/v1/onboarding/documents) with
 * live processing states: while any document is queued/processing the list is
 * re-read every `pollMs`; polling stops when none is in flight, while the tab
 * is hidden, and on unmount.
 *
 * Deliberately not React Query: the app persists the query cache to
 * localStorage, and document rows (parsed_data) must not be written there.
 */
export function useClientDocuments({ enabled = true, pollMs = DOCUMENTS_POLL_MS }: { enabled?: boolean; pollMs?: number } = {}) {
  const [documents, setDocuments] = useState<ClientDocument[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const pending = useRef(false)
  const rerun = useRef(false)
  const seq = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (pending.current) {
      // One request at a time; a refresh asked for meanwhile runs right after,
      // so a change made during the request is not missed.
      rerun.current = true
      return
    }
    pending.current = true
    const mine = ++seq.current
    try {
      const res = await fetchClientDocuments()
      // A newer local change (upsert/remove) or unmount wins over this response.
      if (!mounted.current || mine !== seq.current) return
      if (res.ok) {
        setDocuments(res.documents)
        setError(null)
      } else {
        setError(res.error)
      }
    } finally {
      pending.current = false
      if (mounted.current) setLoading(false)
      if (rerun.current && mounted.current) {
        rerun.current = false
        void refresh()
      }
    }
  }, [])

  useEffect(() => {
    if (enabled) void refresh()
    else setLoading(false)
  }, [enabled, refresh])

  useEffect(() => {
    if (!enabled) return
    const onChanged = () => { void refresh() }
    window.addEventListener(DOCUMENTS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(DOCUMENTS_CHANGED_EVENT, onChanged)
  }, [enabled, refresh])

  const hasInFlight = documents.some(isDocumentInFlight)

  useEffect(() => {
    if (!enabled || !hasInFlight) return
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void refresh()
    }, pollMs)
    return () => clearInterval(timer)
  }, [enabled, hasInFlight, pollMs, refresh])

  /** Put a document returned by an upload / reprocess into the list right away. */
  const upsert = useCallback((doc: ClientDocument) => {
    seq.current += 1
    setDocuments((prev) => {
      const i = prev.findIndex((d) => d.id === doc.id)
      if (i === -1) return [doc, ...prev]
      const next = prev.slice()
      next[i] = { ...prev[i], ...doc }
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    seq.current += 1
    setDocuments((prev) => prev.filter((d) => d.id !== id))
  }, [])

  return { documents, loading, error, refresh, upsert, remove, hasInFlight }
}
