'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import {
  SURVEY_LABELS,
  SURVEY_STEP_LABELS,
  formatSurveyValue,
  getStepFromKey,
} from '@/lib/survey-labels'

interface SurveyData {
  answers: Record<string, unknown>
  completed_steps: number[]
}

interface CompanyData {
  name?: string
  [key: string]: unknown
}

export default function MyDataPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [survey, setSurvey] = useState<SurveyData | null>(null)
  const [company, setCompany] = useState<CompanyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const sb = createClient()
    sb.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id
      if (uid) setUserId(uid)
      else setError('Не удалось определить пользователя')
    })
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    ;(async () => {
      try {
        const [surveyRes, companyRes] = await Promise.all([
          fetch(`/api/v1/onboarding/survey?user_id=${userId}`),
          fetch(`/api/v1/onboarding/company?user_id=${userId}`),
        ])

        const surveyJson = await surveyRes.json()
        const companyJson = await companyRes.json()

        if (!cancelled) {
          if (surveyJson.ok) setSurvey(surveyJson.data)
          if (companyJson.ok) setCompany(companyJson.data)
        }
      } catch {
        if (!cancelled) setError('Ошибка загрузки данных')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [userId])

  // Group answers by step
  const stepGroups: Record<number, { key: string; label: string; value: string }[]> = {}
  if (survey?.answers) {
    for (const [key, val] of Object.entries(survey.answers)) {
      const step = getStepFromKey(key)
      if (!step) continue
      if (!stepGroups[step]) stepGroups[step] = []
      stepGroups[step].push({
        key,
        label: SURVEY_LABELS[key] || key,
        value: formatSurveyValue(key, val),
      })
    }
  }

  const completedSteps = survey?.completed_steps?.sort() ?? []
  const hasData = completedSteps.length > 0

  return (
    <div className="min-h-screen bg-[#0A0B0F] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5 border-b border-white/[0.06]">
        <Image src="/logo.svg" alt="AIStart360" width={140} height={26} priority />
        <div className="flex items-center gap-3">
          <Link href="/client/dashboard"
            className="text-xs text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1">
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Назад
          </Link>
          <button onClick={() => { document.cookie = 'aistart360_role=; path=/; max-age=0'; window.location.href = '/login' }}
            className="text-xs text-red-400/70 hover:text-red-400 flex items-center gap-1 border border-red-500/10 px-2.5 py-1 rounded-lg transition-all">
            <span className="material-symbols-outlined text-sm">logout</span>
            Выход
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Мои данные</h1>
          <p className="text-sm text-slate-500 mt-1">
            Данные из вашей анкеты. Вы можете отредактировать их, перейдя к нужному шагу.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin mr-3" />
            <span className="text-sm text-slate-500">Загрузка данных...</span>
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-red-500/5 border border-red-500/15 p-8 text-center">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : !hasData ? (
          <div className="rounded-2xl bg-surface-container-low border border-white/[0.06] p-12 text-center space-y-4">
            <span className="material-symbols-outlined text-5xl text-slate-700">assignment</span>
            <p className="text-sm text-slate-400">Вы ещё не заполнили анкету</p>
            <Link
              href="/client/onboarding"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25 transition-all"
            >
              Заполнить анкету
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Company info */}
            {company?.name && (
              <div className="rounded-2xl bg-surface-container-low border border-white/[0.06] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-lg text-primary">business</span>
                  <h2 className="text-sm font-bold text-slate-200">Компания</h2>
                </div>
                <p className="text-sm text-slate-300">{company.name}</p>
              </div>
            )}

            {/* Survey steps */}
            {completedSteps.map((step) => {
              const fields = stepGroups[step]
              if (!fields?.length) return null
              return (
                <div
                  key={step}
                  className="rounded-2xl bg-surface-container-low border border-white/[0.06] p-5"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-primary/15 flex items-center justify-center">
                        <span className="text-[11px] font-bold text-primary">{step}</span>
                      </div>
                      <h2 className="text-sm font-bold text-slate-200">
                        {SURVEY_STEP_LABELS[step] || `Шаг ${step}`}
                      </h2>
                    </div>
                    <Link
                      href={`/client/onboarding?step=${step}`}
                      className="text-[11px] text-primary/70 hover:text-primary transition-colors flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-sm">edit</span>
                      Редактировать
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                    {fields.map((f) => (
                      <div key={f.key} className="flex flex-col">
                        <span className="text-[10px] text-slate-600 uppercase tracking-wider">
                          {f.label}
                        </span>
                        <span className="text-sm text-slate-300 mt-0.5">{f.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}

            {/* Incomplete steps hint */}
            {completedSteps.length < 6 && (
              <div className="rounded-2xl bg-amber-500/5 border border-amber-500/15 p-5 text-center">
                <p className="text-xs text-amber-400">
                  Заполнено {completedSteps.length} из 6 шагов.{' '}
                  <Link href="/client/onboarding" className="underline hover:text-amber-300">
                    Продолжить заполнение
                  </Link>
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
