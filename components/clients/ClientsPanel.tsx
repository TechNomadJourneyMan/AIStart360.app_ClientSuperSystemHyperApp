'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClientFilters } from './ClientFilters'
import { ClientsTable, type ClientsLoadError } from './ClientsTable'
import {
  DEFAULT_CLIENT_FILTERS,
  filterClients,
  industriesOf,
  isClientFilterActive,
  mapAdminClient,
  sortClients,
  statusesOf,
  type ClientFiltersValue,
  type ClientRow,
  type ClientSortKey,
} from './client-shared'
import type { AdminClientRow } from '@/app/api/v1/admin/clients/route'

// ClientsPanel owns the one thing the /clients screens were missing: shared
// state. Stats, filters and the table now read the SAME rows, so every number
// on the screen is the count of rows you can click into — and clicking a stat
// applies the filter that produced it.
//
// It also replaces the per-page server query over `profiles`+`diagnostics`:
// that query and /api/v1/admin/clients returned the same data through two
// different paths and could disagree. One source, one number.

interface StatCard {
  key: string
  label: string
  value: string
  sub: string
  icon: string
  color: string
  /** Filter state this number stands for; clicking narrows the table to it. */
  apply: Partial<ClientFiltersValue> | null
  disabled?: boolean
}

export function ClientsPanel({
  basePath = '',
  pendingHref,
}: {
  basePath?: string
  pendingHref?: string
}) {
  const [rows, setRows] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ClientsLoadError | null>(null)
  const [filters, setFilters] = useState<ClientFiltersValue>(DEFAULT_CLIENT_FILTERS)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/clients', { credentials: 'include' })
      if (res.status === 401) { setRows([]); setError('unauthorized'); return }
      if (res.status === 403) { setRows([]); setError('forbidden'); return }
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok || !Array.isArray(json.data)) throw new Error('bad_response')
      setRows((json.data as AdminClientRow[]).map(mapAdminClient))
    } catch {
      setRows([])
      setError('network')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const industries = useMemo(() => industriesOf(rows), [rows])
  const statuses = useMemo(() => statusesOf(rows), [rows])
  const visible = useMemo(
    () => sortClients(filterClients(rows, filters), filters.sort),
    [rows, filters],
  )
  const filtersActive = isClientFilterActive(filters)

  const resetFilters = useCallback(
    () => setFilters((f) => ({ ...DEFAULT_CLIENT_FILTERS, sort: f.sort })),
    [],
  )

  const onSortChange = useCallback((key: ClientSortKey) => {
    setFilters((f) => ({
      ...f,
      sort: f.sort.key === key
        ? { key, dir: f.sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'score' || key === 'created' ? 'desc' : 'asc' },
    }))
  }, [])

  const stats = useMemo(() => {
    const scored = rows.filter((r) => r.pointA !== null)
    const avg = scored.length
      ? Math.round((scored.reduce((s, r) => s + (r.pointA as number), 0) / scored.length) * 10) / 10
      : null
    return {
      total: rows.length,
      active: rows.filter((r) => r.status === 'approved').length,
      pending: rows.filter((r) => r.status === 'pending_approval').length,
      scored: scored.length,
      avg,
    }
  }, [rows])

  const cards: StatCard[] = [
    {
      key: 'total',
      label: 'Всего клиентов',
      value: String(stats.total),
      sub: filtersActive ? 'показать всех' : 'в списке ниже',
      icon: 'business_center',
      color: 'text-primary',
      apply: null,
    },
    {
      key: 'active',
      label: 'Активных',
      value: String(stats.active),
      sub: 'статус «Активный»',
      icon: 'check_circle',
      color: 'text-primary',
      apply: { status: 'approved' },
      disabled: stats.active === 0,
    },
    {
      key: 'pending',
      label: 'Ожидают',
      value: String(stats.pending),
      sub: 'статус «Ожидает»',
      icon: 'hourglass_top',
      color: 'text-tertiary-container',
      apply: { status: 'pending_approval' },
      disabled: stats.pending === 0,
    },
    {
      key: 'avg',
      label: 'Средний Point A',
      value: stats.avg !== null ? stats.avg.toFixed(1) : '—',
      sub: stats.scored > 0
        ? `по ${stats.scored} из ${stats.total} с диагностикой`
        : 'ни у кого нет диагностики',
      icon: 'radar',
      color: 'text-secondary',
      apply: { band: 'scored', sort: { key: 'score', dir: 'desc' } },
      disabled: stats.scored === 0,
    },
  ]

  const isCardActive = (card: StatCard) => {
    if (card.apply === null) return !filtersActive
    if (card.apply.status) return filters.status === card.apply.status
    if (card.apply.band) return filters.band === card.apply.band
    return false
  }

  return (
    <div className="space-y-6">
      {/* Stats — derived from the loaded rows, so each number is clickable and
          lands on exactly the rows it counted. */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[74px] bg-surface-container-low rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !error && stats.total > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {cards.map((card) => {
            const active = isCardActive(card)
            return (
              <button
                key={card.key}
                type="button"
                disabled={card.disabled}
                aria-pressed={active}
                aria-label={`${card.label}: ${card.value}. ${card.apply === null ? 'Показать всех клиентов' : 'Показать этих клиентов в списке'}`}
                onClick={() =>
                  setFilters((f) =>
                    card.apply === null
                      ? { ...DEFAULT_CLIENT_FILTERS, sort: f.sort }
                      : { ...DEFAULT_CLIENT_FILTERS, sort: f.sort, ...card.apply },
                  )
                }
                className={`bg-surface-container-low rounded-xl p-4 flex items-center gap-3 text-left border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 disabled:cursor-default disabled:opacity-60 ${
                  active ? 'border-primary/40' : 'border-transparent hover:border-outline-variant/30'
                }`}
              >
                <span className={`material-symbols-outlined text-2xl ${card.color}`}>{card.icon}</span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{card.label}</span>
                  <span className={`block text-xl font-mono font-bold ${card.color}`}>{card.value}</span>
                  <span className="block text-[10px] text-on-surface-variant/60 truncate">{card.sub}</span>
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="bg-surface-container rounded-xl overflow-hidden">
        {!error && (
          <ClientFilters
            value={filters}
            onChange={setFilters}
            onReset={resetFilters}
            industries={industries}
            statuses={statuses}
            shown={visible.length}
            total={rows.length}
            disabled={loading || rows.length === 0}
          />
        )}
        <ClientsTable
          rows={visible}
          total={rows.length}
          loading={loading}
          error={error}
          onRetry={load}
          basePath={basePath}
          sort={filters.sort}
          onSortChange={onSortChange}
          filtersActive={filtersActive}
          onResetFilters={resetFilters}
          pendingHref={pendingHref}
        />
      </div>
    </div>
  )
}
