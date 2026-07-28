'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { AdminClientRow as ApiAdminClientRow } from '@/app/api/v1/admin/clients/route'

type ClientListRow = {
  id: string
  name: string
  industry: string
  gri: number | null
  phase: string
  status: string
}

const STATUS_CONFIG = {
  active:   { label: 'Активен',       color: 'text-primary',   dot: 'bg-primary'   },
  at_risk:  { label: 'В зоне риска',  color: 'text-secondary', dot: 'bg-secondary' },
  critical: { label: 'Критично',      color: 'text-error',     dot: 'bg-error'     },
  pending_approval: { label: 'Ожидает', color: 'text-on-surface-variant', dot: 'bg-on-surface-variant' },
  unknown: { label: 'Неизвестно', color: 'text-on-surface-variant', dot: 'bg-outline' },
}

function GriBar({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="text-xs font-mono text-on-surface-variant" title="GRI ещё не рассчитан">
        —
      </span>
    )
  }

  const color = score >= 7 ? 'bg-primary' : score >= 5 ? 'bg-secondary' : 'bg-error'
  const textColor = score >= 7 ? 'text-primary' : score >= 5 ? 'text-secondary' : 'text-error'
  return (
    <div className="flex items-center gap-2 w-24">
      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${(score / 10) * 100}%` }} />
      </div>
      <span className={`text-xs font-mono font-bold w-6 text-right ${textColor}`}>{score}</span>
    </div>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isApiClientRow(value: unknown): value is ApiAdminClientRow {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    typeof value.email === 'string' &&
    typeof value.status === 'string' &&
    isNullableString(value.full_name) &&
    isNullableString(value.company_name) &&
    isNullableString(value.industry) &&
    isNullableString(value.stage) &&
    (value.overall_score === null || typeof value.overall_score === 'number')
  )
}

function envelopeError(payload: unknown): string | null {
  return isRecord(payload) && typeof payload.error === 'string' ? payload.error : null
}

export function AdminClientsList({ basePath = '/clients' }: { basePath?: string }) {
  const [clients, setClients] = useState<ClientListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const resolvedBasePath = basePath.replace(/\/+$/, '') || '/clients'
  const clientHref = (clientId: string) => `${resolvedBasePath}/${encodeURIComponent(clientId)}`

  const fetchClients = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/v1/admin/clients', { cache: 'no-store' })
      let payload: unknown

      try {
        payload = await response.json()
      } catch {
        throw new Error(`INVALID_JSON_${response.status}`)
      }

      if (!response.ok) {
        throw new Error(envelopeError(payload) ?? `HTTP_${response.status}`)
      }

      if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.data)) {
        throw new Error('INVALID_RESPONSE_ENVELOPE')
      }

      if (!payload.data.every(isApiClientRow)) {
        throw new Error('INVALID_CLIENT_ROW')
      }

      const mapped = payload.data.map((client): ClientListRow => ({
        id: client.id,
        name: client.company_name || client.full_name || client.email || 'Без названия',
        industry: client.industry || '—',
        gri: client.overall_score === null ? null : Math.round(client.overall_score) / 10,
        phase: client.stage || '—',
        status: client.status === 'approved'
          ? 'active'
          : client.status === 'pending_approval'
            ? 'pending_approval'
            : 'unknown',
      })).sort((a, b) => {
        if (a.name.toLowerCase().includes('choco')) return -1
        if (b.name.toLowerCase().includes('choco')) return 1
        return 0
      })

      setClients(mapped)
    } catch (fetchError) {
      console.error('Failed to fetch clients:', fetchError)
      setClients([])
      setError('Не удалось загрузить базу клиентов')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchClients()
  }, [fetchClients])

  if (loading) {
    return (
      <div role="status" className="m-4 rounded-2xl bg-surface-container p-8 text-center">
        <span className="mx-auto mb-3 block h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        <p className="text-sm text-on-surface-variant">Загрузка базы клиентов...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div role="alert" className="m-4 rounded-2xl border border-error/20 bg-error/5 p-8 text-center">
        <span className="material-symbols-outlined mb-3 block text-3xl text-error">cloud_off</span>
        <p className="text-sm font-medium text-on-surface">{error}</p>
        <p className="mt-1 text-xs text-on-surface-variant">Это не означает, что клиентов нет.</p>
        <button
          type="button"
          onClick={() => void fetchClients()}
          className="mt-4 rounded-lg border border-error/30 px-4 py-2 text-xs font-medium text-error transition-colors hover:bg-error/10"
        >
          Повторить
        </button>
      </div>
    )
  }

  return (
    <div className="lg:col-span-2 bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
        <div>
          <h2 className="font-headline text-base font-bold text-on-surface">Клиенты платформы</h2>
          <p className="text-[10px] text-on-surface-variant">GRI · фаза · статус</p>
        </div>
        <Link href={resolvedBasePath} className="text-xs font-mono text-primary hover:underline">Все →</Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.04]">
              {['Компания', 'Отрасль', 'GRI', 'Фаза', 'Статус'].map(h => (
                <th key={h} className="text-left text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const st = STATUS_CONFIG[c.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.unknown
              return (
                <tr key={c.id} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 flex items-center justify-center text-[9px] font-bold text-primary flex-shrink-0">
                        {c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <Link href={clientHref(c.id)} className="text-sm font-medium text-on-surface hover:text-primary transition-colors">
                        {c.name}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className="text-xs text-on-surface-variant">{c.industry}</span></td>
                  <td className="px-4 py-3"><GriBar score={c.gri} /></td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container px-2 py-1 rounded-md whitespace-nowrap">{c.phase}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
                      <span className={`text-[10px] font-mono ${st.color}`}>{st.label}</span>
                    </div>
                  </td>
                </tr>
              )
            })}
            {clients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center">
                  <span className="material-symbols-outlined mb-2 block text-3xl text-on-surface-variant/30">group_off</span>
                  <p className="text-xs text-on-surface-variant">В базе пока нет клиентов</p>
                  <button
                    type="button"
                    onClick={() => void fetchClients()}
                    className="mt-3 text-xs font-medium text-primary hover:underline"
                  >
                    Обновить
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
