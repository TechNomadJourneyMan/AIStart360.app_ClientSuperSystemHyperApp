'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
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

interface DocumentRow {
  id: string
  file_name: string
  doc_type?: string
  parse_status?: string
  file_size?: number
  uploaded_at?: string
}

interface Props {
  userId: string | null
}

const PARSE_LABEL: Record<string, { label: string; color: string }> = {
  queued:     { label: 'в очереди', color: 'text-on-surface-variant' },
  parsing:    { label: 'обработка', color: 'text-amber-400' },
  ai_extract: { label: 'AI извлечение', color: 'text-violet-400' },
  parsed:     { label: 'готово',  color: 'text-primary' },
  failed:     { label: 'ошибка',  color: 'text-error' },
}

function fmtBytes(n?: number) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * MyDataSection — survey answers grouped by step + uploaded documents list.
 * Mounted as an anchored section inside /client/point-a (#my-data).
 * Self-fetches its own data; degrades quietly on missing data.
 */
export default function MyDataSection({ userId }: Props) {
  const [survey, setSurvey] = useState<SurveyData | null>(null)
  const [company, setCompany] = useState<CompanyData | null>(null)
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const [surveyRes, companyRes, docsRes] = await Promise.all([
          fetch(`/api/v1/onboarding/survey?user_id=${userId}`, { credentials: 'include' }),
          fetch(`/api/v1/onboarding/company?user_id=${userId}`, { credentials: 'include' }),
          fetch(`/api/v1/onboarding/documents?user_id=${userId}`, { credentials: 'include' }),
        ])
        const sJ = await surveyRes.json().catch(() => null)
        const cJ = await companyRes.json().catch(() => null)
        const dJ = await docsRes.json().catch(() => null)
        if (cancelled) return
        if (sJ?.ok) setSurvey(sJ.data)
        if (cJ?.ok) setCompany(cJ.data)
        if (dJ?.ok && Array.isArray(dJ.data)) setDocuments(dJ.data as DocumentRow[])
      } catch {
        // silent — section is optional
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [userId])

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
  const completedSteps = survey?.completed_steps?.sort((a, b) => a - b) ?? []
  const hasSurveyData = completedSteps.length > 0

  if (loading) {
    return (
      <section id="my-data" className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-primary">folder_managed</span>
          <h2 className="font-headline text-lg font-bold text-on-surface">Мои данные</h2>
        </div>
        <div className="rounded-2xl bg-surface-container-low border border-white/[0.06] p-8 text-center text-xs text-on-surface-variant">
          Загрузка данных…
        </div>
      </section>
    )
  }

  return (
    <section id="my-data" className="space-y-4 scroll-mt-20">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-outline-variant/10 pb-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">folder_managed</span>
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">Мои данные</h2>
            <p className="text-xs text-on-surface-variant">
              Анкета и загруженные документы. Кликните «Редактировать» для перехода к нужному шагу.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/client/onboarding"
            className="inline-flex items-center gap-1 text-[11px] font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] hover:border-primary/30 rounded-lg px-2.5 py-1.5 transition-all"
          >
            <span className="material-symbols-outlined text-[14px]">edit_note</span>
            Анкета
          </Link>
          <Link
            href="/client/onboarding/documents"
            className="inline-flex items-center gap-1 text-[11px] font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] hover:border-primary/30 rounded-lg px-2.5 py-1.5 transition-all"
          >
            <span className="material-symbols-outlined text-[14px]">upload_file</span>
            Документы
          </Link>
        </div>
      </div>

      {/* Documents */}
      <div className="rounded-2xl bg-surface-container-low border border-white/[0.06] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-primary">folder_open</span>
            <h3 className="text-sm font-bold text-on-surface">Загруженные документы</h3>
            <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
              {documents.length}
            </span>
          </div>
          <Link
            href="/client/onboarding/documents"
            className="text-[11px] font-mono text-primary/80 hover:text-primary flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
            Загрузить
          </Link>
        </div>
        {documents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.08] p-5 text-center">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant/30 block mb-1">
              cloud_upload
            </span>
            <p className="text-xs text-on-surface-variant">
              Загрузите P&L, отчёты или базу клиентов — AI добавит реальные метрики в Точку А.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {documents.map((d) => {
              const ps = PARSE_LABEL[d.parse_status ?? 'queued'] ?? PARSE_LABEL.queued
              return (
                <li
                  key={d.id}
                  className="flex items-center gap-2 bg-surface-container rounded-lg border border-white/[0.04] p-2.5"
                >
                  <span className="material-symbols-outlined text-base text-primary/60 flex-shrink-0">
                    description
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-on-surface truncate">{d.file_name}</p>
                    <p className="text-[10px] font-mono text-on-surface-variant/70">
                      {d.doc_type ? `${d.doc_type} · ` : ''}
                      {fmtBytes(d.file_size)}
                    </p>
                  </div>
                  <span className={`text-[10px] font-mono ${ps.color} whitespace-nowrap`}>
                    {ps.label}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Company tile */}
      {company?.name && (
        <div className="rounded-2xl bg-surface-container-low border border-white/[0.06] p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-primary">business</span>
          </div>
          <div>
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Компания</p>
            <p className="text-sm font-bold text-on-surface">{company.name}</p>
          </div>
        </div>
      )}

      {/* Survey steps */}
      {!hasSurveyData ? (
        <div className="rounded-2xl bg-surface-container-low border border-dashed border-white/[0.1] p-6 text-center">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant/30 block mb-2">
            assignment
          </span>
          <p className="text-sm text-on-surface mb-1">Анкета ещё не заполнена</p>
          <Link
            href="/client/onboarding"
            className="inline-flex items-center gap-1.5 mt-2 text-xs font-mono text-primary border border-primary/30 hover:border-primary/60 px-3 py-1.5 rounded-lg transition-all"
          >
            <span className="material-symbols-outlined text-sm">edit_note</span>
            Заполнить анкету
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {completedSteps.map((step) => {
            const fields = stepGroups[step]
            if (!fields?.length) return null
            return (
              <div
                key={step}
                className="rounded-2xl bg-surface-container-low border border-white/[0.06] p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-primary/15 flex items-center justify-center">
                      <span className="text-[11px] font-bold text-primary">{step}</span>
                    </div>
                    <h3 className="text-sm font-bold text-on-surface">
                      {SURVEY_STEP_LABELS[step] || `Шаг ${step}`}
                    </h3>
                  </div>
                  <Link
                    href={`/client/onboarding?step=${step}`}
                    className="text-[11px] text-primary/70 hover:text-primary transition-colors flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-sm">edit</span>
                    Редактировать
                  </Link>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  {fields.map((f) => (
                    <div key={f.key} className="flex flex-col">
                      <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">
                        {f.label}
                      </span>
                      <span className="text-sm text-on-surface mt-0.5">{f.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          {completedSteps.length < 12 && (
            <div className="rounded-xl bg-amber-500/[0.05] border border-amber-500/15 p-3 flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-amber-400">
                Заполнено {completedSteps.length} из 12 шагов.
              </p>
              <Link
                href="/client/onboarding"
                className="text-[11px] font-mono text-amber-300 hover:text-amber-200 underline"
              >
                Продолжить заполнение →
              </Link>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
