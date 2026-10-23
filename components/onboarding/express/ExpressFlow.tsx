'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import DocumentSuggestions from '@/components/onboarding/DocumentSuggestions'
import { useSurveyAnswers } from '@/hooks/useSurveyAnswers'
import { track } from '@/lib/events/client'
import { expressPages, firstOpenPage } from '@/lib/survey/express'
import { ExpressScreen } from './ExpressScreen'
import { ModeTwoChrome } from './ModeTwoChrome'

const startedKey = (uid: string) => `aistart360_express_started:${uid}`
const PHONE = '(max-width: 639px)'

/**
 * The express flow (spec 2026-10-23 §7.1–7.2): 15 screens, saved with the
 * path «express» (local draft + autosave, explicit save on «Далее»).
 * «Готово — показать снимок»: explicit save → POST /api/v1/survey/express/complete
 * (event + the assigned expert; NOT «анкета заполнена») → the primary Point A
 * recalculation → «Снимок бизнеса». `?screen=N` / `?key=` open a given question.
 */
export function ExpressFlow() {
  const survey = useSurveyAnswers('express')
  const router = useRouter()
  const params = useSearchParams()
  const [phone, setPhone] = useState(false)
  const pages = useMemo(() => expressPages({ oneQuestionPerHardScreen: phone }), [phone])
  const [index, setIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const screenRef = useRef<number>(1)

  useEffect(() => {
    const mq = window.matchMedia(PHONE)
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // Where to start: an asked question, else the first open one.
  useEffect(() => {
    if (!survey.loaded || index !== null) return
    const key = params.get('key')
    const screen = Number(params.get('screen'))
    const byKey = key ? pages.findIndex((p) => p.questions.some((q) => q.key === key)) : -1
    const byScreen = Number.isInteger(screen) ? pages.findIndex((p) => p.screen === screen) : -1
    setIndex(byKey >= 0 ? byKey : byScreen >= 0 ? byScreen : firstOpenPage(pages, survey.answers))
  }, [survey.loaded, survey.answers, index, pages, params])

  // The phone layout splits hard screens: stay on the same screen when it changes.
  useEffect(() => {
    if (index === null) return
    const i = pages.findIndex((p) => p.screen === screenRef.current)
    if (i >= 0 && pages[index]?.screen !== screenRef.current) setIndex(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages])

  // Screen 1: the company name comes from the company card when the answer is empty (spec §7.1).
  const prefilled = useRef(false)
  useEffect(() => {
    if (!survey.loaded || prefilled.current) return
    prefilled.current = true
    const name = survey.answers.s1_company_name
    if (survey.companyName && !(typeof name === 'string' && name.trim())) survey.change('s1_company_name', survey.companyName)
  }, [survey])

  // SURVEY_EXPRESS_STARTED once (per browser), and when it started (minutes to «Готово»).
  useEffect(() => {
    if (!survey.loaded || !survey.userId) return
    try {
      if (!window.localStorage.getItem(startedKey(survey.userId))) {
        window.localStorage.setItem(startedKey(survey.userId), String(Date.now()))
        track('SURVEY_EXPRESS_STARTED')
      }
    } catch { /* storage unavailable */ }
  }, [survey.loaded, survey.userId])

  const page = index === null ? null : pages[Math.min(index, pages.length - 1)]
  useEffect(() => { if (page) screenRef.current = page.screen }, [page])

  const go = (i: number) => {
    setIndex(Math.max(0, Math.min(pages.length - 1, i)))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const next = async () => {
    if (index === null) return
    setBusy(true)
    const r = await survey.save()
    setBusy(false)
    if (r.ok) go(index + 1)
  }

  const finish = async () => {
    // Point A belongs to a company: without its name there is nothing to calculate it for.
    const name = survey.answers.s1_company_name
    if (!survey.companyId && !(typeof name === 'string' && name.trim())) {
      setNote('Укажите название компании — без него Точку А не посчитать.')
      go(0)
      return
    }
    setNote(null)
    setBusy(true)
    const r = await survey.save()
    if (!r.ok) { setBusy(false); return }
    let minutes: number | null = null
    try {
      const started = survey.userId ? Number(window.localStorage.getItem(startedKey(survey.userId))) : 0
      if (started > 0) minutes = (Date.now() - started) / 60000
    } catch { /* storage unavailable */ }
    await fetch('/api/v1/survey/express/complete', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes }),
    }).catch(() => undefined)
    // The primary Point A: the ordinary recalculation (the snapshot polls for it).
    void fetch('/api/v1/diagnostics/recalculate', {
      method: 'POST', credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).catch(() => undefined)
    router.push(`/client/onboarding/snapshot?fresh=${Date.now()}`)
  }

  return (
    <ModeTwoChrome survey={survey} current="express">
      {!page ? (
        <div className="flex items-center justify-center rounded-2xl border border-white/[0.06] p-10" aria-busy="true">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      ) : (<>
        {note && <p role="alert" className="mb-4 rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-xs text-on-surface">{note}</p>}
        <ExpressScreen
          key={page.index}
          page={page}
          answers={survey.answers}
          onChange={(k, v) => survey.change(k, v)}
          onBack={page.index > 0 ? () => go(page.index - 1) : undefined}
          onNext={() => void next()}
          onSkip={() => go(page.index + 1)}
          onFinish={() => void finish()}
          last={page.index === pages.length - 1}
          busy={busy}
          fieldIssue={survey.fieldIssue}
          suggestions={<DocumentSuggestions step={page.questions[0]?.step ?? 1} keys={page.questions.map((q) => q.key)} answers={survey.answers} onApply={(k, v) => survey.change(k, v, 'document')} />}
        />
      </>)}
    </ModeTwoChrome>
  )
}
