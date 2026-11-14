'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { AlarmClock, AlertTriangle, Inbox, ListChecks, RefreshCw, Timer } from 'lucide-react'
import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'
import { RequirePermission, useStaff } from '@/components/giga-panel/StaffContext'
import {
  Badge, Button, ConfirmDialog, DataTable, EmptyState, ErrorState, PageHeader, Panel, StatTile, Tabs, cx, fmtAgo, fmtDateTime,
  gigaFetch, GigaApiError, useGigaQuery, type Column, type Tone,
} from '@/components/giga-panel/kit'
import { STAGE_LABELS, slaStage, slaTimerLabel, type ExpertSlaSource, type SlaStage } from '@/lib/expert-sla/policy'
import { staffTaskHref } from '@/lib/expert-sla/links'
import type { SlaView } from '@/lib/expert-sla/store'

/**
 * «SLA экспертов» (R2-B) — задачи экспертов с часами: реакция за 24 ч (иначе
 * эскалация SuperExpert и Admin), ответ клиенту за 48 ч (иначе просрочка).
 * Отсюда берут задачи из общей очереди и переназначают: исполнитель
 * становится ответственным клиента, его открытые задачи переходят к нему.
 */

interface Task {
  id: string; source: ExpertSlaSource; source_id: string; client_id: string; title: string
  assignee_id: string | null; assigned_via: string | null
  received_at: string; reaction_due_at: string; answer_due_at: string
  first_response_at: string | null; closed_at: string | null; close_reason: string | null
  escalated_at: string | null; breached_at: string | null
  answered?: boolean | null; escalation_notified_at?: string | null; breach_notified_at?: string | null
  notify_attempts?: number; notify_error?: string | null
  sourceLabel: string; stage: SlaStage; timer: string
  client: { id: string; name: string }
  assignee: { id: string; name: string } | null
  reassignable: boolean
}
interface Summary { open: number; dueSoon: number; escalated: number; breached: number; queue: number; mine: number }
interface Worker { id: string; name: string; kind: 'expert' | 'super_expert' | 'admin' | 'super_admin'; openTasks: number }

const STAGE_TONE: Record<SlaStage, Tone> = { breached: 'red', escalated: 'red', due_soon: 'amber', ok: 'neutral', closed: 'green' }
const KIND_LABEL: Record<Worker['kind'], string> = { expert: 'эксперт', super_expert: 'SuperExpert', admin: 'Admin', super_admin: 'Super Admin' }
const CLOSE_LABEL: Record<string, string> = {
  superseded: 'заменена новой версией', stale: 'рекомендации устарели', withdrawn: 'отозвана', failed: 'сбой сборки', gone: 'удалена',
}
const VIA_LABEL: Record<string, string> = { source: 'из обращения', client: 'ответственный клиента', auto: 'авто: наименее загружен', manual: 'вручную' }

const selectCls = 'rounded-lg border border-white/[0.08] bg-[#0b1128] px-2 py-1 text-[11px] text-slate-200 focus:border-blue-500/40 focus:outline-none disabled:opacity-50'

function ExpertSlaInner() {
  const { base, label } = useWorkspace()
  const { can, me } = useStaff()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const view = (sp.get('view') ?? 'attention') as SlaView
  const setView = useCallback((v: SlaView) => {
    const next = new URLSearchParams(sp.toString())
    if (v === 'attention') next.delete('view'); else next.set('view', v)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [sp, router, pathname])

  const { data, error, loading, reload } = useGigaQuery<{ data: Task[]; total: number; summary: Summary; scope: 'all' | 'assigned' }>(`/api/giga-admin/expert-sla?view=${view}`)
  const canAssign = can('clients.review') && can('users.sensitive')
  const workers = useGigaQuery<{ data: Worker[] }>(canAssign ? '/api/giga-admin/expert-sla/assignees' : null)
  const [pending, setPending] = useState<{ task: Task; worker: Worker } | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id) }, [])
  useEffect(() => { const id = setInterval(reload, 5 * 60_000); return () => clearInterval(id) }, [reload])

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      const res = await gigaFetch<{ moved: number }>(`/api/giga-admin/expert-sla/${pending.task.id}`, { method: 'PATCH', json: { assigneeId: pending.worker.id } })
      toast.success(`Клиент передан: ${pending.worker.name}. Задач перешло: ${res.moved}`)
      setPending(null)
      reload()
      workers.reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось переназначить')
    } finally {
      setBusy(false)
    }
  }

  const s = data?.summary
  const tabs: ReadonlyArray<{ key: SlaView; label: string; count?: number | null }> = [
    { key: 'attention', label: 'Требуют внимания', count: s ? s.dueSoon + s.escalated + s.breached : null },
    { key: 'breached', label: 'Просрочено', count: s?.breached ?? null },
    { key: 'queue', label: 'Без исполнителя', count: s?.queue ?? null },
    { key: 'mine', label: 'Мои', count: s?.mine ?? null },
    { key: 'open', label: 'Все открытые', count: s?.open ?? null },
    { key: 'closed', label: 'Закрытые' },
  ]

  const columns: Column<Task>[] = [
    {
      key: 'task', header: 'Задача',
      render: (t) => (
        <div className="min-w-0 max-w-[24rem]">
          <Link href={staffTaskHref(t, base)} className="block truncate font-medium text-slate-100 hover:underline" title={t.title}>{t.title}</Link>
          <p className="truncate text-[10px] text-slate-500">
            {t.sourceLabel}{' · '}
            <Link href={`${base}/users/${t.client.id}`} className="text-blue-300 hover:underline">{t.client.name}</Link>
            {' · поступила '}{fmtAgo(t.received_at)}
          </p>
        </div>
      ),
    },
    {
      key: 'sla', header: 'Срок ответа',
      render: (t) => {
        const at = new Date(now)
        const stage = slaStage(t, at)
        const text = t.closed_at
          ? (t.answered === false ? `закрыта без ответа · ${CLOSE_LABEL[t.close_reason ?? ''] ?? t.close_reason ?? ''}` : `ответ ${fmtAgo(t.closed_at)}`)
          : slaTimerLabel(t, at)
        const delivery = t.breached_at
          ? (t.breach_notified_at ? ' · уведомлены' : ' · уведомление ещё не доставлено')
          : t.escalated_at ? (t.escalation_notified_at ? ' · эскалация отправлена' : ' · эскалация ещё не доставлена') : ''
        return (
          <div className="space-y-0.5">
            <Badge tone={STAGE_TONE[stage]} title={`Ответ до ${fmtDateTime(t.answer_due_at)}`}>{text}</Badge>
            <p className="text-[10px] text-slate-500">{stage === 'closed' && t.answered === false ? 'Закрыта без ответа' : STAGE_LABELS[stage]}{delivery}</p>
            {!!t.notify_attempts && (
              <p className="text-[10px] text-amber-300" title={t.notify_error ?? undefined}>Не доставлено, попыток: {t.notify_attempts}</p>
            )}
          </div>
        )
      },
    },
    {
      key: 'reaction', header: 'Реакция',
      render: (t) => t.first_response_at
        ? <span className="text-[11px] text-emerald-400" title={fmtDateTime(t.first_response_at)}>{fmtAgo(t.first_response_at)}</span>
        : <span className={cx('text-[11px]', new Date(t.reaction_due_at).getTime() <= now ? 'text-red-300' : 'text-slate-500')} title={`Срок реакции: ${fmtDateTime(t.reaction_due_at)}`}>нет · до {fmtDateTime(t.reaction_due_at)}</span>,
    },
    {
      key: 'assignee', header: 'Исполнитель',
      render: (t) => {
        if (!t.reassignable || !canAssign) {
          return (
            <span className="text-[11px] text-slate-400">
              {t.assignee?.name ?? (t.source === 'plan_review' ? 'Admin / Super Admin' : 'общая очередь')}
              {t.assigned_via && <span className="block text-[10px] text-slate-600">{VIA_LABEL[t.assigned_via] ?? t.assigned_via}</span>}
            </span>
          )
        }
        const list = workers.data?.data ?? []
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label="Исполнитель"
              value={t.assignee_id ?? ''}
              onChange={(e) => {
                const w = list.find((x) => x.id === e.target.value)
                if (w && w.id !== t.assignee_id) setPending({ task: t, worker: w })
              }}
              className={cx(selectCls, 'max-w-[12rem]')}
            >
              <option value="">{t.assignee ? t.assignee.name : 'Общая очередь'}</option>
              {list.filter((w) => w.id !== t.assignee_id).map((w) => (
                <option key={w.id} value={w.id}>{w.name} · {KIND_LABEL[w.kind]} · {w.openTasks}</option>
              ))}
            </select>
            {me && t.assignee_id !== me.id && list.some((w) => w.id === me.id) && (
              <Button size="sm" variant="ghost" onClick={() => { const w = list.find((x) => x.id === me.id); if (w) setPending({ task: t, worker: w }) }}>Взять себе</Button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div>
      <PageHeader
        crumbs={[{ label, href: base }, { label: 'SLA экспертов' }]}
        title="SLA экспертов"
        description={`Реакция эксперта — за 24 ч, иначе эскалация SuperExpert и Admin; ответ клиенту — за 48 ч.${data?.scope === 'assigned' ? ' Только ваши клиенты.' : ''}`}
        actions={<Button variant="ghost" icon={<RefreshCw size={13} />} onClick={reload} loading={loading && !!data}>Обновить</Button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Открыто" value={s?.open ?? '—'} icon={<ListChecks size={14} />} tone="blue" />
        <StatTile label="Скоро срок" value={s?.dueSoon ?? '—'} icon={<Timer size={14} />} tone="amber" hint="≤ 6 ч до срока" />
        <StatTile label="Нет реакции 24 ч" value={s?.escalated ?? '—'} icon={<AlarmClock size={14} />} tone="red" />
        <StatTile label="Просрочено 48 ч" value={s?.breached ?? '—'} icon={<AlertTriangle size={14} />} tone="red" />
        <StatTile label="Без исполнителя" value={s?.queue ?? '—'} icon={<Inbox size={14} />} tone="violet" hint="общая очередь" />
      </div>
      <Panel bodyClassName="p-0">
        <div className="border-b border-white/[0.06] p-3">
          <Tabs tabs={tabs} value={view} onChange={setView} />
        </div>
        {error && <div className="p-3"><ErrorState error={error} onRetry={reload} /></div>}
        <DataTable
          columns={columns}
          rows={data?.data}
          rowKey={(t) => t.id}
          loading={loading}
          empty={<EmptyState icon={<ListChecks size={18} />} title="Задач нет" text="Здесь появляются обращения клиентов, отчёты и рекомендации на проверке и планы Точки Б на одобрении — с часами SLA." />}
        />
      </Panel>
      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={() => void confirm()}
        loading={busy}
        tone="primary"
        title="Передать клиента исполнителю?"
        confirmLabel="Передать"
        text={pending ? (
          <>
            <b className="text-slate-200">{pending.worker.name}</b> станет ответственным клиента «{pending.task.client.name}»:
            все его открытые задачи и обращения перейдут к новому исполнителю, прежний ответственный потеряет доступ к клиенту (если он видит только своих).
            Исполнитель получит уведомление.
          </>
        ) : null}
      />
    </div>
  )
}

export function ExpertSlaPage() {
  return (
    <RequirePermission permission="clients.review">
      <Suspense fallback={null}>
        <ExpertSlaInner />
      </Suspense>
    </RequirePermission>
  )
}
