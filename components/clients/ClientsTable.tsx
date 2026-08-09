'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'
import { StatusBadge } from '@/components/common/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import {
  clientStatusBadge,
  clientStatusLabel,
  fmtDateRu,
  type ClientRow,
  type ClientSort,
  type ClientSortKey,
} from './client-shared'

export type ClientsLoadError = 'forbidden' | 'unauthorized' | 'network'

const ERROR_COPY: Record<ClientsLoadError, { title: string; text: string; retry: boolean }> = {
  // A failed request used to end in `setClients([])` — indistinguishable from
  // «the base is empty». These three states are now told apart honestly.
  forbidden: {
    title: 'Недостаточно прав',
    text: 'Список клиентов отдаёт /api/v1/admin/clients — он открыт только ролям admin и super_admin. Ваша роль его не проходит, поэтому таблица пуста не потому, что клиентов нет.',
    retry: false,
  },
  unauthorized: {
    title: 'Сессия истекла',
    text: 'Войдите заново, чтобы увидеть список клиентов.',
    retry: true,
  },
  network: {
    title: 'Не удалось загрузить клиентов',
    text: 'Запрос к /api/v1/admin/clients не прошёл. Проверьте соединение и повторите.',
    retry: true,
  },
}

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 8 ? 'bg-primary' :
    score >= 7 ? 'bg-primary-fixed-dim' :
    score >= 5 ? 'bg-tertiary-container' :
    'bg-error'
  const textColor =
    score >= 8 ? 'text-primary' :
    score >= 7 ? 'text-primary-fixed-dim' :
    score >= 5 ? 'text-tertiary-container' :
    'text-error'
  return (
    <span className="flex items-center gap-2">
      <span className={`font-mono text-base font-bold ${textColor}`}>{score.toFixed(1)}</span>
      <span className="w-16 h-1 bg-surface-container-high rounded-full overflow-hidden block">
        <span className={`h-full rounded-full block ${color}`} style={{ width: `${score * 10}%` }} />
      </span>
    </span>
  )
}

function BlockBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value))
  const color = pct >= 70 ? 'bg-primary' : pct >= 40 ? 'bg-tertiary-container' : 'bg-error'
  return (
    <span className="h-1.5 w-full bg-surface-container-high rounded-full overflow-hidden block">
      <span className={`h-full rounded-full block ${color}`} style={{ width: `${pct}%` }} />
    </span>
  )
}

const COLUMNS: ReadonlyArray<{ key: ClientSortKey; label: string }> = [
  { key: 'name',     label: 'Клиент' },
  { key: 'industry', label: 'Отрасль' },
  { key: 'score',    label: 'Point A' },
  { key: 'status',   label: 'Статус' },
]

interface ClientsTableProps {
  rows: ClientRow[]
  /** Rows loaded before filtering — powers «Показано X из N». */
  total: number
  loading?: boolean
  error?: ClientsLoadError | null
  onRetry?: () => void
  /** Prefixes detail links with the portal segment ('/owner'). */
  basePath?: string
  sort: ClientSort
  onSortChange: (key: ClientSortKey) => void
  filtersActive?: boolean
  onResetFilters?: () => void
  /** Where new clients come from — shown in the empty state when provided. */
  pendingHref?: string
}

export function ClientsTable({
  rows,
  total,
  loading = false,
  error = null,
  onRetry,
  basePath = '',
  sort,
  onSortChange,
  filtersActive = false,
  onResetFilters,
  pendingHref,
}: ClientsTableProps) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (loading) return <TableSkeleton rows={6} />

  if (error) {
    const copy = ERROR_COPY[error]
    return (
      <div className="px-8 py-12 text-center">
        <span className="material-symbols-outlined text-5xl text-error/40 mb-3 block">
          {error === 'network' ? 'cloud_off' : 'lock'}
        </span>
        <h3 className="font-headline text-lg font-bold text-on-surface mb-2">{copy.title}</h3>
        <p className="text-sm text-on-surface-variant max-w-md mx-auto leading-relaxed">{copy.text}</p>
        {copy.retry && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 inline-flex items-center gap-1.5 text-sm text-on-surface border border-outline-variant/30 px-4 py-2 rounded-lg hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
            Повторить
          </button>
        )}
      </div>
    )
  }

  // Filtered everything out — offer the way back instead of «Нет клиентов».
  if (rows.length === 0 && filtersActive) {
    return (
      <EmptyState
        icon="filter_alt_off"
        title="Под фильтры никто не подошёл"
        description={`В базе ${total} клиентов, но ни один не совпал с текущими условиями.`}
        action={onResetFilters ? { label: 'Сбросить фильтры', onClick: onResetFilters } : undefined}
      />
    )
  }

  if (rows.length === 0) {
    return (
      <div>
        <EmptyState
          icon="business_center"
          title="Нет клиентов"
          description="Клиент появляется здесь после регистрации и подтверждения заявки администратором."
          action={onRetry ? { label: 'Обновить список', onClick: onRetry } : undefined}
        />
        {pendingHref && (
          <p className="pb-10 -mt-4 text-center">
            <Link href={pendingHref} className="text-xs font-mono text-primary hover:underline">
              Заявки на подтверждение →
            </Link>
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-outline-variant/20">
            {COLUMNS.map((col) => {
              const isActive = sort.key === col.key
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={isActive ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className="px-5 py-3.5 text-left text-[10px] font-mono uppercase tracking-widest text-on-surface-variant whitespace-nowrap bg-surface-container-high"
                >
                  <button
                    type="button"
                    onClick={() => onSortChange(col.key)}
                    className="inline-flex items-center gap-1 uppercase tracking-widest hover:text-on-surface transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded"
                    aria-label={`Сортировать по «${col.label}»`}
                  >
                    {col.label}
                    <span className={`material-symbols-outlined text-sm ${isActive ? 'text-primary' : 'opacity-30'}`}>
                      {isActive && sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                    </span>
                  </button>
                </th>
              )
            })}
            <th scope="col" className="px-5 py-3.5 bg-surface-container-high">
              <span className="sr-only">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((client) => {
            const open = openId === client.id
            const href = `${basePath}/clients/${client.id}`
            return [
              <tr
                key={client.id}
                className="relative border-b border-outline-variant/10 table-row-hover group"
              >
                {/* Client — the link stretches over the whole row via ::after,
                    so industry / Point A / status are clickable too. */}
                <td className="px-5 py-4">
                  <Link
                    href={href}
                    className="flex items-center gap-3 hover:text-primary transition-colors after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded"
                    aria-label={`Открыть карточку клиента ${client.name}`}
                  >
                    <Avatar name={client.name} size="sm" />
                    <span className="block">
                      <span className="block text-sm font-medium text-on-surface group-hover:text-primary transition-colors">{client.name}</span>
                      <span className="block text-xs text-on-surface-variant truncate max-w-[150px]">{client.email}</span>
                    </span>
                  </Link>
                </td>

                <td className="px-5 py-4 text-sm text-on-surface-variant">{client.industry ?? '—'}</td>

                {/* Point A — a button, because «откуда 2.6» is the whole question */}
                <td className="px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : client.id)}
                    aria-expanded={open}
                    aria-controls={`client-point-a-${client.id}`}
                    aria-label={
                      client.pointA === null
                        ? `${client.name}: диагностика не пройдена, показать подробности`
                        : `${client.name}: Point A ${client.pointA.toFixed(1)} из 10, показать разбор по блокам`
                    }
                    className="relative z-10 inline-flex items-center gap-2 -mx-2 px-2 py-1 rounded-lg hover:bg-surface-container-high transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  >
                    {client.pointA === null ? (
                      <span className="text-sm text-on-surface-variant/60">нет диагностики</span>
                    ) : (
                      <ScoreBar score={client.pointA} />
                    )}
                    <span className={`material-symbols-outlined text-base text-on-surface-variant/50 transition-transform ${open ? 'rotate-180' : ''}`}>
                      expand_more
                    </span>
                  </button>
                </td>

                <td className="px-5 py-4">
                  <StatusBadge status={clientStatusBadge(client.status)} label={clientStatusLabel(client.status)} />
                </td>

                <td className="px-5 py-4">
                  <span className="flex items-center gap-1 opacity-60 md:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <Link
                      href={href}
                      className="relative z-10 p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
                      aria-label={`Открыть карточку клиента ${client.name}`}
                    >
                      <span className="material-symbols-outlined text-lg">open_in_new</span>
                    </Link>
                  </span>
                </td>
              </tr>,

              open && (
                <tr key={`${client.id}-detail`} className="border-b border-outline-variant/10 bg-surface-container-lowest/40">
                  <td colSpan={5} className="px-5 py-5" id={`client-point-a-${client.id}`}>
                    {client.pointA === null ? (
                      <div className="max-w-xl">
                        <p className="text-sm text-on-surface mb-1">Точка А не рассчитана</p>
                        <p className="text-xs text-on-surface-variant leading-relaxed">
                          У клиента нет актуальной диагностики: балл появится после того, как он заполнит анкету,
                          и движок Точки А посчитает блоки. Показывать здесь число было бы нечестно.
                        </p>
                        <Link href={href} className="inline-block mt-3 text-xs font-mono text-primary hover:underline">
                          Открыть карточку клиента →
                        </Link>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                          <p className="text-sm text-on-surface">
                            Point A <strong className="font-mono">{client.pointA.toFixed(1)}</strong> из 10
                          </p>
                          <p className="text-xs font-mono text-on-surface-variant">
                            сырой балл движка: {client.pointARaw ?? '—'} из 100
                          </p>
                          <p className="text-xs font-mono text-on-surface-variant">
                            рассчитано: {fmtDateRu(client.calculatedAt)}
                          </p>
                          {client.healthIndex !== null && (
                            <p className="text-xs font-mono text-on-surface-variant">
                              health-индекс: {client.healthIndex}
                            </p>
                          )}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-w-3xl">
                          {client.blocks.map((b) => (
                            <div key={b.key} className="bg-surface-container rounded-lg px-3 py-2">
                              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                                <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">{b.label}</span>
                                <span className="text-xs font-mono text-on-surface">
                                  {b.value === null ? 'нет данных' : `${Math.round(b.value)} / 100`}
                                </span>
                              </div>
                              {b.value === null ? (
                                <span className="h-1.5 w-full bg-surface-container-high rounded-full block" />
                              ) : (
                                <BlockBar value={b.value} />
                              )}
                            </div>
                          ))}
                        </div>

                        <p className="text-[11px] text-on-surface-variant/70">
                          Источник: таблица diagnostics, текущая версия (is_current). Блоки приходят в 0–100,
                          Point A показан в 0–10.
                        </p>

                        <Link href={href} className="inline-block text-xs font-mono text-primary hover:underline">
                          Открыть карточку клиента →
                        </Link>
                      </div>
                    )}
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>

      <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-outline-variant/10">
        <span className="text-xs text-on-surface-variant font-mono">
          Показано {rows.length} из {total}
        </span>
        {filtersActive && onResetFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="text-xs font-mono text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded"
          >
            Показать всех
          </button>
        )}
      </div>
    </div>
  )
}
