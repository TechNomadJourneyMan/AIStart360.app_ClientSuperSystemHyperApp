'use client'

/**
 * GIGA-CRM «Точка Б — на одобрении» — plan versions that experts have sent for approval,
 * across the clients the actor may see (an approver sees all, an expert only assigned
 * clients — the server scopes the list). A row opens the client's «Точка Б» tab in
 * User 360, where the version is approved or returned.
 */
import { useMemo } from 'react'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'
import { Badge, Button, DataTable, EmptyState, ErrorState, PageHeader, fmtDateTime, useGigaQuery, type Column } from '@/components/giga-panel/kit'
import { QUEUE_STALE_DAYS, parseQueue, userPointBHref, waitingLabel, type QueueRow } from './pointBQueueModel'

export interface PointBQueueViewProps {
  base: string
  label: string
  rows: QueueRow[] | null
  loading: boolean
  error: { message: string; status?: number } | null
  onRetry: () => void
}

export function PointBQueueView({ base, label, rows, loading, error, onRetry }: PointBQueueViewProps) {
  const columns: Column<QueueRow>[] = [
    {
      key: 'client',
      header: 'Клиент',
      render: (r) => (
        <div className="min-w-0">
          <Link href={userPointBHref(base, r.userId)} className="font-medium text-blue-300 hover:underline">{r.clientName}</Link>
          {r.company && <p className="truncate text-[11px] text-slate-500">{r.company}</p>}
        </div>
      ),
    },
    { key: 'version', header: 'Версия', render: (r) => <span className="tabular-nums">v{r.version}</span> },
    { key: 'author', header: 'Автор', render: (r) => r.authorName ?? <span className="text-slate-600">—</span> },
    {
      key: 'waiting',
      header: 'Ждёт',
      render: (r) => (
        <span title={r.submittedAt ? `Отправлена ${fmtDateTime(r.submittedAt)}` : undefined}>
          <Badge tone={r.waitingDays >= QUEUE_STALE_DAYS ? 'red' : r.waitingDays >= 3 ? 'amber' : 'neutral'}>{waitingLabel(r.waitingDays)}</Badge>
        </span>
      ),
    },
    {
      key: 'open',
      header: <span className="sr-only">Действие</span>,
      className: 'text-right',
      render: (r) => (
        <Link href={userPointBHref(base, r.userId)} className="text-[11px] font-medium text-blue-300 hover:underline" aria-label={`Открыть Точку Б: ${r.clientName}, версия ${r.version}`}>
          Открыть
        </Link>
      ),
    },
  ]
  return (
    <>
      <PageHeader
        crumbs={[{ label, href: base }, { label: 'Точка Б — на одобрении' }]}
        title="Точка Б — на одобрении"
        description="Версии плана, которые эксперты отправили на одобрение. Клиент увидит версию только после одобрения Admin или Super Admin."
        actions={<Button variant="ghost" icon={<RefreshCw size={13} />} onClick={onRetry} loading={loading && !!rows}>Обновить</Button>}
      />
      <ErrorState error={error} onRetry={onRetry} />
      {!error && (
        <section aria-label="Версии на одобрении" className="rounded-2xl border border-white/[0.07] bg-white/[0.03]">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.versionId}
            loading={loading}
            skeletonRows={4}
            empty={<EmptyState title="Очередь пуста" text="Версии, которые эксперты отправят на одобрение, появятся здесь." />}
          />
        </section>
      )}
    </>
  )
}

function Inner() {
  const { base, label } = useWorkspace()
  const q = useGigaQuery<unknown>('/api/giga-admin/point-b/queue')
  const rows = useMemo(() => (q.data ? parseQueue(q.data) : null), [q.data])
  return <PointBQueueView base={base} label={label} rows={rows} loading={q.loading} error={q.error} onRetry={() => void q.reload()} />
}

export function PointBQueuePage() {
  return (
    <RequirePermission permission="clients.review">
      <Inner />
    </RequirePermission>
  )
}
