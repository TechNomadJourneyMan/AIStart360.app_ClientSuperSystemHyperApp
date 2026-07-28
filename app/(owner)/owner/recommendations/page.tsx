'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Diagnostic, DiagnosticAiAnalysis } from '@/types/onboarding'

type LoadState = 'loading' | 'ready' | 'empty' | 'error'

function isPilotAnalysis(value: unknown): value is DiagnosticAiAnalysis {
  if (!value || typeof value !== 'object') return false
  const analysis = value as Partial<DiagnosticAiAnalysis>
  return (
    typeof analysis.executive_summary === 'string' &&
    Array.isArray(analysis.strengths) &&
    Array.isArray(analysis.risks) &&
    Array.isArray(analysis.action_plan) &&
    Array.isArray(analysis.questions) &&
    (analysis.source === 'ai' || analysis.source === 'rules')
  )
}

export default function OwnerRecommendationsPage() {
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null)
  const [analysis, setAnalysis] = useState<DiagnosticAiAnalysis | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Сессия не найдена')
      const response = await fetch(`/api/v1/diagnostics/current?user_id=${encodeURIComponent(user.id)}`)
      const payload = await response.json()
      if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? 'Ошибка загрузки')
      if (!payload.data) {
        setState('empty')
        return
      }
      const current = payload.data as Diagnostic
      setDiagnostic(current)
      setAnalysis(isPilotAnalysis(current.ai_analysis) ? current.ai_analysis : null)
      setState('ready')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить рекомендации')
      setState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const generate = async () => {
    if (!diagnostic) return
    setIsGenerating(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/diagnostics/${diagnostic.id}/explain`, { method: 'POST' })
      const payload = await response.json()
      if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? 'Не удалось сформировать рекомендации')
      setAnalysis(payload.data.analysis as DiagnosticAiAnalysis)
      setDiagnostic((current) => current ? { ...current, ai_status: payload.data.status } : current)
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Не удалось сформировать рекомендации')
    } finally {
      setIsGenerating(false)
    }
  }

  if (state === 'loading') {
    return <div className="flex min-h-[50vh] items-center justify-center text-sm text-on-surface-variant">Загружаем рекомендации...</div>
  }

  if (state === 'empty') {
    return (
      <section className="rounded-3xl border border-primary/20 bg-primary/10 p-8">
        <h1 className="text-2xl font-bold text-on-surface">Сначала нужна диагностика Point A</h1>
        <p className="mt-2 text-sm text-on-surface-variant">Заполните анкету — после расчёта здесь появится план действий.</p>
        <Link href="/owner/onboarding" className="mt-6 inline-flex rounded-xl bg-primary px-5 py-3 text-sm font-bold text-on-primary">
          Перейти к анкете
        </Link>
      </section>
    )
  }

  if (state === 'error') {
    return (
      <div role="alert" className="rounded-2xl border border-error/25 bg-error/10 p-5">
        <p className="text-sm text-error">{error}</p>
        <button onClick={() => void load()} className="mt-3 text-sm font-bold text-primary">Повторить</button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-primary/70">План действий</p>
          <h1 className="mt-2 text-3xl font-extrabold text-on-surface">Рекомендации по Point A</h1>
          <p className="mt-2 text-sm text-on-surface-variant">
            Оценки рассчитаны правилами. AI объясняет результат, но не меняет цифры.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={isGenerating}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-on-primary disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-lg">auto_awesome</span>
          {isGenerating ? 'Формируем...' : analysis ? 'Обновить рекомендации' : 'Сформировать рекомендации'}
        </button>
      </header>

      {error && <div role="alert" className="rounded-xl border border-error/25 bg-error/10 p-4 text-sm text-error">{error}</div>}

      {!analysis ? (
        <section className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
          <p className="text-on-surface">Результат Point A готов.</p>
          <p className="mt-2 text-sm text-on-surface-variant">Нажмите кнопку, чтобы получить управленческое объяснение и план на 30–90 дней.</p>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-white/[0.07] bg-surface-container-low p-6">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${
                analysis.source === 'ai' ? 'bg-primary/15 text-primary' : 'bg-amber-400/15 text-amber-300'
              }`}>
                {analysis.source === 'ai' ? 'AI-анализ' : 'Резервный расчёт по правилам'}
              </span>
              <span className="text-xs text-on-surface-variant">Point A: {diagnostic?.overall_score ?? '—'}/100</span>
            </div>
            <p className="mt-4 text-base leading-relaxed text-on-surface">{analysis.executive_summary}</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-on-surface">Приоритетный план</h2>
            <div className="mt-3 grid gap-3">
              {analysis.action_plan.map((item, index) => (
                <article key={`${item.action}-${index}`} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
                  <div className="flex items-start gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 font-mono text-sm font-bold text-primary">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="font-semibold text-on-surface">{item.action}</h3>
                      <p className="mt-2 text-sm text-on-surface-variant">{item.expected_result}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-lg bg-white/[0.04] px-2.5 py-1 text-on-surface-variant">Ответственный: {item.owner}</span>
                        <span className="rounded-lg bg-white/[0.04] px-2.5 py-1 text-on-surface-variant">Срок: {item.timeline}</span>
                      </div>
                      {item.evidence.length > 0 && (
                        <p className="mt-3 text-xs text-on-surface-variant/70">Основание: {item.evidence.join(' · ')}</p>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {analysis.risks.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-on-surface">Ключевые риски</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {analysis.risks.map((risk, index) => (
                  <article key={`${risk.title}-${index}`} className="rounded-2xl border border-error/15 bg-error/5 p-5">
                    <h3 className="font-semibold text-on-surface">{risk.title}</h3>
                    <p className="mt-2 text-sm text-on-surface-variant">{risk.impact}</p>
                    {risk.evidence.length > 0 && <p className="mt-3 text-xs text-on-surface-variant/70">{risk.evidence.join(' · ')}</p>}
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
