'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { AdminClientRow as ApiClientRow } from '@/app/api/v1/admin/clients/route'

type ClientListRow = {
  id: string
  name: string
  industry: string
  /** Point A overall score 0–100 (diagnostics, is_current); null — no diagnostic yet. */
  pointA: number | null
  phase: string
  /** No assignment of a responsible manager exists in the data yet. */
  manager: string
  status: string
}

// profiles.status values (migrations 001, 059). Unknown values are shown as is.
const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  approved:               { label: 'Активен',      color: 'text-primary',            dot: 'bg-primary' },
  pending_approval:       { label: 'Ожидает',      color: 'text-on-surface-variant', dot: 'bg-on-surface-variant' },
  requires_clarification: { label: 'Уточнение',    color: 'text-secondary',          dot: 'bg-secondary' },
  blocked:                { label: 'Заблокирован', color: 'text-error',              dot: 'bg-error' },
  archived:               { label: 'В архиве',     color: 'text-on-surface-variant', dot: 'bg-on-surface-variant' },
}

function statusView(status: string) {
  return STATUS_CONFIG[status] ?? { label: status || '—', color: 'text-on-surface-variant', dot: 'bg-on-surface-variant' }
}

function PointABar({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="text-xs font-mono text-on-surface-variant" title="Диагностика Точки А ещё не рассчитана">—</span>
  }
  const color = score >= 70 ? 'bg-primary' : score >= 50 ? 'bg-secondary' : 'bg-error'
  const textColor = score >= 70 ? 'text-primary' : score >= 50 ? 'text-secondary' : 'text-error'
  const pct = Math.max(0, Math.min(100, score))
  return (
    <div className="flex items-center gap-2 w-24">
      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-mono font-bold w-7 text-right ${textColor}`}>{Math.round(score)}</span>
    </div>
  )
}

export function AdminClientsList() {
  const [clients, setClients] = useState<ClientListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchClients = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/v1/admin/clients')
      const json = await res.json()
      // Guard against a malformed `{ ok:true }` with missing/non-array data —
      // otherwise json.data.map() throws and crashes the whole admin surface.
      if (json.ok && Array.isArray(json.data)) {
        const mapped: ClientListRow[] = (json.data as ApiClientRow[]).map((c) => ({
          id: c.id,
          name: c.company_name || c.full_name || 'Без названия',
          industry: c.industry || '—',
          pointA: typeof c.overall_score === 'number' && Number.isFinite(c.overall_score) ? c.overall_score : null,
          phase: c.stage || '—',
          // GET /api/v1/admin/clients carries no assigned manager (no such
          // column exists yet) — show a dash, never a made-up name.
          manager: '—',
          status: c.status,
        }))
        setClients(mapped)
      } else {
        setError(true)
      }
    } catch (err) {
      console.error('Failed to fetch clients:', err)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchClients() }, [fetchClients])

  if (loading) return <div className="p-8 text-center text-sm text-on-surface-variant">Загрузка базы клиентов...</div>

  // Distinguish a real failure from an empty list so the admin can retry
  // instead of being told there are "no clients" when the API is down.
  if (error) return (
    <div className="p-8 text-center text-sm text-on-surface-variant">
      <p className="mb-3">Не удалось загрузить базу клиентов.</p>
      <button type="button" onClick={fetchClients} className="text-xs font-mono text-primary hover:underline">
        Повторить
      </button>
    </div>
  )

  return (
    <div className="lg:col-span-2 bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
        <div>
          <h2 className="font-headline text-base font-bold text-on-surface">Клиенты платформы</h2>
          <p className="text-[10px] text-on-surface-variant">Точка А · фаза · статус</p>
        </div>
        <Link href="/clients" className="text-xs font-mono text-primary hover:underline">Все →</Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.04]">
              {['Компания', 'Отрасль', 'Точка А', 'Фаза', 'Менеджер', 'Статус'].map(h => (
                <th key={h} className="text-left text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const st = statusView(c.status)
              return (
                <tr key={c.id} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 flex items-center justify-center text-[9px] font-bold text-primary flex-shrink-0">
                        {c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <Link href={`/clients/${c.id}`} className="text-sm font-medium text-on-surface hover:text-primary transition-colors">
                        {c.name}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className="text-xs text-on-surface-variant">{c.industry}</span></td>
                  <td className="px-4 py-3"><PointABar score={c.pointA} /></td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container px-2 py-1 rounded-md whitespace-nowrap">{c.phase}</span>
                  </td>
                  <td className="px-4 py-3"><span className="text-xs text-on-surface-variant">{c.manager}</span></td>
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
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-on-surface-variant">Нет активных клиентов</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
