'use client'

import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'
import { StatusBadge } from '@/components/common/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { MOCK_CLIENTS } from '@/lib/mock-data'

export function ClientsTable() {
  const clients = MOCK_CLIENTS
  const isLoading = false

  if (isLoading) return <TableSkeleton rows={6} />

  if (clients.length === 0) {
    return (
      <EmptyState
        icon="business_center"
        title="Нет клиентов"
        description="Добавьте первого клиента, чтобы начать работу"
        action={{ label: 'Добавить клиента', onClick: () => {} }}
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-outline-variant/20">
            {['Клиент', 'Отрасль', 'Стадия', 'GRI Score', 'Менеджер', 'Статус', ''].map((h) => (
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
                    <p className="text-xs text-on-surface-variant truncate max-w-[150px]">{client.website ?? ''}</p>
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

              {/* GRI Score */}
              <td className="px-5 py-4">
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-base font-bold ${
                    client.griScore >= 800 ? 'text-primary' :
                    client.griScore >= 700 ? 'text-primary-fixed-dim' :
                    client.griScore >= 500 ? 'text-tertiary-container' :
                    'text-error'
                  }`}>
                    {client.griScore}
                  </span>
                  <div className="w-16 h-1 bg-surface-container-high rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        client.griScore >= 800 ? 'bg-primary' :
                        client.griScore >= 700 ? 'bg-primary-fixed-dim' :
                        client.griScore >= 500 ? 'bg-tertiary-container' :
                        'bg-error'
                      }`}
                      style={{ width: `${client.griScore / 10}%` }}
                    />
                  </div>
                </div>
              </td>

              {/* Manager */}
              <td className="px-5 py-4 text-sm text-on-surface-variant">{client.manager}</td>

              {/* Status */}
              <td className="px-5 py-4">
                <StatusBadge status={client.status as any} label={client.status} />
              </td>

              {/* Actions (visible on hover) */}
              <td className="px-5 py-4">
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link
                    href={`/clients/${client.id}`}
                    className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
                    aria-label="Открыть"
                  >
                    <span className="material-symbols-outlined text-lg">open_in_new</span>
                  </Link>
                  <button
                    className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
                    aria-label="Редактировать"
                  >
                    <span className="material-symbols-outlined text-lg">edit</span>
                  </button>
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
        <div className="flex gap-1">
          {[1, 2, 3].map((page) => (
            <button
              key={page}
              className={`w-8 h-8 rounded text-xs font-mono transition-colors ${
                page === 1
                  ? 'bg-primary/10 text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {page}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
