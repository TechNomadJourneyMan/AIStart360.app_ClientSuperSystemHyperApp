'use client'

/**
 * useSurveyAnswers — the owner's questionnaire answers in a browser screen
 * (express flow, deepening blocks; spec 2026-10-23 §13). The logic lives in
 * lib/survey/answers-controller.ts (tested without a browser); this hook adds
 * the timers and the page lifecycle the wizard has:
 *   • local draft 400 ms after an edit, and on `pagehide` / unmount;
 *   • background autosave 2,5 s after the last edit;
 *   • retries 4 / 12 / 30 s after a failed save, and at once when the network returns;
 *   • a confirmation when the tab is closed with unsent edits.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SurveyAnswersController, type AnswerOrigin, type ControllerVia, type SaveResult, type SurveyAnswersState } from '@/lib/survey/answers-controller'

const DRAFT_DELAY_MS = 400
const AUTOSAVE_DELAY_MS = 2500
const RETRY_DELAYS_MS = [4000, 12000, 30000]

const EMPTY: SurveyAnswersState = {
  loaded: false, answers: {}, attribution: {}, companyId: null, companyName: null,
  saveState: 'idle', savedAt: null, error: null, fieldIssue: null, staleKeys: [], dirtyKeys: [],
}

export interface UseSurveyAnswers extends SurveyAnswersState {
  userId: string | null
  change: (key: string, value: unknown, origin?: AnswerOrigin) => void
  /** Explicit save («Далее», «Готово», switching modes). */
  save: () => Promise<SaveResult>
  dismissStale: () => void
}

export function useSurveyAnswers(via: ControllerVia): UseSurveyAnswers {
  const controllerRef = useRef<SurveyAnswersController | null>(null)
  const userIdRef = useRef<string | null>(null)
  const listenersRef = useRef(new Set<() => void>())
  const retryRef = useRef(0)

  // The controller exists once the user is known.
  const subscribe = useCallback((l: () => void) => {
    listenersRef.current.add(l)
    const off = controllerRef.current?.subscribe(l)
    return () => { listenersRef.current.delete(l); off?.() }
  }, [])
  const state = useSyncExternalStore(subscribe, () => controllerRef.current?.getState() ?? EMPTY, () => EMPTY)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data: { user } } = await createClient().auth.getUser().catch(() => ({ data: { user: null } }))
      if (cancelled) return
      if (!user) {
        // No session: a controller without storage shows the error and saves nothing.
        const c = new SurveyAnswersController({ userId: 'anonymous', via, fetch: (u, i) => fetch(u, i) })
        controllerRef.current = c
        for (const l of listenersRef.current) c.subscribe(l)
        await c.load()
        return
      }
      userIdRef.current = user.id
      const c = new SurveyAnswersController({ userId: user.id, via, fetch: (u, i) => fetch(u, i), storage: window.localStorage })
      controllerRef.current = c
      for (const l of listenersRef.current) c.subscribe(l)
      await c.load()
    })()
    return () => { cancelled = true }
  }, [via])

  // Local draft shortly after an edit; flushed when the page goes away.
  useEffect(() => {
    if (!state.loaded) return
    const id = setTimeout(() => controllerRef.current?.persistDraft(), DRAFT_DELAY_MS)
    return () => clearTimeout(id)
  }, [state.answers, state.loaded])
  useEffect(() => {
    const flush = () => controllerRef.current?.persistDraft()
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [])

  // Background autosave after a pause in typing.
  useEffect(() => {
    if (!state.loaded || state.dirtyKeys.length === 0 || state.saveState === 'error' || !userIdRef.current) return
    const id = setTimeout(() => { void controllerRef.current?.save({ autosave: true }) }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(id)
  }, [state.answers, state.loaded, state.dirtyKeys.length, state.saveState])

  // Retry a failed save with backoff, and at once when the network returns.
  useEffect(() => {
    if (state.saveState !== 'error') { if (state.saveState === 'saved') retryRef.current = 0; return }
    const retry = () => { void controllerRef.current?.save({ autosave: true }) }
    const delay = RETRY_DELAYS_MS[Math.min(retryRef.current, RETRY_DELAYS_MS.length - 1)]
    retryRef.current += 1
    const id = setTimeout(retry, delay)
    window.addEventListener('online', retry)
    return () => { clearTimeout(id); window.removeEventListener('online', retry) }
  }, [state.saveState])

  // Closing the tab with unsent edits asks first (the draft keeps them on this device only).
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (!controllerRef.current?.hasUnsaved) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  const change = useCallback((key: string, value: unknown, origin?: AnswerOrigin) => controllerRef.current?.change(key, value, origin), [])
  const save = useCallback(async (): Promise<SaveResult> => controllerRef.current?.save() ?? { ok: false, error: 'Ответы ещё загружаются' }, [])
  const dismissStale = useCallback(() => controllerRef.current?.dismissStale(), [])

  return useMemo(() => ({ ...state, userId: userIdRef.current, change, save, dismissStale }), [state, change, save, dismissStale])
}
