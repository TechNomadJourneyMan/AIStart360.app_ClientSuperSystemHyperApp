'use client'

/**
 * GIGA-CRM «Точка Б — на одобрении» — plan versions that experts have sent for approval,
 * across the clients the actor may see (an approver sees all, an expert only assigned
 * clients — the server scopes the list). A row opens the client's «Точка Б» tab in
 * User 360, where the version is approved or returned. Below — «Рекомендации на проверке»
 * (plan Ф6a Task 8): recommendations of the rules and the AI that wait for an expert, in the
 * same scope; a row opens the client's recommendations in User 360. And «Ежемесячная сверка» (plan Ф6b): the clients
 * with an approved plan and whether the «Факт за месяц» of the last month is there.
 */
import { useMemo } from 'react'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'
import { Badge, Button, DataTable, EmptyState, ErrorState, PageHeader, fmtDateTime, useGigaQuery, type Column } from '@/components/giga-panel/kit'
import { QUEUE_STALE_DAYS, parseQueue, userPointBHref, waitingLabel, type QueueRow } from './pointBQueueModel'
import { REC_KIND_LABEL, SOURCE_LABEL, parseRecsQueue, type RecQueueRow } from '@/components/giga-panel/user360/point-b/recommendationsController'
import { ENTERED_BY_LABEL, parseReconciliation, type ReconciliationRow } from '@/components/giga-panel/user360/point-b/planFactPanelController'
import { periodLabel } from '@/lib/point-b/planfact/kpis'

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

export interface RecsQueueViewProps {
  base: string
  rows: RecQueueRow[] | null
  loading: boolean
  error: { message: string; status?: number } | null
  onRetry: () => void
}

/** «Рекомендации на проверке»: what waits for an expert, oldest first; the client does not see these texts. */
export function RecsQueueView({ base, rows, loading, error, onRetry }: RecsQueueViewProps) {
  const columns: Column<RecQueueRow>[] = [
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
    {
      key: 'title',
      header: 'Рекомендация',
      render: (r) => (
        <div className="min-w-0">
          <p className="break-words text-slate-200">{r.title}</p>
          <p className="text-[11px] text-slate-500">{REC_KIND_LABEL[r.kind]}</p>
        </div>
      ),
    },
    { key: 'source', header: 'Источник', render: (r) => <Badge tone={r.generatedBy === 'ai' ? 'violet' : r.generatedBy === 'rule' ? 'blue' : 'green'}>{SOURCE_LABEL[r.generatedBy]}</Badge> },
    { key: 'created', header: 'Создана', render: (r) => <span className="tabular-nums">{r.createdAt ? fmtDateTime(r.createdAt) : '—'}</span> },
    {
      key: 'open',
      header: <span className="sr-only">Действие</span>,
      className: 'text-right',
      render: (r) => (
        <Link href={userPointBHref(base, r.userId)} className="text-[11px] font-medium text-blue-300 hover:underline" aria-label={`Проверить рекомендацию «${r.title}»: ${r.clientName}`}>
          Проверить
        </Link>
      ),
    },
  ]
  return (
    <section aria-labelledby="pb-recs-queue" className="space-y-2">
      <div>
        <h2 id="pb-recs-queue" className="text-sm font-semibold text-slate-200">Рекомендации на проверке</h2>
        <p className="mt-0.5 text-[11px] text-slate-500">Рекомендации правил и ИИ ждут эксперта. Клиент увидит рекомендацию только после подтверждения.</p>
      </div>
      <ErrorState error={error} onRetry={onRetry} />
      {!error && (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03]">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
            skeletonRows={3}
            empty={<EmptyState title="Проверять нечего" text="Новые рекомендации правил и ИИ появятся здесь." />}
          />
        </div>
      )}
    </section>
  )
}

export interface ReconciliationViewProps {
  base: string
  data: { period: string; rows: ReconciliationRow[] } | null
  loading: boolean
  error: { message: string; status?: number } | null
  onRetry: () => void
}

/** «Ежемесячная сверка»: the clients with an approved plan, those WITHOUT the facts of the month first (spec §13). */
export function ReconciliationView({ base, data, loading, error, onRetry }: ReconciliationViewProps) {
  const missing = data ? data.rows.filter((r) => !r.done).length : 0
  const columns: Column<ReconciliationRow>[] = [
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
    {
      key: 'state',
      header: 'Сверка',
      render: (r) => (r.done
        ? <Badge tone="green">Внесена{r.enteredRole ? ` · ${ENTERED_BY_LABEL[r.enteredRole] ?? r.enteredRole}` : ''}</Badge>
        : <Badge tone="amber">Не было</Badge>),
    },
    { key: 'at', header: 'Когда', render: (r) => <span className="tabular-nums">{r.updatedAt ? fmtDateTime(r.updatedAt) : '—'}</span> },
    {
      key: 'open',
      header: <span className="sr-only">Действие</span>,
      className: 'text-right',
      render: (r) => (
        <Link href={userPointBHref(base, r.userId)} className="text-[11px] font-medium text-blue-300 hover:underline" aria-label={`Открыть план-факт: ${r.clientName}`}>
          Открыть
        </Link>
      ),
    },
  ]
  return (
    <section aria-labelledby="pb-reconciliation" className="space-y-2">
      <div>
        <h2 id="pb-reconciliation" className="text-sm font-semibold text-slate-200">
          Ежемесячная сверка{data?.period ? ` · ${periodLabel(data.period)}` : ''}
          {data && missing > 0 && <Badge tone="amber" className="ml-2">без сверки: {missing}</Badge>}
        </h2>
        <p className="mt-0.5 text-[11px] text-slate-500">Клиенты с одобренным планом. «Не было» — за месяц нет «Факта за месяц»: напомните клиенту или внесите факт сами в его «Точке Б».</p>
      </div>
      <ErrorState error={error} onRetry={onRetry} />
      {!error && (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03]">
          <DataTable
            columns={columns}
            rows={data ? data.rows : null}
            rowKey={(r) => r.userId}
            loading={loading}
            skeletonRows={3}
            empty={<EmptyState title="Клиентов с одобренным планом нет" text="Сверка появится, когда у клиентов будут одобренные планы." />}
          />
        </div>
      )}
    </section>
  )
}

function Inner() {
  const { base, label } = useWorkspace()
  const q = useGigaQuery<unknown>('/api/giga-admin/point-b/queue')
  const rq = useGigaQuery<unknown>('/api/giga-admin/point-b/recommendations/queue')
  const rows = useMemo(() => (q.data ? parseQueue(q.data) : null), [q.data])
  const recRows = useMemo(() => (rq.data ? parseRecsQueue(rq.data) : null), [rq.data])
  const recon = useGigaQuery<unknown>('/api/giga-admin/point-b/reconciliation')
  const reconData = useMemo(() => (recon.data ? parseReconciliation(recon.data) : null), [recon.data])
  return (
    <>
      <PointBQueueView base={base} label={label} rows={rows} loading={q.loading} error={q.error} onRetry={() => { void q.reload(); void rq.reload() }} />
      <div className="mt-6">
        <RecsQueueView base={base} rows={recRows} loading={rq.loading} error={rq.error} onRetry={() => void rq.reload()} />
      </div>
      <div className="mt-6">
        <ReconciliationView base={base} data={reconData} loading={recon.loading} error={recon.error} onRetry={() => void recon.reload()} />
      </div>
    </>
  )
}

export function PointBQueuePage() {
  return (
    <RequirePermission permission="clients.review">
      <Inner />
    </RequirePermission>
  )
}
