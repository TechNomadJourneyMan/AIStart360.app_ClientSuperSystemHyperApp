'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'
import { StatusBadge } from '@/components/common/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import type { AdminClientRow } from '@/app/api/v1/admin/clients/route'

// Row shape for rendering, mapped from GET /api/v1/admin/clients (Supabase
// profiles + companies + current Point A diagnostic). There is no mock data.
interface ClientRow {
  id: string
  name: string
  email: string
  industry: string
  stage: string
  /** Point A overall score 0–100; null — no diagnostic yet. */
  pointAScore: number | null
  status: string
}

function toPointAScore(score: number | null): number | null {
  return typeof score === 'number' && Number.isFinite(score) ? Math.round(score) : null
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending_approval: 'Ожидает',
    approved: 'Активный',
    requires_clarification: 'Уточнение',
    rejected: 'Отклонён',
  }
  return map[status] ?? status
}

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="font-mono text-base font-bold text-on-surface-variant" title="Диагностика Точки А ещё не рассчитана">—</span>
  }
  const color =
    score >= 80 ? 'bg-primary' :
    score >= 70 ? 'bg-primary-fixed-dim' :
    score >= 50 ? 'bg-tertiary-container' :
    'bg-error'
  const textColor =
    score >= 80 ? 'text-primary' :
    score >= 70 ? 'text-primary-fixed-dim' :
    score >= 50 ? 'text-tertiary-container' :
    'text-error'
  return (
    <div className="flex items-center gap-2">
      <span className={`font-mono text-base font-bold ${textColor}`}>{score}</span>
      <div className="w-16 h-1 bg-surface-container-high rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
    </div>
  )
}

export function ClientsTable() {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setFailed(false)
    try {
      const res = await fetch('/api/v1/admin/clients', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      // A failed request is an error, not an empty client base.
      if (!res.ok || !json?.ok || !Array.isArray(json.data)) {
        console.error('[ClientsTable] /api/v1/admin/clients failed:', res.status, json?.error)
        setFailed(true)
        setClients([])
        return
      }
      setClients((json.data as AdminClientRow[]).map((c) => ({
        id: c.id,
        name: c.company_name ?? c.full_name ?? c.email,
        email: c.email,
        industry: c.industry ?? '—',
        stage: c.stage ?? '—',
        pointAScore: toPointAScore(c.overall_score),
        status: c.status,
      })))
    } catch (err) {
      console.error('[ClientsTable] load failed:', err)
      setFailed(true)
      setClients([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (isLoading) return <TableSkeleton rows={6} />

  if (failed) {
    return (
      <div className="py-16 px-8 text-center" role="alert">
        <span className="material-symbols-outlined text-5xl text-error/60 mb-3" aria-hidden="true">error</span>
        <p className="text-sm font-medium text-on-surface mb-1">Не удалось загрузить клиентов</p>
        <p className="text-xs text-on-surface-variant mb-4">Сервер не ответил или вернул ошибку.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs font-mono text-primary bg-primary/10 border border-primary/20 hover:bg-primary/20 px-4 py-2 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          Повторить
        </button>
      </div>
    )
  }

  if (clients.length === 0) {
    return (
      <EmptyState
        icon="business_center"
        title="Нет клиентов"
        description="Клиенты появятся здесь после регистрации и подтверждения"
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-outline-variant/20">
            {['Клиент', 'Отрасль', 'Точка А', 'Статус', ''].map((h) => (
              <th key={h} className="px-5 py-3.5 text-left text-[10px] font-mono uppercase tracking-widest text-on-surface-variant whitespace-nowrap bg-surface-container-high">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr key={client.id} className="border-b border-outline-variant/10 last:border-0 table-row-hover group">
              {/* Client */}
              <td className="px-5 py-4">
                <Link href={`/clients/${client.id}`} className="flex items-center gap-3 hover:text-primary transition-colors">
                  <Avatar name={client.name} size="sm" />
                  <div>
                    <p className="text-sm font-medium text-on-surface group-hover:text-primary transition-colors">{client.name}</p>
                    <p className="text-xs text-on-surface-variant truncate max-w-[150px]">{client.email}</p>
                  </div>
                </Link>
              </td>

              {/* Industry */}
              <td className="px-5 py-4 text-sm text-on-surface-variant">{client.industry}</td>

              {/* Point A Score */}
              <td className="px-5 py-4">
                <ScoreBar score={client.pointAScore} />
              </td>

              {/* Status */}
              <td className="px-5 py-4">
                <StatusBadge status={client.status as 'active'} label={statusLabel(client.status)} />
              </td>

              {/* Actions */}
              <td className="px-5 py-4">
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link
                    href={`/clients/${client.id}`}
                    className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
                    aria-label="Открыть"
                  >
                    <span className="material-symbols-outlined text-lg">open_in_new</span>
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      <div className="flex items-center justify-between px-5 py-4 border-t border-outline-variant/10">
        <span className="text-xs text-on-surface-variant font-mono">
          Показано {clients.length} из {clients.length}
        </span>
      </div>
    </div>
  )
}
