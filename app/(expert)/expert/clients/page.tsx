'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { getAvatarGradient, getInitials } from '@/lib/expert-blocks'
import { SurveyStatusChips } from '@/components/survey/SurveyStatusChips'
import {
  SURVEY_STATUS_FILTERS, SURVEY_STATUS_FILTER_LABELS, countBySurveyFilter, matchesSurveyFilter,
  type SurveyStaffStatus, type SurveyStatusFilter,
} from '@/lib/survey/staff-status'

interface ExpertClient {
  id: string
  fullName: string | null
  email: string | null
  avatarUrl: string | null
  status: string | null
  createdAt: string | null
  companyName: string | null
  industry: string | null
  stage: string | null
  overallScore: number | null
  healthIndex: number | null
  calculatedAt: string | null
  commentsCount: number
  /** The questionnaire status (survey Ф5): mode, express, full submitted; null when unknown. */
  survey?: SurveyStaffStatus | null
}

function scoreBadgeClass(score: number | null): string {
  if (score === null) return 'bg-white/[0.05] text-on-surface-variant border-white/[0.06]'
  if (score < 30) return 'bg-error/10 text-error border-error/20'
  if (score < 60) return 'bg-amber-500/10 text-amber-300 border-amber-500/20'
  return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
}

function ClientCard({ client }: { client: ExpertClient }) {
  const displayName = client.companyName ?? client.fullName ?? client.email ?? 'Клиент'
  const subtitle = client.companyName && client.fullName ? client.fullName : client.email ?? '—'
  const gradient = getAvatarGradient(client.id)
  const initials = getInitials(displayName)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
    >
      <Link
        href={`/expert/clients/${client.id}`}
        className="block rounded-2xl bg-surface-container-low border border-white/[0.04] p-4 hover:border-primary/25 hover:bg-white/[0.04] transition-all"
      >
        <div className="flex items-start gap-3 mb-3">
          {client.avatarUrl ? (
            <img
              src={client.avatarUrl}
              alt={displayName}
              className="w-11 h-11 rounded-xl object-cover border border-white/[0.08] flex-shrink-0"
            />
          ) : (
            <div
              className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradient} border border-white/[0.08] flex items-center justify-center text-sm font-bold text-on-surface flex-shrink-0`}
            >
              {initials}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-on-surface truncate">
              {displayName}
            </p>
            <p className="text-[11px] text-on-surface-variant truncate">
              {subtitle}
            </p>
          </div>

          <span
            className={`text-[10px] font-bold px-2 py-1 rounded-full border ${scoreBadgeClass(client.overallScore)}`}
          >
            {client.overallScore ?? '—'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {client.industry && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.06] text-on-surface-variant">
              {client.industry}
            </span>
          )}
        </div>
        {client.survey && <div className="mb-3"><SurveyStatusChips status={client.survey} size="xs" /></div>}

        <div className="flex items-center justify-between text-[11px] text-on-surface-variant">
          <span className="inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">chat</span>
            {client.commentsCount} коммент.
          </span>
          <span className="inline-flex items-center gap-1 text-primary">
            Открыть
            <span className="material-symbols-outlined text-[14px]">
              arrow_forward
            </span>
          </span>
        </div>
      </Link>
    </motion.div>
  )
}

export default function ExpertClientsPage() {
  const [clients, setClients] = useState<ExpertClient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [surveyFilter, setSurveyFilter] = useState<SurveyStatusFilter>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/expert/clients')
      if (!res.ok) throw new Error('Не удалось загрузить клиентов')
      const json = (await res.json()) as { data?: ExpertClient[] }
      setClients(json.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const surveyCounts = useMemo(() => countBySurveyFilter(clients), [clients])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const bySurvey = clients.filter((c) => matchesSurveyFilter(c.survey, surveyFilter))
    if (!q) return bySurvey
    return bySurvey.filter((c) => {
      return (
        (c.companyName ?? '').toLowerCase().includes(q) ||
        (c.fullName ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q) ||
        (c.industry ?? '').toLowerCase().includes(q)
      )
    })
  }, [clients, search, surveyFilter])

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">
            Expert Portal
          </p>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface">
            Клиенты
          </h1>
          <p className="text-on-surface-variant mt-1.5 text-sm">
            Все клиенты платформы — оставляйте комментарии
          </p>
        </div>

        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.05] border border-white/[0.06] text-on-surface-variant hover:text-primary hover:bg-white/[0.08] text-xs px-3 py-2 transition-all disabled:opacity-50"
        >
          <span
            className={`material-symbols-outlined text-[14px] ${loading ? 'animate-spin' : ''}`}
          >
            refresh
          </span>
          Обновить
        </button>
      </header>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <span className="material-symbols-outlined text-[16px] absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
            search
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по имени, компании, email..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface-container-low border border-white/[0.06] text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:border-primary/40 transition-all"
          />
        </div>
        <div className="text-xs text-on-surface-variant">
          Всего: {clients.length}
          {(search || surveyFilter !== 'all') && ` · найдено: ${filtered.length}`}
        </div>
      </div>

      {/* The questionnaire (survey Ф5): who has not submitted the full questionnaire, who stopped after the express. */}
      <div role="group" aria-label="Анкета" className="flex flex-wrap items-center gap-1.5">
        {SURVEY_STATUS_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={surveyFilter === f}
            onClick={() => setSurveyFilter(f)}
            className={`min-h-[36px] rounded-xl border px-3 text-xs transition-all ${
              surveyFilter === f
                ? 'border-primary/30 bg-primary/15 text-primary'
                : 'border-white/[0.06] bg-white/[0.03] text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {SURVEY_STATUS_FILTER_LABELS[f]} · {surveyCounts[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-2xl bg-surface-container-low border border-white/[0.04] py-20 flex items-center justify-center gap-2 text-on-surface-variant text-sm">
          <span className="material-symbols-outlined text-[18px] animate-spin">
            progress_activity
          </span>
          Загрузка клиентов...
        </div>
      ) : error ? (
        <div className="rounded-2xl bg-error/5 border border-error/20 p-6 text-sm text-error">
          {error}
          <button onClick={load} className="block mt-2 text-xs text-primary hover:underline">
            Попробовать снова
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-surface-container-low border border-white/[0.04] border-dashed py-20 text-center">
          <span className="material-symbols-outlined text-[32px] text-on-surface-variant/50">
            groups
          </span>
          <p className="text-sm text-on-surface-variant mt-2">
            {clients.length === 0 ? 'Клиентов пока нет' : 'Нет совпадений'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((c) => (
            <ClientCard key={c.id} client={c} />
          ))}
        </div>
      )}
    </div>
  )
}
