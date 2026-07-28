'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'
import { StatusBadge } from '@/components/common/StatusBadge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { ClientFilters } from '@/components/clients/ClientFilters'
import type { AdminClientRow } from '@/app/api/v1/admin/clients/route'
import {
  DEFAULT_CLIENT_DIRECTORY_FILTERS,
  filterAndSortClients,
  readClientDirectoryFilters,
  writeClientDirectoryFilters,
} from '@/lib/client-directory'

const ClientRouteBasePathContext = createContext('/clients')

export function ClientRouteScope({
  basePath,
  children,
}: {
  basePath: string
  children: ReactNode
}) {
  return (
    <ClientRouteBasePathContext.Provider value={basePath}>
      {children}
    </ClientRouteBasePathContext.Provider>
  )
}

interface ClientRow {
  id: string
  name: string
  email?: string
  industry: string
  stage: string
  griScore: number
  status: string
}

function toGriScore(score: number | null): number {
  if (score === null) return 0
  // Point A engine returns 0–100; divide by 10 for 0–10 display
  return Math.round(score) / 10
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
    <div className="flex items-center gap-2">
      <span className={`font-mono text-base font-bold ${textColor}`}>
        {score > 0 ? score : '—'}
      </span>
      {score > 0 && (
        <div className="w-16 h-1 bg-surface-container-high rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${score * 10}%` }} />
        </div>
      )}
    </div>
  )
}

export function ClientsTable({ basePath }: { basePath?: string }) {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loadStatus, setLoadStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filters, setFilters] = useState(DEFAULT_CLIENT_DIRECTORY_FILTERS)
  const [filtersReady, setFiltersReady] = useState(false)
  const inheritedBasePath = useContext(ClientRouteBasePathContext)
  const resolvedBasePath = (basePath ?? inheritedBasePath).replace(/\/+$/, '') || '/clients'
  const clientHref = (clientId: string) => `${resolvedBasePath}/${encodeURIComponent(clientId)}`

  const loadClients = useCallback(async (signal?: AbortSignal) => {
    setLoadStatus('loading')
    setLoadError(null)

    try {
      const response = await fetch('/api/v1/admin/clients', {
        cache: 'no-store',
        signal,
      })
      const json = await response.json() as {
        ok?: boolean
        data?: unknown
      }

      if (!response.ok || json.ok !== true || !Array.isArray(json.data)) {
        throw new Error('CLIENTS_REQUEST_FAILED')
      }

      const rows: ClientRow[] = (json.data as AdminClientRow[]).map((client) => ({
        id: client.id,
        name: client.company_name ?? client.full_name ?? client.email,
        email: client.email,
        industry: client.industry ?? '—',
        stage: client.stage ?? '—',
        griScore: toGriScore(client.overall_score),
        status: client.status,
      }))

      setClients(rows)
      setLoadStatus('success')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setClients([])
      setLoadError('Не удалось загрузить клиентскую базу. Проверьте соединение и повторите попытку.')
      setLoadStatus('error')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadClients(controller.signal)
    return () => controller.abort()
  }, [loadClients])

  useEffect(() => {
    const syncFiltersFromUrl = () => {
      setFilters(readClientDirectoryFilters(new URLSearchParams(window.location.search)))
      setFiltersReady(true)
    }

    syncFiltersFromUrl()
    window.addEventListener('popstate', syncFiltersFromUrl)
    return () => window.removeEventListener('popstate', syncFiltersFromUrl)
  }, [])

  useEffect(() => {
    if (!filtersReady) return

    const nextParams = writeClientDirectoryFilters(
      new URLSearchParams(window.location.search),
      filters,
    )
    const query = nextParams.toString()
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`

    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, '', nextUrl)
    }
  }, [filters, filtersReady])

  const visibleClients = useMemo(
    () => filterAndSortClients(clients, filters),
    [clients, filters],
  )
  const industries = useMemo(
    () => [...new Set(
      clients
        .map((client) => client.industry)
        .filter((industry) => industry && industry !== '—'),
    )].sort((left, right) => left.localeCompare(right, 'ru-RU')),
    [clients],
  )

  return (
    <>
      <ClientFilters
        filters={filters}
        industries={industries}
        disabled={loadStatus !== 'success'}
        resultCount={loadStatus === 'success' ? visibleClients.length : undefined}
        totalCount={loadStatus === 'success' ? clients.length : undefined}
        onChange={setFilters}
      />

      {loadStatus === 'loading' && <TableSkeleton rows={6} />}

      {loadStatus === 'error' && (
        <div role="alert" className="flex flex-col items-center px-6 py-14 text-center">
          <span className="material-symbols-outlined mb-3 text-5xl text-error/70">cloud_off</span>
          <h3 className="font-headline text-lg font-bold text-on-surface">
            Клиентская база временно недоступна
          </h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-on-surface-variant">
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => void loadClients()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-primary/25 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
          >
            <span className="material-symbols-outlined text-lg">refresh</span>
            Повторить
          </button>
        </div>
      )}

      {loadStatus === 'success' && clients.length === 0 && (
        <EmptyState
          icon="business_center"
          title="Клиентов пока нет"
          description="Список заполнится после появления первых подтверждённых клиентов."
        />
      )}

      {loadStatus === 'success' && clients.length > 0 && visibleClients.length === 0 && (
        <EmptyState
          icon="search_off"
          title="По выбранным фильтрам ничего не найдено"
          description="Измените запрос или сбросьте фильтры, чтобы увидеть всех клиентов."
          action={{
            label: 'Сбросить фильтры',
            onClick: () => setFilters(DEFAULT_CLIENT_DIRECTORY_FILTERS),
          }}
        />
      )}

      {loadStatus === 'success' && visibleClients.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-outline-variant/20">
                {['Клиент', 'Отрасль', 'Стадия', 'Point A', 'Статус', ''].map((heading) => (
                  <th key={heading} className="whitespace-nowrap bg-surface-container-high px-5 py-3.5 text-left text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleClients.map((client) => (
                <tr key={client.id} className="group border-b border-outline-variant/10 last:border-0 table-row-hover">
                  <td className="px-5 py-4">
                    <Link href={clientHref(client.id)} className="flex items-center gap-3 transition-colors hover:text-primary">
                      <Avatar name={client.name} size="sm" />
                      <div>
                        <p className="text-sm font-medium text-on-surface transition-colors group-hover:text-primary">{client.name}</p>
                        <p className="max-w-[150px] truncate text-xs text-on-surface-variant">{client.email ?? ''}</p>
                      </div>
                    </Link>
                  </td>

                  <td className="px-5 py-4 text-sm text-on-surface-variant">{client.industry}</td>

                  <td className="px-5 py-4">
                    <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-mono text-on-surface-variant">
                      {client.stage}
                    </span>
                  </td>

                  <td className="px-5 py-4">
                    <ScoreBar score={client.griScore} />
                  </td>

                  <td className="px-5 py-4">
                    <StatusBadge status={client.status as 'active'} label={statusLabel(client.status)} />
                  </td>

                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <Link
                        href={clientHref(client.id)}
                        className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                        aria-label={`Открыть ${client.name}`}
                      >
                        <span className="material-symbols-outlined text-lg">open_in_new</span>
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between border-t border-outline-variant/10 px-5 py-4">
            <span className="text-xs font-mono text-on-surface-variant">
              Показано {visibleClients.length} из {clients.length}
            </span>
          </div>
        </div>
      )}
    </>
  )
}
