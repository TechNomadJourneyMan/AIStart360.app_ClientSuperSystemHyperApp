'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  RefreshCw,
  Building2,
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  Globe,
  User,
  Calendar,
  Activity,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
} from 'lucide-react'
import { useGigaPanelStore, type GigaClient } from '@/stores/gigaPanel.store'
import { UserDetailPanel } from './UserDetailPanel'

// ─── GRI Score ring ───────────────────────────────────────────────────────────

function ScoreRing({ score, size = 64 }: { score: number; size?: number }) {
  const r = size / 2 - 6
  const circ = 2 * Math.PI * r
  const fill = ((score ?? 0) / 10) * circ
  const color =
    score >= 7.0 ? '#10b981' : score >= 4.5 ? '#f59e0b' : '#ef4444'

  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.06)" strokeWidth={5} fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        stroke={color} strokeWidth={5} fill="none"
        strokeDasharray={circ}
        strokeDashoffset={circ - fill}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
      />
    </svg>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stageBadge(stage: string) {
  const map: Record<string, string> = {
    Seed:   'bg-violet-500/15 text-violet-300 border-violet-500/20',
    Early:  'bg-blue-500/15 text-blue-300 border-blue-500/20',
    Growth: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
    Scale:  'bg-teal-500/15 text-teal-300 border-teal-500/20',
    Mature: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
  }
  return map[stage] ?? 'bg-slate-500/15 text-slate-400 border-slate-500/15'
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active:     'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
    at_risk:    'bg-red-500/15 text-red-300 border-red-500/20',
    inactive:   'bg-slate-500/15 text-slate-400 border-slate-500/15',
    onboarding: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
  }
  return map[status] ?? 'bg-slate-500/15 text-slate-400 border-slate-500/15'
}

function churnIcon(level: string) {
  if (level === 'high') return <TrendingDown size={13} className="text-red-400" />
  if (level === 'medium') return <Minus size={13} className="text-amber-400" />
  return <TrendingUp size={13} className="text-emerald-400" />
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const color = score >= 7.0 ? 'bg-emerald-500' : score >= 4.5 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-[10px] text-slate-500">{label}</span>
        <span className="text-[10px] font-semibold text-slate-300">{(score || 0).toFixed(1)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${(score || 0) * 10}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className={`h-full rounded-full ${color}`}
        />
      </div>
    </div>
  )
}

// ─── Client card ──────────────────────────────────────────────────────────────

function ClientCard({ client, onClick }: { client: GigaClient; onClick: () => void }) {
  const score = client.latestGri?.score ?? null
  const initials = client.name.slice(0, 2).toUpperCase()

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, borderColor: 'rgba(59,130,246,0.25)' }}
      onClick={onClick}
      className="cursor-pointer rounded-2xl bg-white/[0.04] border border-white/[0.08]
        p-4 transition-all duration-200 hover:bg-white/[0.06]"
    >
      <div className="flex items-start gap-3 mb-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/30 to-violet-500/30
          border border-white/[0.1] flex items-center justify-center flex-shrink-0
          text-sm font-bold text-blue-300">
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-100 truncate">{client.name}</p>
          <p className="text-[11px] text-slate-500 truncate">{client.industry}</p>
        </div>

        {/* GRI score */}
        {score !== null && (
          <div className="relative flex-shrink-0">
            <ScoreRing score={score} size={44} />
            <span className="absolute inset-0 flex items-center justify-center
              text-[11px] font-bold text-slate-200 rotate-90">
              {(score || 0).toFixed(1)}
            </span>
          </div>
        )}
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${stageBadge(client.stage)}`}>
          {client.stage}
        </span>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusBadge(client.status)}`}>
          {client.status === 'active' ? 'Активен' :
           client.status === 'at_risk' ? 'Риск' :
           client.status === 'onboarding' ? 'Онбординг' : 'Неактивен'}
        </span>
        {client.pulseMetrics && (
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            {churnIcon(client.pulseMetrics.churnLevel)}
            {client.pulseMetrics.churnProb}%
          </span>
        )}
      </div>

      {/* Manager */}
      {client.manager && (
        <p className="text-[10px] text-slate-600 mt-2 truncate">
          Менеджер: {client.manager.name ?? client.manager.email}
        </p>
      )}
    </motion.div>
  )
}

// ─── Detail panel (right drawer) ─────────────────────────────────────────────

function ClientDetailPanel({ client, onClose }: { client: GigaClient; onClose: () => void }) {
  const score = client.latestGri?.score ?? null
  const gri = client.latestGri
  const pulse = client.pulseMetrics

  const formatDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(iso)) : '—'

  const formatMoney = (n: number) =>
    new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(n)

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="fixed right-0 top-0 h-screen w-full md:w-[420px] z-50
        bg-slate-950/95 backdrop-blur-2xl border-l border-white/[0.08]
        flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-start justify-between p-6 border-b border-white/[0.07]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/30 to-violet-500/30
            border border-white/[0.1] flex items-center justify-center
            text-sm font-bold text-blue-300">
            {client.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100">{client.name}</h2>
            <p className="text-xs text-slate-500">{client.industry}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-600 hover:text-slate-300 transition-colors mt-0.5"
        >
          <X size={18} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Meta */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <p className="text-[10px] text-slate-600 mb-0.5">Стадия</p>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${stageBadge(client.stage)}`}>
              {client.stage}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <p className="text-[10px] text-slate-600 mb-0.5">Статус</p>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusBadge(client.status)}`}>
              {client.status === 'active' ? 'Активен' :
               client.status === 'at_risk' ? 'Под риском' :
               client.status === 'onboarding' ? 'Онбординг' : 'Неактивен'}
            </span>
          </div>
          {client.website && (
            <div className="col-span-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div className="flex items-center gap-1.5">
                <Globe size={11} className="text-slate-600" />
                <a href={client.website} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors truncate">
                  {client.website}
                </a>
                <ExternalLink size={10} className="text-slate-600 flex-shrink-0" />
              </div>
            </div>
          )}
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="flex items-center gap-1 mb-0.5">
              <User size={10} className="text-slate-600" />
              <p className="text-[10px] text-slate-600">Менеджер</p>
            </div>
            <p className="text-xs text-slate-300 truncate">
              {client.manager?.name ?? client.manager?.email ?? '—'}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="flex items-center gap-1 mb-0.5">
              <Calendar size={10} className="text-slate-600" />
              <p className="text-[10px] text-slate-600">Создан</p>
            </div>
            <p className="text-xs text-slate-300">{formatDate(client.createdAt)}</p>
          </div>
        </div>

        {/* GRI Score */}
        {gri ? (
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.07]">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold text-slate-300 uppercase tracking-widest">GRI Индекс</p>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <ScoreRing score={gri.score} size={52} />
                  <span className="absolute inset-0 flex items-center justify-center
                    text-sm font-bold text-slate-100 rotate-90">
                    {(gri.score || 0).toFixed(1)}
                  </span>
                </div>
              </div>
            </div>
            <div className="space-y-2.5">
              <ScoreBar label="Продукт" score={gri.productScore} />
              <ScoreBar label="Доверие" score={gri.trustScore} />
              <ScoreBar label="Бизнес-модель" score={gri.businessModelScore} />
              <ScoreBar label="Финансы" score={gri.cashScore} />
              <ScoreBar label="Операции" score={gri.operationsScore} />
              <ScoreBar label="Команда" score={gri.teamScore} />
              <ScoreBar label="Основатель" score={gri.founderScore} />
            </div>
            <p className="text-[10px] text-slate-600 mt-3">
              Рассчитан: {formatDate(gri.calculatedAt)}
            </p>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.07] text-center">
            <Activity size={20} className="text-slate-700 mx-auto mb-1" />
            <p className="text-xs text-slate-600">GRI-отчёт не найден</p>
          </div>
        )}

        {/* Pulse metrics */}
        {pulse && (
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.07]">
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-widest mb-3">
              GRI Pulse
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <p className="text-[10px] text-slate-600 mb-0.5">Риск</p>
                <div className="flex items-center gap-1">
                  {pulse.riskScore >= 70
                    ? <AlertTriangle size={12} className="text-red-400" />
                    : pulse.riskScore >= 40
                      ? <AlertTriangle size={12} className="text-amber-400" />
                      : <CheckCircle size={12} className="text-emerald-400" />
                  }
                  <span className="text-sm font-bold text-slate-200">{pulse.riskScore}</span>
                  <span className="text-[10px] text-slate-600">/100</span>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <p className="text-[10px] text-slate-600 mb-0.5">Отток</p>
                <div className="flex items-center gap-1">
                  {churnIcon(pulse.churnLevel)}
                  <span className="text-sm font-bold text-slate-200">{pulse.churnProb}%</span>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <p className="text-[10px] text-slate-600 mb-0.5">Ср. чек</p>
                <p className="text-xs font-semibold text-slate-200">{formatMoney(pulse.avgCheck)}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <p className="text-[10px] text-slate-600 mb-0.5">Дней с заказа</p>
                <p className="text-sm font-bold text-slate-200">{pulse.daysSince ?? '—'}</p>
              </div>
            </div>
            {pulse.lastOrder && (
              <p className="text-[10px] text-slate-600 mt-2">
                Последний заказ: {formatDate(pulse.lastOrder)}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Survey + Diagnostics + Documents (editable) */}
      <div className="border-t border-white/[0.07]">
        <UserDetailPanel userId={client.id} />
      </div>
    </motion.div>
  )
}

// ─── Main module ──────────────────────────────────────────────────────────────

export function ClientsModule() {
  const {
    clients, isLoadingClients, clientsError,
    setClients, setLoadingClients, setClientsError,
    selectedClient, setSelectedClient,
  } = useGigaPanelStore()

  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const fetchClients = useCallback(async () => {
    setLoadingClients(true)
    setClientsError(null)
    try {
      const res = await fetch('/api/giga-admin/clients')
      if (!res.ok) throw new Error('Ошибка загрузки клиентов')
      const data = await res.json()
      setClients(data.clients)
    } catch (err) {
      setClientsError(err instanceof Error ? err.message : 'Неизвестная ошибка')
    } finally {
      setLoadingClients(false)
    }
  }, [setClients, setLoadingClients, setClientsError])

  useEffect(() => { fetchClients() }, [fetchClients])

  const STAGES = ['Seed', 'Early', 'Growth', 'Scale', 'Mature']
  const STATUSES = ['active', 'at_risk', 'inactive', 'onboarding']

  const filtered = clients.filter((c) => {
    if (stageFilter !== 'all' && c.stage !== stageFilter) return false
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return c.name.toLowerCase().includes(q) || c.industry.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Клиенты платформы</h1>
          <p className="text-sm text-slate-500 mt-1">
            {clients.length} клиент{clients.length !== 1 ? 'ов' : ''} — полные данные с GRI и Pulse
          </p>
        </div>
        <motion.button
          onClick={fetchClients}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          disabled={isLoadingClients}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium
            text-slate-400 bg-white/[0.05] border border-white/[0.08]
            hover:text-slate-200 hover:bg-white/[0.08] transition-all
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={13} className={isLoadingClients ? 'animate-spin' : ''} />
          Обновить
        </motion.button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            className="pl-8 pr-3 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08]
              text-sm text-slate-200 placeholder:text-slate-700 w-full md:w-52
              focus:outline-none focus:border-blue-500/40 transition-all"
          />
        </div>

        {/* Stage filter */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07]">
          <button
            onClick={() => setStageFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              ${stageFilter === 'all' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/25' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Все
          </button>
          {STAGES.map((s) => (
            <button
              key={s}
              onClick={() => setStageFilter(stageFilter === s ? 'all' : s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${stageFilter === s ? 'bg-blue-500/20 text-blue-300 border border-blue-500/25' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoadingClients ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw size={20} className="text-slate-600 animate-spin mr-2" />
          <span className="text-sm text-slate-600">Загрузка клиентов...</span>
        </div>
      ) : clientsError ? (
        <div className="flex flex-col items-center justify-center py-20 rounded-2xl
          bg-white/[0.02] border border-white/[0.06] border-dashed">
          <p className="text-sm text-red-400">{clientsError}</p>
          <button onClick={fetchClients} className="mt-3 text-xs text-blue-400 hover:text-blue-300">
            Попробовать снова
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 rounded-2xl
          bg-white/[0.02] border border-white/[0.06] border-dashed">
          <Building2 size={32} className="text-slate-700 mb-3" />
          <p className="text-sm text-slate-600">
            {clients.length === 0 ? 'Клиентов пока нет в базе' : 'Нет совпадений'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <AnimatePresence>
            {filtered.map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                onClick={() => setSelectedClient(client)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Detail drawer */}
      <AnimatePresence>
        {selectedClient && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedClient(null)}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            />
            <ClientDetailPanel
              client={selectedClient}
              onClose={() => setSelectedClient(null)}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
