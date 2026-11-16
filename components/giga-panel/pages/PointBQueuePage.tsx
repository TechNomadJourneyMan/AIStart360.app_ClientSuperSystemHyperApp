'use client'

/**
 * GIGA-CRM «Точка Б — на одобрении» — plan versions that experts have sent for approval,
 * across the clients the actor may see (an approver sees all, an expert only assigned
 * clients — the server scopes the list). A row opens the client's «Точка Б» tab in
 * User 360, where the version is approved or returned. Below — «Рекомендации на проверке»
 * (plan Ф6a Task 8): recommendations of the rules and the AI that wait for an expert, in the
 * same scope; a row opens the client's recommendations in User 360. And «Ежемесячная сверка» (plan Ф6b): the clients
 * with an approved plan and whether the «Факт за месяц» of the last month is there.
 * On top (R3-SLA, migration 152) — «Ждут план»: Pro clients the SLA pass found waiting for a plan
 * (plan_prep tasks, 48 h, escalation 24 h): «Взять себе» for Admin / Super Admin and
 * «Собрать черновик плана» (the client's «Точка Б» in User 360).
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { RequirePermission, useStaff } from '@/components/giga-panel/StaffContext'
import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'
import { Badge, Button, DataTable, EmptyState, ErrorState, PageHeader, fmtDateTime, gigaFetch, GigaApiError, useGigaQuery, type Column, type Tone } from '@/components/giga-panel/kit'
import { STAGE_LABELS, slaTimerLabel, type SlaStage } from '@/lib/expert-sla/policy'
import { planDraftHref } from '@/lib/expert-sla/links'
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

/** A plan_prep task as GET /api/giga-admin/expert-sla?view=open&source=plan_prep returns it (lib/expert-sla/store decorate). */
export interface PlanPrepRow {
  id: string
  title: string
  received_at: string
  reaction_due_at: string
  answer_due_at: string
  first_response_at: string | null
  closed_at: string | null
  assignee_id: string | null
  stage: SlaStage
  client: { id: string; name: string }
  assignee: { id: string; name: string } | null
  takeable?: boolean
}

const PREP_TONE: Record<SlaStage, Tone> = { breached: 'red', escalated: 'red', due_soon: 'amber', ok: 'neutral', closed: 'green' }

export function parsePlanPrepQueue(v: unknown): PlanPrepRow[] {
  const rows = (v && typeof v === 'object' && Array.isArray((v as { data?: unknown }).data) ? (v as { data: unknown[] }).data : []) as PlanPrepRow[]
  return rows.filter((r) => r && typeof r.id === 'string' && r.client && typeof r.client.id === 'string')
}

export interface PlanPrepQueueViewProps {
  base: string
  rows: PlanPrepRow[] | null
  loading: boolean
  error: { message: string; status?: number } | null
  onRetry: () => void
  /** The actor may take a plan (Admin / Super Admin): his id. */
  takerId?: string | null
  onTake?: (row: PlanPrepRow) => void
  busyId?: string | null
  now?: Date
}

/** «Ждут план» (152): clients whose data carries a plan, nobody approved one yet — 48 h to an approved version. */
export function PlanPrepQueueView({ base, rows, loading, error, onRetry, takerId = null, onTake, busyId = null, now = new Date() }: PlanPrepQueueViewProps) {
  const columns: Column<PlanPrepRow>[] = [
    {
      key: 'client',
      header: 'Клиент',
      render: (r) => (
        <div className="min-w-0">
          <Link href={userPointBHref(base, r.client.id)} className="font-medium text-blue-300 hover:underline">{r.client.name}</Link>
          <p className="text-[11px] text-slate-500">ждёт с {fmtDateTime(r.received_at)}{r.first_response_at ? ' · черновик открыт' : ''}</p>
        </div>
      ),
    },
    {
      key: 'sla',
      header: 'Срок плана',
      render: (r) => (
        <span title={`Одобренный план — до ${fmtDateTime(r.answer_due_at)}`} data-stage={r.stage}>
          <Badge tone={PREP_TONE[r.stage] ?? 'neutral'}>{slaTimerLabel(r, now)}</Badge>
          <span className="ml-1 text-[10px] text-slate-500">{STAGE_LABELS[r.stage]}</span>
        </span>
      ),
    },
    {
      key: 'who',
      header: 'Готовит',
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-300">{r.assignee?.name ?? 'никто — очередь'}</span>
          {takerId && onTake && r.assignee_id !== takerId && (
            <Button size="sm" variant="ghost" loading={busyId === r.id} onClick={() => onTake(r)}>Взять себе</Button>
          )}
        </div>
      ),
    },
    {
      key: 'draft',
      header: <span className="sr-only">Действие</span>,
      className: 'text-right',
      render: (r) => (
        <Link href={planDraftHref(r.client.id, base)} className="text-[11px] font-medium text-teal-300 hover:underline" aria-label={`Собрать черновик плана: ${r.client.name}`}>
          Собрать черновик плана
        </Link>
      ),
    },
  ]
  return (
    <section aria-labelledby="pb-plan-prep" className="space-y-2">
      <div>
        <h2 id="pb-plan-prep" className="text-sm font-semibold text-slate-200">
          Ждут план{rows && rows.length > 0 && <Badge tone="amber" className="ml-2">{rows.length}</Badge>}
        </h2>
        <p className="mt-0.5 text-[11px] text-slate-500">Данных для плана достаточно, плана ещё нет. Срок — 48 ч до одобренной версии, без черновика 24 ч — эскалация. Клиент видит, кто готовит план и до какого срока.</p>
      </div>
      <ErrorState error={error} onRetry={onRetry} />
      {!error && (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03]">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
            skeletonRows={2}
            empty={<EmptyState title="Никто не ждёт план" text="Клиенты Pro с целью по выручке и данными для расчёта появятся здесь, пока план не одобрен." />}
          />
        </div>
      )}
    </section>
  )
}

function Inner() {
  const { base, label } = useWorkspace()
  const { me } = useStaff()
  const prep = useGigaQuery<unknown>('/api/giga-admin/expert-sla?view=open&source=plan_prep')
  const prepRows = useMemo(() => (prep.data ? parsePlanPrepQueue(prep.data) : null), [prep.data])
  const [taking, setTaking] = useState<string | null>(null)
  const takerId = me && (me.role === 'admin' || me.role === 'super_admin') ? me.id : null
  const take = async (row: PlanPrepRow) => {
    if (!takerId) return
    setTaking(row.id)
    try {
      await gigaFetch(`/api/giga-admin/expert-sla/${row.id}`, { method: 'PATCH', json: { assigneeId: takerId } })
      toast.success(`План клиента «${row.client.name}» — ваш`)
      void prep.reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось взять задачу')
    } finally {
      setTaking(null)
    }
  }
  const q = useGigaQuery<unknown>('/api/giga-admin/point-b/queue')
  const rq = useGigaQuery<unknown>('/api/giga-admin/point-b/recommendations/queue')
  const rows = useMemo(() => (q.data ? parseQueue(q.data) : null), [q.data])
  const recRows = useMemo(() => (rq.data ? parseRecsQueue(rq.data) : null), [rq.data])
  const recon = useGigaQuery<unknown>('/api/giga-admin/point-b/reconciliation')
  const reconData = useMemo(() => (recon.data ? parseReconciliation(recon.data) : null), [recon.data])
  return (
    <>
      <PointBQueueView base={base} label={label} rows={rows} loading={q.loading} error={q.error} onRetry={() => { void q.reload(); void rq.reload(); void prep.reload() }} />
      <div className="mt-6">
        <PlanPrepQueueView base={base} rows={prepRows} loading={prep.loading} error={prep.error} onRetry={() => void prep.reload()} takerId={takerId} onTake={(r) => void take(r)} busyId={taking} />
      </div>
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
