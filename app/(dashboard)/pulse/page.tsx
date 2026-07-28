'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePulse } from '@/hooks/usePulse'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}Млрд ₸`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}М ₸`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}К ₸`
  return `${n} ₸`
}

function RiskBadge({ level, prob }: { level: 'high' | 'medium' | 'low'; prob: number }) {
  const cfg = {
    high:   { bg: 'bg-error/10 border-error/30 text-error',         dot: 'bg-error',         label: 'Высокий' },
    medium: { bg: 'bg-tertiary-container/10 border-tertiary-container/30 text-tertiary-container', dot: 'bg-tertiary-container', label: 'Средний' },
    low:    { bg: 'bg-primary/10 border-primary/30 text-primary',   dot: 'bg-primary',        label: 'Низкий'  },
  }[level]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-mono font-medium ${cfg.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label} · {prob}%
    </span>
  )
}

function ActionBtn({ action, size = 'md' }: { action: 'call' | 'message' | 'monitor'; size?: 'sm' | 'md' }) {
  const cfg = {
    call:    { bg: 'bg-error/10 text-error border-error/20', icon: 'call', label: 'Позвонить' },
    message: { bg: 'bg-tertiary-container/10 text-tertiary-container border-tertiary-container/20', icon: 'chat', label: 'Написать' },
    monitor: { bg: 'bg-primary/10 text-primary border-primary/20', icon: 'visibility', label: 'Мониторинг' },
  }[action]
  const px = size === 'sm' ? 'px-2.5 py-1' : 'px-3 py-1.5'
  return (
    <button
      type="button"
      disabled
      aria-label={`${cfg.label}: действие пока недоступно`}
      aria-describedby="pulse-actions-unavailable"
      title="Контактные действия пока недоступны"
      className={`inline-flex cursor-not-allowed items-center gap-1.5 ${px} rounded-lg border text-xs font-medium opacity-50 ${cfg.bg}`}
    >
      <span className="material-symbols-outlined text-sm">{cfg.icon}</span>
      {cfg.label}
    </button>
  )
}

function MiniSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null

  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const w = 40, h = 20
  const pts = values.map((v: number, i: number) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  const isUp = values[values.length - 1] >= values[0]
  return (
    <svg width={w} height={h} className="flex-shrink-0">
      <polyline points={pts} fill="none" stroke={isUp ? '#4ade80' : '#f87171'} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function RiskBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-error' : score >= 50 ? 'bg-tertiary-container' : 'bg-primary'
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-surface-container rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-mono font-bold min-w-[24px] ${color.replace('bg-', 'text-')}`}>{score}</span>
    </div>
  )
}

type PulseClient = {
  id: string
  name: string
  sector: string
  forbes?: number | null
  lastOrder: string
  daysSince: number
  avgCheck: number
  volumeChange: number
  riskScore: number
  churnProb: number
  churnLevel: 'high' | 'medium' | 'low'
  comment: string
  action: 'call' | 'message' | 'monitor'
  history: number[]
  orderCycle: number | null
}

function toPulseClient(value: unknown): PulseClient | null {
  if (!value || typeof value !== 'object') return null

  const item = value as Record<string, unknown>
  const churnLevel = item.churnLevel
  const action = item.action
  const requiredNumbers = [
    item.daysSince,
    item.avgCheck,
    item.volumeChange,
    item.riskScore,
    item.churnProb,
  ]

  if (
    typeof item.id !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.sector !== 'string' ||
    requiredNumbers.some((number) => typeof number !== 'number' || !Number.isFinite(number)) ||
    (churnLevel !== 'high' && churnLevel !== 'medium' && churnLevel !== 'low') ||
    (action !== 'call' && action !== 'message' && action !== 'monitor')
  ) {
    return null
  }

  const history = Array.isArray(item.history)
    ? item.history.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
    : []

  return {
    id: item.id,
    name: item.name,
    sector: item.sector,
    forbes: typeof item.forbes === 'number' ? item.forbes : null,
    lastOrder: typeof item.lastOrder === 'string' ? item.lastOrder : '—',
    daysSince: item.daysSince as number,
    avgCheck: item.avgCheck as number,
    volumeChange: item.volumeChange as number,
    riskScore: item.riskScore as number,
    churnProb: item.churnProb as number,
    churnLevel,
    comment: typeof item.comment === 'string' ? item.comment : '',
    action,
    history,
    orderCycle: typeof item.orderCycle === 'number' && Number.isFinite(item.orderCycle)
      ? item.orderCycle
      : null,
  }
}

// ─── Client Card Tab ──────────────────────────────────────────────────────────
function ClientCard({ client }: { client: PulseClient }) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-2xl bg-surface-container-high flex items-center justify-center text-xl font-headline font-bold text-primary flex-shrink-0">
          {client.name[0]}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-headline text-xl font-bold text-on-surface">{client.name}</h3>
            {client.forbes != null && (
              <span className="text-[10px] font-mono bg-tertiary-container/20 text-tertiary-container border border-tertiary-container/30 px-2 py-0.5 rounded-full">
                🏆 Forbes KZ #{client.forbes}
              </span>
            )}
            <RiskBadge level={client.churnLevel} prob={client.churnProb} />
          </div>
          <p className="text-sm text-on-surface-variant">
            {client.sector} · Цикл {client.orderCycle === null ? '—' : `${client.orderCycle} дней`}
          </p>
        </div>
        <ActionBtn action={client.action} />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Средний чек', value: fmt(client.avgCheck), icon: 'payments',   color: 'primary' },
          { label: 'Изм. объёма', value: `${client.volumeChange > 0 ? '+' : ''}${client.volumeChange}%`, icon: 'trending_down', color: client.volumeChange < 0 ? 'error' : 'primary' },
          { label: 'Риск-скор',   value: String(client.riskScore), icon: 'warning', color: client.riskScore >= 80 ? 'error' : 'tertiary-container' },
          { label: 'Дней без заказа', value: String(client.daysSince), icon: 'schedule', color: client.orderCycle !== null && client.daysSince > client.orderCycle ? 'error' : 'primary' },
        ].map((m) => (
          <div key={m.label} className="bg-surface-container rounded-xl p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`material-symbols-outlined text-sm text-${m.color}`}>{m.icon}</span>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{m.label}</p>
            </div>
            <p className={`text-lg font-mono font-bold text-${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Trend chart */}
      <div className="bg-surface-container rounded-xl p-4">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-3">История заказов (последние 5)</p>
        {client.history.length > 0 ? (
          <div className="flex items-end gap-2 h-16">
            {client.history.map((val: number, i: number) => {
              const max = Math.max(...client.history, 1)
              const pct = (val / max) * 100
              const isLast = i === client.history.length - 1
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className={`w-full rounded-t-sm transition-all ${isLast ? 'bg-primary/60' : 'bg-surface-container-high'}`}
                    style={{ height: `${pct}%`, minHeight: 4 }}
                  />
                  <p className="text-[8px] font-mono text-on-surface-variant">{(val / 1000).toFixed(0)}к</p>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-on-surface-variant">История заказов не загружена</p>
        )}
      </div>

      {/* Comment */}
      <div className="bg-surface-container rounded-xl p-4 flex items-start gap-3">
        <span className="material-symbols-outlined text-sm text-on-surface-variant flex-shrink-0 mt-0.5">comment</span>
        <p className="text-sm text-on-surface-variant">{client.comment}</p>
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        <ActionBtn action="call" />
        <ActionBtn action="message" />
        <button
          type="button"
          disabled
          aria-label="Мониторинг: действие пока недоступно"
          aria-describedby="pulse-actions-unavailable"
          title="Мониторинг пока недоступен"
          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-white/[0.06] px-3 py-1.5 text-xs font-medium text-on-surface-variant opacity-50"
        >
          <span className="material-symbols-outlined text-sm">visibility</span>
          Мониторинг
        </button>
        <button
          type="button"
          disabled
          aria-label="История контактов: функция пока недоступна"
          aria-describedby="pulse-actions-unavailable"
          title="История контактов пока недоступна"
          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-white/[0.06] px-3 py-1.5 text-xs font-medium text-on-surface-variant opacity-50"
        >
          <span className="material-symbols-outlined text-sm">history</span>
          История
        </button>
      </div>
    </div>
  )
}

export default function PulsePage() {
  const [tab, setTab] = useState<'today' | 'risk' | 'card'>('today')
  const { data: clientsData, isLoading, error, refetch, isFetching } = usePulse()
  const [filterRisk, setFilterRisk]       = useState<'all' | 'high' | 'medium' | 'low'>('all')

  // Map backend data to frontend structure
  const TODAY_CLIENTS = useMemo(() => {
    if (!clientsData?.todayClients) return []
    return (clientsData.todayClients as unknown[]).flatMap((value) => {
      const client = toPulseClient(value)
      return client ? [client] : []
    })
  }, [clientsData])

  const [selectedClient, setSelectedClient] = useState<PulseClient | null>(null)

  useEffect(() => {
    if (TODAY_CLIENTS.length > 0) {
      setSelectedClient((current) => {
        if (!current) return TODAY_CLIENTS[0]
        return TODAY_CLIENTS.find((client) => client.id === current.id) ?? TODAY_CLIENTS[0]
      })
    } else {
      setSelectedClient(null)
    }
  }, [TODAY_CLIENTS])

  const filteredToday = TODAY_CLIENTS.filter(
    (c) => filterRisk === 'all' || c.churnLevel === filterRisk
  )
  const filteredRisk = TODAY_CLIENTS
    .filter((c) => c.churnLevel === 'high' || c.churnLevel === 'medium')
    .filter((c) => filterRisk === 'all' || c.churnLevel === filterRisk)
    .sort((a, b) => b.riskScore - a.riskScore)

  const highRiskRevenue = TODAY_CLIENTS
    .filter((c) => c.churnLevel === 'high')
    .reduce((s, c) => s + c.avgCheck, 0)

  // Dynamic Stats
  const DYNAMIC_STATS = useMemo(() => {
    const high = TODAY_CLIENTS.filter(c => c.churnLevel === 'high').length
    const medium = TODAY_CLIENTS.filter(c => c.churnLevel === 'medium').length
    const totalClients = typeof clientsData?.stats?.totalClients === 'number'
      ? clientsData.stats.totalClients
      : TODAY_CLIENTS.length
    return {
      highRisk: high,
      mediumRisk: medium,
      totalClients,
    }
  }, [TODAY_CLIENTS, clientsData])

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  )

  if (error) return (
    <div className="p-8 text-center bg-error/10 rounded-2xl border border-error/20">
      <p className="text-error font-medium">Ошибка загрузки данных</p>
      <p className="text-xs text-on-surface-variant mt-2">База данных временно недоступна или не настроена</p>
      <button
        type="button"
        disabled={isFetching}
        onClick={() => void refetch()}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-error/20 px-4 py-2 text-sm font-medium text-error transition-colors hover:bg-error/10 disabled:cursor-wait disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-base">refresh</span>
        {isFetching ? 'Повторяем…' : 'Повторить'}
      </button>
    </div>
  )

  if (TODAY_CLIENTS.length === 0) return (
    <div className="space-y-6">
      <section>
        <p className="mb-3 text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
          GRI Pulse · Монитор клиентской базы
        </p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">Pulse</h1>
      </section>
      <div className="rounded-2xl border border-dashed border-outline-variant/30 bg-surface-container-low p-10 text-center">
        <span className="material-symbols-outlined mb-3 block text-4xl text-on-surface-variant/30">group_off</span>
        <p className="text-sm font-medium text-on-surface">Нет клиентов для текущей выборки</p>
        <p className="mt-1 text-xs text-on-surface-variant">
          Данные появятся после добавления клиентских Pulse-метрик.
        </p>
      </div>
    </div>
  )

  if (!selectedClient && TODAY_CLIENTS.length > 0) return null

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <section className="flex flex-col lg:flex-row justify-between items-start gap-4">
        <div className="flex-1">
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
            GRI Pulse · Монитор клиентской базы
          </p>
          <h1 className="font-headline text-2xl md:text-3xl lg:text-4xl font-extrabold text-on-surface">
            Кому звонить{' '}
            <span className="text-gradient">сегодня</span>
          </h1>
          <p className="text-on-surface-variant mt-2 text-sm max-w-2xl">
            Инструмент менеджера по продажам — видит кто уходит, у кого падает объём, и какое действие нужно прямо сейчас.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-sm text-tertiary-container">workspace_premium</span>
              <span className="text-xs font-mono text-tertiary-container">Forbes Kazakhstan Top 10 · демо-база клиентов</span>
            </div>
            <a href="https://in.aistart360.app" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-container border border-white/[0.06] hover:border-primary/30 rounded-lg text-xs font-mono text-primary transition-colors">
              <span className="material-symbols-outlined text-sm">open_in_new</span>
              in.aistart360.app
            </a>
          </div>
        </div>
      </section>

      <div
        id="pulse-actions-unavailable"
        role="status"
        className="flex items-start gap-3 rounded-xl border border-secondary/20 bg-secondary/5 px-4 py-3"
      >
        <span className="material-symbols-outlined mt-0.5 text-lg text-secondary">visibility</span>
        <div>
          <p className="text-sm font-medium text-on-surface">Клиентские показатели доступны только для просмотра</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Звонки, сообщения, мониторинг и история контактов пока не подключены и не сохраняются.
          </p>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: 'Сумма среднего чека',
            value: fmt(highRiskRevenue),
            icon: 'payments',
            color: 'error',
            sub: `${DYNAMIC_STATS.highRisk} клиентов с высоким риском`,
          },
          {
            label: 'Высокий риск',
            value: String(DYNAMIC_STATS.highRisk),
            icon: 'crisis_alert',
            color: 'error',
            sub: 'по данным Pulse',
          },
          {
            label: 'Средний риск',
            value: String(DYNAMIC_STATS.mediumRisk),
            icon: 'warning',
            color: 'tertiary-container',
            sub: 'по данным Pulse',
          },
          {
            label: 'Всего клиентов',
            value: String(DYNAMIC_STATS.totalClients),
            icon: 'group',
            color: 'on-surface-variant',
            sub: 'в активной базе',
          },
        ].map((stat) => (
          <div key={stat.label}
            className="bg-surface-container-low rounded-xl border border-white/[0.04] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest leading-tight">{stat.label}</p>
              <span className={`material-symbols-outlined text-base text-${stat.color} opacity-60`}>{stat.icon}</span>
            </div>
            <p className={`text-xl font-mono font-bold text-${stat.color} leading-none mb-1`}>{stat.value}</p>
            <p className="text-[10px] text-on-surface-variant/60">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="border-b border-white/[0.04] w-full overflow-x-auto no-scrollbar">
        <div className="flex gap-1 min-w-max">
          {([
            { key: 'today', label: 'Кому звонить', labelFull: 'Кому продавать сегодня', count: TODAY_CLIENTS.length },
            { key: 'risk',  label: 'В зоне риска', labelFull: 'Топ в зоне риска',       count: filteredRisk.length },
            { key: 'card',  label: 'Карточка',     labelFull: 'Карточка клиента',        count: null },
          ] as const).map(({ key, label, labelFull, count }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                tab === key
                  ? 'text-primary border-primary'
                  : 'text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/50'
              }`}>
              <span className="md:hidden">{label}</span>
              <span className="hidden md:inline">{labelFull}</span>
              {count !== null && (
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                  tab === key ? 'bg-primary/20 text-primary' : 'bg-surface-container text-on-surface-variant'
                }`}>{count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Risk filter ── */}
      {tab !== 'card' && (
        <div className="flex gap-2 items-center overflow-x-auto no-scrollbar pb-0.5">
          <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest flex-shrink-0">Риск:</span>
          {(['all', 'high', 'medium', 'low'] as const).map((r) => {
            const labels = { all: 'Все', high: 'Высокий', medium: 'Средний', low: 'Низкий' }
            const colors = {
              all:    filterRisk === 'all'    ? 'bg-primary text-on-primary border-primary'                           : 'border-white/[0.06] text-on-surface-variant hover:text-on-surface',
              high:   filterRisk === 'high'   ? 'bg-error text-white border-error'                                    : 'border-white/[0.06] text-on-surface-variant hover:text-error hover:border-error/30',
              medium: filterRisk === 'medium' ? 'bg-tertiary-container text-on-surface border-tertiary-container'     : 'border-white/[0.06] text-on-surface-variant hover:text-tertiary-container hover:border-tertiary-container/30',
              low:    filterRisk === 'low'    ? 'bg-primary/80 text-on-primary border-primary/80'                     : 'border-white/[0.06] text-on-surface-variant hover:text-primary hover:border-primary/30',
            }
            return (
              <button key={r} onClick={() => setFilterRisk(r)}
                className={`text-[10px] font-mono uppercase px-3 py-1.5 rounded-full border transition-all duration-150 ${colors[r]}`}>
                {labels[r]}
              </button>
            )
          })}
        </div>
      )}

      {/* ─── TAB 1: Today ─── */}
      {tab === 'today' && (
        <div className="space-y-4">
          {/* Alert banner */}
          {DYNAMIC_STATS.highRisk > 0 && (
            <div className="flex items-center gap-3 bg-error/10 border border-error/20 rounded-xl px-5 py-3.5">
              <span className="w-2.5 h-2.5 rounded-full bg-error animate-pulse flex-shrink-0" />
              <p className="text-sm text-error font-medium">
                <strong>{DYNAMIC_STATS.highRisk} клиента</strong> отмечены системой как высокий риск.
                Сумма их среднего чека: <strong>{fmt(highRiskRevenue)}</strong>.
              </p>
            </div>
          )}

          {/* Mobile client cards (< md) */}
          <div className="md:hidden space-y-3">
            {filteredToday.map((c) => (
              <div key={c.id}
                onClick={() => { setSelectedClient(c); setTab('card') }}
                className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 p-4 cursor-pointer transition-colors">
                {/* Top row: name + action */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${
                      c.churnLevel === 'high' ? 'bg-error' : c.churnLevel === 'medium' ? 'bg-tertiary-container' : 'bg-primary'
                    }`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold text-on-surface">{c.name}</p>
                        {c.forbes != null && (
                          <span className="text-[9px] font-mono bg-tertiary-container/20 text-tertiary-container border border-tertiary-container/20 px-1.5 py-0.5 rounded-full">
                            Forbes #{c.forbes}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-on-surface-variant truncate">{c.sector}</p>
                    </div>
                  </div>
                  <ActionBtn action={c.action} size="sm" />
                </div>
                {/* Stats row */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-surface-container rounded-lg p-2">
                    <p className="text-[9px] font-mono text-on-surface-variant uppercase mb-1">Ср. чек</p>
                    <div className="flex items-center gap-1">
                      <p className="text-xs font-mono font-bold text-on-surface">{fmt(c.avgCheck)}</p>
                      <MiniSparkline values={c.history} />
                    </div>
                  </div>
                  <div className="bg-surface-container rounded-lg p-2">
                    <p className="text-[9px] font-mono text-on-surface-variant uppercase mb-1">Изм. объёма</p>
                    <span className={`text-xs font-mono font-bold ${
                      c.volumeChange < -30 ? 'text-error' : c.volumeChange < 0 ? 'text-tertiary-container' : 'text-primary'
                    }`}>{c.volumeChange > 0 ? '+' : ''}{c.volumeChange}%</span>
                  </div>
                  <div className="bg-surface-container rounded-lg p-2">
                    <p className="text-[9px] font-mono text-on-surface-variant uppercase mb-1">Заказ</p>
                    <p className={`text-xs font-mono ${c.orderCycle !== null && c.daysSince > c.orderCycle ? 'text-error' : 'text-on-surface'}`}>{c.daysSince}д. назад</p>
                  </div>
                </div>
                {/* Risk row */}
                <div className="flex items-center justify-between gap-3">
                  <RiskBar score={c.riskScore} />
                  <RiskBadge level={c.churnLevel} prob={c.churnProb} />
                </div>
                {/* Comment */}
                <p className="text-[11px] text-on-surface-variant mt-2 line-clamp-2">{c.comment}</p>
              </div>
            ))}
          </div>

          {/* Desktop table (≥ md) */}
          <div className="hidden md:block bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.04]">
                    {['Клиент', 'Последний заказ', 'Ср. чек', 'Изм. объёма', 'Риск-скор', 'Вер-сть оттока', 'Комментарий', 'Действие'].map((h) => (
                      <th key={h} className="text-left text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-4 py-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredToday.map((c) => (
                    <tr key={c.id}
                      onClick={() => { setSelectedClient(c); setTab('card') }}
                      className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors cursor-pointer group">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            c.churnLevel === 'high' ? 'bg-error' : c.churnLevel === 'medium' ? 'bg-tertiary-container' : 'bg-primary'
                          }`} />
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">{c.name}</p>
                              {c.forbes != null && (
                                <span className="text-[9px] font-mono bg-tertiary-container/20 text-tertiary-container border border-tertiary-container/20 px-1.5 py-0.5 rounded-full">
                                  Forbes #{c.forbes}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-on-surface-variant">{c.sector}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-sm text-on-surface">{c.lastOrder}</p>
                        <p className={`text-[10px] font-mono ${c.orderCycle !== null && c.daysSince > c.orderCycle ? 'text-error' : 'text-on-surface-variant'}`}>
                          {c.daysSince} дн. назад
                        </p>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-mono text-on-surface">{fmt(c.avgCheck)}</p>
                          <MiniSparkline values={c.history} />
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`text-sm font-mono font-bold px-2.5 py-1 rounded-lg ${
                          c.volumeChange < -30 ? 'bg-error/10 text-error' :
                          c.volumeChange < 0   ? 'bg-tertiary-container/10 text-tertiary-container' :
                                                  'bg-primary/10 text-primary'
                        }`}>
                          {c.volumeChange > 0 ? '+' : ''}{c.volumeChange}%
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <RiskBar score={c.riskScore} />
                      </td>
                      <td className="px-4 py-3.5">
                        <RiskBadge level={c.churnLevel} prob={c.churnProb} />
                      </td>
                      <td className="px-4 py-3.5 max-w-[200px]">
                        <p className="text-xs text-on-surface-variant truncate">{c.comment}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <ActionBtn action={c.action} size="sm" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Progress summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'Приоритет 1 — Звонок', count: TODAY_CLIENTS.filter(c => c.action === 'call').length,    color: 'error',               icon: 'call'       },
              { label: 'Приоритет 2 — Написать', count: TODAY_CLIENTS.filter(c => c.action === 'message').length, color: 'tertiary-container',  icon: 'chat'       },
              { label: 'Мониторинг',             count: TODAY_CLIENTS.filter(c => c.action === 'monitor').length, color: 'primary',             icon: 'visibility' },
            ].map((item) => (
              <div key={item.label} className={`bg-surface-container-low rounded-xl border border-${item.color}/20 p-4 flex items-center gap-3`}>
                <div className={`w-8 h-8 rounded-lg bg-${item.color}/10 flex items-center justify-center flex-shrink-0`}>
                  <span className={`material-symbols-outlined text-sm text-${item.color}`}>{item.icon}</span>
                </div>
                <div>
                  <p className={`text-2xl font-mono font-bold text-${item.color}`}>{item.count}</p>
                  <p className="text-[10px] text-on-surface-variant">{item.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── TAB 2: At Risk ─── */}
      {tab === 'risk' && (
        <div className="space-y-3">
          {filteredRisk.map((c, i) => (
            <div key={c.id}
              onClick={() => { setSelectedClient(c); setTab('card') }}
              className="bg-surface-container-low rounded-xl border border-white/[0.04] hover:border-primary/20 p-4 cursor-pointer transition-colors group">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`text-[10px] font-mono text-on-surface-variant/50 w-5 flex-shrink-0`}>#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <p className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">{c.name}</p>
                    {c.forbes != null && (
                      <span className="text-[9px] font-mono bg-tertiary-container/20 text-tertiary-container border border-tertiary-container/20 px-1.5 py-0.5 rounded-full">
                        Forbes #{c.forbes}
                      </span>
                    )}
                    <span className="text-[10px] text-on-surface-variant">{c.sector}</span>
                  </div>
                  <p className="text-xs text-on-surface-variant truncate">{c.comment}</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-on-surface-variant">Ср. чек</p>
                    <p className="text-sm font-mono font-bold text-on-surface">{fmt(c.avgCheck)}</p>
                  </div>
                  <div className="w-20 sm:w-24">
                    <RiskBar score={c.riskScore} />
                  </div>
                  <RiskBadge level={c.churnLevel} prob={c.churnProb} />
                  <ActionBtn action={c.action} size="sm" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── TAB 3: Client Card ─── */}
      {tab === 'card' && (
        <div className="space-y-4">
          {/* Client selector */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {TODAY_CLIENTS.map((c) => (
              <button key={c.id}
                onClick={() => setSelectedClient(c)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition-colors whitespace-nowrap flex-shrink-0 ${
                  selectedClient?.id === c.id
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'border-white/[0.06] text-on-surface-variant hover:border-white/[0.12] hover:text-on-surface'
                }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  c.churnLevel === 'high' ? 'bg-error' : c.churnLevel === 'medium' ? 'bg-tertiary-container' : 'bg-primary'
                }`} />
                {c.name}
              </button>
            ))}
          </div>

          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 md:p-6">
            {selectedClient && (
              <ClientCard client={selectedClient} />
            )}
          </div>
        </div>
      )}

    </div>
  )
}
