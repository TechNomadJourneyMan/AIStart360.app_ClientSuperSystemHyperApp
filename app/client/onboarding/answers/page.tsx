'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { SurveyAnswersView } from '@/components/onboarding/answers/SurveyAnswersView'
import { toAnswerEnvelope } from '@/lib/survey/answer-value'
import { parseAnswerFilters } from '@/lib/survey/answers-view'
import { surveyQuestion } from '@/lib/survey/questions'
import { track } from '@/lib/events/client'
import type { AnswerAttribution } from '@/lib/survey/attribution-label'

/**
 * «Мои ответы» (spec 2026-10-23 §6.2): every answer of the questionnaire on one
 * page — filters, search, the author and path of each answer, editing in
 * place (saved through the same POST as the wizard, path «full»), print and PDF.
 */
export default function SurveyAnswersPage() {
  return (
    <Suspense fallback={null}>
      <AnswersInner />
    </Suspense>
  )
}

interface Loaded {
  answers: Record<string, unknown>
  attribution: Record<string, AnswerAttribution>
}

const VIEWER = { viewerIsOwner: true } as const

function AnswersInner() {
  const params = useSearchParams()
  const initialFilters = useMemo(() => parseAnswerFilters(params.get('filter')), [params])
  const [data, setData] = useState<Loaded | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/onboarding/survey', { credentials: 'include' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      setData({ answers: json.data?.answers ?? {}, attribution: json.data?.attribution ?? {} })
      setError(null)
    } catch {
      setError('Не удалось загрузить ответы. Обновите страницу.')
    }
  }, [])

  useEffect(() => {
    void load()
    fetch('/api/v1/onboarding/company', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (j?.ok && j.data?.id) setCompanyId(String(j.data.id)) })
      .catch(() => {})
    track('SURVEY_ANSWERS_VIEWED', { metadata: { filter: initialFilters.join(',') || 'all' } })
    // Once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One answer, saved explicitly through the wizard's own route: validation,
  // profanity, «год = месяц × 12», goal sync, author and path «full».
  const save = useCallback(async (key: string, value: unknown) => {
    const q = surveyQuestion(key)
    if (!q) return { ok: false as const, error: 'Неизвестный вопрос' }
    try {
      const res = await fetch('/api/v1/onboarding/survey', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: q.step, answers: { [key]: toAnswerEnvelope(value) }, via: 'full', autosave: false }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) return { ok: false as const, error: json?.error || 'Не удалось сохранить. Попробуйте ещё раз.' }
      await load()
      return { ok: true as const }
    } catch {
      return { ok: false as const, error: 'Нет связи с сервером. Попробуйте ещё раз.' }
    }
  }, [load])

  return (
    <div className="survey-answers-print">
      {/* Print: only the answers, on white, one column. */}
      <style>{`@media print {
        body { background: #fff !important; }
        body * { visibility: hidden; }
        .survey-answers-print, .survey-answers-print * { visibility: visible; }
        .survey-answers-print { position: absolute; inset: 0 auto auto 0; width: 100%; }
      }`}</style>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 print:max-w-none print:p-0">
        <Link href="/client/onboarding" className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary print:hidden">
          <span className="material-symbols-outlined text-sm" aria-hidden="true">arrow_back</span> К анкете
        </Link>
        <div className="mb-5 mt-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 print:hidden">
            <span className="material-symbols-outlined text-lg text-primary" aria-hidden="true">fact_check</span>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary/60 print:hidden">Анкета</p>
            <h1 className="text-xl font-bold text-on-surface print:text-black">Мои ответы</h1>
          </div>
        </div>
        {error && <p role="alert" className="mb-4 rounded-xl border border-error/30 bg-error/[0.06] px-4 py-3 text-sm text-error">{error}</p>}
        {!data && !error && <p className="text-sm text-on-surface-variant">Загружаем ответы…</p>}
        {data && (
          <SurveyAnswersView
            answers={data.answers}
            attribution={data.attribution}
            viewer={VIEWER}
            mode="client"
            canEdit
            onSave={save}
            initialFilters={initialFilters}
            companyId={companyId}
            pdfHref="/api/export/report?type=survey"
          />
        )}
      </main>
    </div>
  )
}
