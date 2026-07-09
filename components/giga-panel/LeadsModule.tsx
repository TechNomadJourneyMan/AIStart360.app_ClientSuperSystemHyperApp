'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  RefreshCw,
  Sparkles,
  Mail,
  CheckCircle2,
  Circle,
  ChevronDown,
  Users,
  Target,
  Gauge,
} from 'lucide-react'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface LeadBlockScore {
  key: string
  label: string
  score: number
}

interface Lead {
  id: string
  email: string
  overallScore: number
  source: string | null
  converted: boolean
  createdAt: string
  blockScores: LeadBlockScore[]
}

type LeadFilter = 'all' | 'new' | 'converted'

// ─── Helpers ────────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-300'
  if (score >= 40) return 'text-amber-300'
  return 'text-red-300'
}

function scoreBadge(score: number): string {
  if (score >= 70) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
  if (score >= 40) return 'bg-amber-500/15 text-amber-300 border-amber-500/20'
  return 'bg-red-500/15 text-red-300 border-red-500/20'
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return '—'
  }
}

// ─── KPI card ────────────────────────────────────────────────────────────────────

function LeadKpi({
  label,
  value,
  icon,
  accent,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  accent: string
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-4 bg-white/[0.04] border border-white/[0.07] backdrop-blur-sm">
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-3 ${accent}`}>
        {icon}
      </div>
      <p className="text-xl md:text-2xl font-bold text-slate-100 tabular-nums">{value}</p>
      <p className="text-[10px] md:text-xs text-slate-500 mt-1">{label}</p>
    </div>
  )
}

// ─── Lead row ────────────────────────────────────────────────────────────────────

function LeadRow({
  lead,
  onToggle,
  isToggling,
}: {
  lead: Lead
  onToggle: (lead: Lead) => void
  isToggling: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const weakest = useMemo(() => {
    if (!lead.blockScores.length) return null
    return [...lead.blockScores].sort((a, b) => a.score - b.score)[0]
  }, [lead.blockScores])

  return (
    <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-3 p-3 md:p-4">
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          disabled={!lead.blockScores.length}
          className="flex-shrink-0 text-slate-600 hover:text-slate-300 transition-colors disabled:opacity-30 disabled:cursor-default"
          aria-label="Показать блоки GRI"
        >
          <ChevronDown
            size={16}
            className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>

        {/* GRI score */}
        <div
          className={`flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center border font-bold tabular-nums text-sm ${scoreBadge(
            lead.overallScore,
          )}`}
        >
          {lead.overallScore}
        </div>

        {/* Email + meta */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-100 truncate">{lead.email}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[11px] text-slate-500">{formatDate(lead.createdAt)}</span>
            {lead.source && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.07] text-slate-400">
                {lead.source}
              </span>
            )}
            {lead.converted && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/20 text-emerald-300">
                Сконвертирован
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <a
            href={`mailto:${lead.email}`}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium text-slate-400 bg-white/[0.05] border border-white/[0.08] hover:text-slate-200 hover:bg-white/[0.08] transition-all"
          >
            <Mail size={13} />
            <span className="hidden md:inline">Написать</span>
          </a>
          <button
            onClick={() => onToggle(lead)}
            disabled={isToggling}
            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium border transition-all disabled:opacity-50 ${
              lead.converted
                ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/20 hover:bg-emerald-500/20'
                : 'text-slate-400 bg-white/[0.05] border-white/[0.08] hover:text-slate-200 hover:bg-white/[0.08]'
            }`}
          >
            {isToggling ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : lead.converted ? (
              <CheckCircle2 size={13} />
            ) : (
              <Circle size={13} />
            )}
            <span className="hidden md:inline">
              {lead.converted ? 'Сконвертирован' : 'В работу'}
            </span>
          </button>
        </div>
      </div>

      {/* Expanded block scores */}
      <AnimatePresence initial={false}>
        {expanded && lead.blockScores.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-white/[0.06]"
          >
            <div className="p-3 md:p-4">
              {weakest && (
                <p className="text-[11px] text-slate-500 mb-3">
                  Слабейший блок:{' '}
                  <span className="text-red-300 font-semibold">{weakest.label}</span> (
                  {weakest.score}/100)
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {lead.blockScores.map((b) => (
                  <div
                    key={b.key || b.label}
                    className="flex items-center gap-2 p-2 rounded-xl bg-white/[0.03] border border-white/[0.05]"
                  >
                    <span
                      className={`text-xs font-bold tabular-nums w-8 text-right ${scoreColor(
                        b.score,
                      )}`}
                    >
                      {b.score}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-slate-400 truncate">{b.label}</p>
                      <div className="h-1 mt-1 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            b.score >= 70
                              ? 'bg-emerald-500'
                              : b.score >= 40
                                ? 'bg-amber-500'
                                : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.max(0, Math.min(100, b.score))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Main module ────────────────────────────────────────────────────────────────

export function LeadsModule() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<LeadFilter>('all')
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const fetchLeads = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/giga-admin/leads')
      if (!res.ok) throw new Error('Ошибка загрузки лидов')
      const data = await res.json()
      setLeads(Array.isArray(data.leads) ? data.leads : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLeads()
  }, [fetchLeads])

  const toggleConverted = useCallback(
    async (lead: Lead) => {
      setTogglingId(lead.id)
      const next = !lead.converted
      // Optimistic update
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, converted: next } : l)),
      )
      try {
        const res = await fetch(`/api/giga-admin/leads/${lead.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ converted: next }),
        })
        if (!res.ok) throw new Error('patch failed')
      } catch {
        // Revert on failure
        setLeads((prev) =>
          prev.map((l) => (l.id === lead.id ? { ...l, converted: !next } : l)),
        )
      } finally {
        setTogglingId(null)
      }
    },
    [],
  )

  // KPIs
  const total = leads.length
  const convertedCount = leads.filter((l) => l.converted).length
  const avgScore =
    total > 0
      ? Math.round(leads.reduce((sum, l) => sum + (l.overallScore || 0), 0) / total)
      : 0

  const filtered = leads.filter((l) => {
    if (filter === 'new' && l.converted) return false
    if (filter === 'converted' && !l.converted) return false
    if (search) return l.email.toLowerCase().includes(search.toLowerCase())
    return true
  })

  const FILTERS: { id: LeadFilter; label: string }[] = [
    { id: 'all', label: 'Все' },
    { id: 'new', label: 'Новые' },
    { id: 'converted', label: 'Сконвертированные' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Лиды mini-GRI</h1>
          <p className="text-sm text-slate-500 mt-1">
            Заявки с публичной мини-диагностики /gri-free
          </p>
        </div>
        <motion.button
          onClick={fetchLeads}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium
            text-slate-400 bg-white/[0.05] border border-white/[0.08]
            hover:text-slate-200 hover:bg-white/[0.08] transition-all
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          Обновить
        </motion.button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3 md:gap-4 mb-5">
        <LeadKpi
          label="Всего лидов"
          value={total}
          icon={<Users size={16} className="text-blue-400" />}
          accent="bg-blue-500/15 border border-blue-500/20"
        />
        <LeadKpi
          label="Сконвертировано"
          value={convertedCount}
          icon={<Target size={16} className="text-emerald-400" />}
          accent="bg-emerald-500/15 border border-emerald-500/20"
        />
        <LeadKpi
          label="Средний GRI-скор"
          value={avgScore}
          icon={<Gauge size={16} className="text-amber-400" />}
          accent="bg-amber-500/15 border border-amber-500/20"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по email..."
            className="pl-8 pr-3 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08]
              text-sm text-slate-200 placeholder:text-slate-700 w-full md:w-56
              focus:outline-none focus:border-blue-500/40 transition-all"
          />
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07]">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap
                ${
                  filter === f.id
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/25'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-[68px] rounded-2xl bg-white/[0.03] border border-white/[0.06] animate-pulse"
            />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20 rounded-2xl
          bg-white/[0.02] border border-white/[0.06] border-dashed">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={fetchLeads} className="mt-3 text-xs text-blue-400 hover:text-blue-300">
            Попробовать снова
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 rounded-2xl
          bg-white/[0.02] border border-white/[0.06] border-dashed">
          <Sparkles size={32} className="text-slate-700 mb-3" />
          <p className="text-sm text-slate-600">
            {leads.length === 0 ? 'Пока нет лидов' : 'Нет совпадений'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((lead) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              onToggle={toggleConverted}
              isToggling={togglingId === lead.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
