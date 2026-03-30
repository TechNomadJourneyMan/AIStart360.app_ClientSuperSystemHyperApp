'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'
import { StatusBadge } from '@/components/common/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { MOCK_CLIENTS } from '@/lib/mock-data'
import type { AdminClientRow } from '@/app/api/v1/admin/clients/route'

// Unified shape used for rendering — maps both mock and real data
interface ClientRow {
  id: string
  name: string
  email?: string
  industry: string
  stage: string
  griScore: number       // displayed 0–1000 (real data × 10)
  previousGriScore?: number
  status: string
  website?: string
  hasRealData: boolean
}

function toGriScore(score: number | null): number {
  if (score === null) return 0
  // Point A engine returns 0–100; multiply by 10 for 0–1000 display
  return Math.round(score * 10)
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

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 800 ? 'bg-primary' :
    score >= 700 ? 'bg-primary-fixed-dim' :
    score >= 500 ? 'bg-tertiary-container' :
    'bg-error'
  const textColor =
    score >= 800 ? 'text-primary' :
    score >= 700 ? 'text-primary-fixed-dim' :
    score >= 500 ? 'text-tertiary-container' :
    'text-error'
  return (
    <div className="flex items-center gap-2">
      <span className={`font-mono text-base font-bold ${textColor}`}>
        {score > 0 ? score : '—'}
      </span>
      {score > 0 && (
        <div className="w-16 h-1 bg-surface-container-high rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${score / 10}%` }} />
        </div>
      )}
    </div>
  )
}

export function ClientsTable() {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [usingMock, setUsingMock] = useState(false)

  useEffect(() => {
    fetch('/api/v1/admin/clients')
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && Array.isArray(json.data) && json.data.length > 0) {
          const rows: ClientRow[] = (json.data as AdminClientRow[]).map((c) => ({
            id: c.id,
            name: c.company_name ?? c.full_name ?? c.email,
            email: c.email,
            industry: c.industry ?? '—',
            stage: c.stage ?? '—',
            griScore: toGriScore(c.overall_score),
            status: c.status,
            hasRealData: c.overall_score !== null,
          }))
          setClients(rows)
        } else {
          // No Supabase data yet — show mock
          const mockRows: ClientRow[] = MOCK_CLIENTS.map((c) => ({
            id: c.id,
            name: c.name,
            industry: c.industry,
            stage: c.stage,
            griScore: c.griScore,
            previousGriScore: c.previousGriScore,
            status: c.status,
            website: c.website,
            hasRealData: false,
          }))
          setClients(mockRows)
          setUsingMock(true)
        }
      })
      .catch(() => {
        const mockRows: ClientRow[] = MOCK_CLIENTS.map((c) => ({
          id: c.id,
          name: c.name,
          industry: c.industry,
          stage: c.stage,
          griScore: c.griScore,
          previousGriScore: c.previousGriScore,
          status: c.status,
          website: c.website,
          hasRealData: false,
        }))
        setClients(mockRows)
        setUsingMock(true)
      })
      .finally(() => setIsLoading(false))
  }, [])

  if (isLoading) return <TableSkeleton rows={6} />

  if (clients.length === 0) {
    return (
      <EmptyState
        icon="business_center"
        title="Нет клиентов"
        description="Клиенты появятся здесь после регистрации и подтверждения"
        action={{ label: 'Добавить клиента', onClick: () => {} }}
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      {usingMock && (
        <div className="px-5 py-2 bg-surface-container-high border-b border-outline-variant/10 flex items-center gap-2">
          <span className="material-symbols-outlined text-sm text-on-surface-variant">info</span>
          <span className="text-[10px] font-mono text-on-surface-variant">
            Demo-данные — реальные клиенты появятся после подключения Supabase
          </span>
        </div>
      )}
      <table className="w-full">
        <thead>
          <tr className="border-b border-outline-variant/20">
            {['Клиент', 'Отрасль', 'Стадия', 'Point A', 'Статус', ''].map((h) => (
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
                    <p className="text-xs text-on-surface-variant truncate max-w-[150px]">{client.email ?? client.website ?? ''}</p>
                  </div>
                </Link>
              </td>

              {/* Industry */}
              <td className="px-5 py-4 text-sm text-on-surface-variant">{client.industry}</td>

              {/* Stage */}
              <td className="px-5 py-4">
                <span className="text-xs font-mono text-on-surface-variant bg-surface-container-high px-2.5 py-1 rounded-full">
                  {client.stage}
                </span>
              </td>

              {/* Point A Score */}
              <td className="px-5 py-4">
                <ScoreBar score={client.griScore} />
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
