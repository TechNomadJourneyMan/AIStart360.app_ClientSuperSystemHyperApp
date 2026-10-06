'use client'

/**
 * «Одобрения» — actions agents may not take alone. Pending requests with a
 * countdown to expiry, approve / reject with an optional reason
 * (approvals.decide), and the full history with who decided and where
 * (GIGA or Telegram).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Clock, MessageCircle, RefreshCw, ShieldAlert, Stamp, X } from 'lucide-react'
import { RequirePermission, useStaff } from '../StaffContext'
import { useWorkspace } from '../WorkspaceContext'
import {
  Badge, Button, DataTable, EmptyState, ErrorState, Field, Modal, PageHeader, Panel, Skeleton, Tabs, cx, fmtAgo, fmtDateTime,
  gigaFetch, inputClass, useGigaQuery, type Column,
} from '../kit'
import { PERMISSION_LABELS } from '@/lib/agents/permissions'
import { NAV_BADGES_CHANGED, approvalStatusMeta, decidedViaLabel, fmtCountdown, shortActor } from './model'
import type { ApprovalRow, ApprovalsResponse } from './types'
import { useAgentDirectory } from './useAgentDirectory'
import { NoRightHint, StatusChip, useNow } from './ui'

type Scope = 'pending' | 'all'
const PERMISSION_LABEL: Record<string, string> = PERMISSION_LABELS
/** Actions that change the platform or destroy data deserve a second look. */
const CRITICAL = new Set(['MODIFY_SYSTEM', 'DELETE_DATA', 'SEND_EMAIL', 'WRITE_CLIENT_DATA'])
const NO_RIGHT = 'Решать может роль с правом «Решения по действиям агентов»'

export function ApprovalsPage() {
  const { can } = useStaff()
  const { base } = useWorkspace()
  const router = useRouter()
  const sp = useSearchParams()
  const focus = sp.get('focus')
  const [scope, setScope] = useState<Scope>(sp.get('scope') === 'all' ? 'all' : 'pending')
  const q = useGigaQuery<ApprovalsResponse>(`/api/giga-admin/agents/approvals?scope=${scope}`)
  const dir = useAgentDirectory()
  const now = useNow(30_000)
  const canDecide = can('approvals.decide') && (q.data?.canDecide ?? true)
  const [deciding, setDeciding] = useState<{ item: ApprovalRow; decision: 'approve' | 'reject' } | null>(null)

  // A link from Telegram / the feed may point to an already decided request: show history then.
  const focusMissing = !!focus && scope === 'pending' && !!q.data && !q.data.items.some((i) => i.id === focus)
  useEffect(() => {
    if (!focus || !q.data) return
    const el = document.getElementById(`approval-${focus}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focus, q.data])

  const onDecided = (item: ApprovalRow, status: string | undefined, taskId: string | undefined) => {
    q.setData((d) => (d ? { ...d, items: scope === 'pending' ? d.items.filter((i) => i.id !== item.id) : d.items } : d))
    if (scope === 'all') void q.reload()
    window.dispatchEvent(new Event(NAV_BADGES_CHANGED))
    toast.success(status === 'approved' ? 'Одобрено: агент продолжит работу' : 'Отклонено: задача агента отменена', {
      action: taskId ? { label: 'К задаче', onClick: () => router.push(`${base}/agents/tasks/${taskId}`) } : undefined,
    })
  }

  const pending = q.data?.items ?? []

  return (
    <RequirePermission permission="agents.view">
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: base }, { label: 'ИИ-агенты', href: `${base}/agents` }, { label: 'Одобрения' }]}
        title="Одобрения"
        description="Агент не отправляет письма, не меняет данные клиента и систему и ничего не удаляет без решения человека. Решение действует один раз; без ответа запрос истекает."
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={q.loading && !!q.data} onClick={() => void q.reload()}>Обновить</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={scope}
          onChange={setScope}
          tabs={[
            { key: 'pending', label: 'Ожидают решения', count: scope === 'pending' && q.data ? q.data.items.length : null },
            { key: 'all', label: 'Все' },
          ]}
        />
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
          <Link href={`${base}/notifications`} className="inline-flex items-center gap-1 hover:text-slate-300"><MessageCircle size={12} /> Решать из Telegram</Link>
          {can('insights.moderate') && <Link href={`${base}/moderation`} className="hover:text-slate-300">Модерация ИИ-инсайтов →</Link>}
        </div>
      </div>

      {!canDecide && q.data && <div className="mb-3"><NoRightHint>{NO_RIGHT}. Вы видите запросы, но кнопки решения недоступны.</NoRightHint></div>}
      {focusMissing && (
        <p className="mb-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.06] px-4 py-2.5 text-xs text-blue-200">
          Этот запрос уже не ждёт решения. <button type="button" className="underline" onClick={() => setScope('all')}>Показать историю</button>
        </p>
      )}
      {q.error && <div className="mb-4"><ErrorState error={q.error} onRetry={() => void q.reload()} /></div>}

      {scope === 'pending' ? (
        !q.data && q.loading ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32" />)}</div>
        : q.data && pending.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03]">
            <EmptyState icon={<Stamp size={18} />} title="Нет запросов на одобрение" text="Когда агенту понадобится разрешение человека, запрос появится здесь и придёт в Telegram сотрудникам с правом решения." />
          </div>
        ) : (
          <ul className="space-y-3">
            {pending.map((a) => (
              <PendingCard
                key={a.id}
                item={a}
                now={now}
                focused={a.id === focus}
                agentName={a.agent_key ? dir.names[a.agent_key] ?? a.agent_key : '—'}
                base={base}
                canDecide={canDecide}
                onDecide={(decision) => setDeciding({ item: a, decision })}
              />
            ))}
          </ul>
        )
      ) : (
        <HistoryTable rows={q.data?.items} loading={q.loading} names={dir.names} base={base} focus={focus} />
      )}

      <DecisionModal
        state={deciding}
        agentName={deciding?.item.agent_key ? dir.names[deciding.item.agent_key] ?? deciding.item.agent_key : ''}
        onClose={() => setDeciding(null)}
        onDone={(item, status, taskId) => { setDeciding(null); onDecided(item, status, taskId) }}
        onStale={() => void q.reload()}
      />
    </RequirePermission>
  )
}

function PendingCard({ item, now, focused, agentName, base, canDecide, onDecide }: {
  item: ApprovalRow; now: Date; focused: boolean; agentName: string; base: string; canDecide: boolean
  onDecide: (d: 'approve' | 'reject') => void
}) {
  const cd = fmtCountdown(item.expires_at, now)
  const blocked = !canDecide || cd.expired
  const why = !canDecide ? NO_RIGHT : cd.expired ? 'Срок запроса истёк' : undefined
  return (
    <li
      id={`approval-${item.id}`}
      className={cx('rounded-2xl border bg-white/[0.03] p-4', focused ? 'border-blue-500/40 ring-2 ring-blue-500/20' : 'border-white/[0.07]')}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-100">{item.summary}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <Badge tone="blue">{agentName}</Badge>
            {item.company_id ? <Badge>{item.company_name || item.company_id}</Badge> : <Badge>платформа</Badge>}
            <Badge tone={CRITICAL.has(item.permission) ? 'amber' : 'neutral'} title={item.permission}>
              {CRITICAL.has(item.permission) && <ShieldAlert size={10} />} {PERMISSION_LABEL[item.permission] ?? item.permission}
            </Badge>
            <span className="font-mono">{item.tool}</span>
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span title={fmtDateTime(item.requested_at)}>запрошено {fmtAgo(item.requested_at)}</span>
            <span className={cx('inline-flex items-center gap-1', cd.expired ? 'text-slate-500' : cd.urgent ? 'text-amber-300' : 'text-slate-400')} title={`до ${fmtDateTime(item.expires_at)}`}>
              <Clock size={11} /> {cd.expired ? 'срок истёк' : `истекает ${cd.text}`}
            </span>
            {item.task_id && <Link href={`${base}/agents/tasks/${item.task_id}`} className="text-blue-300 hover:underline">задача агента</Link>}
          </p>
        </div>
        <div className="flex shrink-0 gap-2" title={why}>
          <Button size="sm" variant="danger" icon={<X size={12} />} disabled={blocked} onClick={() => onDecide('reject')} aria-label={`Отклонить: ${item.summary}`}>Отклонить</Button>
          <Button size="sm" variant="primary" icon={<Check size={12} />} disabled={blocked} onClick={() => onDecide('approve')} aria-label={`Одобрить: ${item.summary}`}>Одобрить</Button>
        </div>
      </div>
    </li>
  )
}

function DecisionModal({ state, agentName, onClose, onDone, onStale }: {
  state: { item: ApprovalRow; decision: 'approve' | 'reject' } | null
  agentName: string
  onClose: () => void
  onDone: (item: ApprovalRow, status: string | undefined, taskId: string | undefined) => void
  onStale: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setReason(''); setError(null) }, [state])
  const approve = state?.decision === 'approve'

  const submit = async () => {
    if (!state) return
    setBusy(true)
    setError(null)
    try {
      const r = await gigaFetch<{ status?: string; taskId?: string }>(`/api/giga-admin/agents/approvals/${state.item.id}`, {
        method: 'POST',
        json: { decision: state.decision, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      })
      onDone(state.item, r.status, r.taskId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить решение')
      if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 409) onStale()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!state}
      onClose={busy ? () => {} : onClose}
      title={approve ? 'Одобрить действие агента?' : 'Отклонить действие агента?'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button variant={approve ? 'primary' : 'danger'} loading={busy} onClick={() => void submit()} icon={approve ? <Check size={13} /> : <X size={13} />}>
            {approve ? 'Одобрить' : 'Отклонить'}
          </Button>
        </>
      }
    >
      {state && (
        <div className="space-y-3 text-xs">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
            <p className="font-medium text-slate-100">{state.item.summary}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              {agentName} · {PERMISSION_LABEL[state.item.permission] ?? state.item.permission}
              {state.item.company_name ? ` · ${state.item.company_name}` : ''}
            </p>
          </div>
          <p className="leading-relaxed text-slate-400">
            {approve
              ? 'Агент выполнит ровно это действие один раз — если при повторном запуске параметры совпадут с запрошенными. Решение пишется в журнал аудита, карточки в Telegram закроются.'
              : 'Задача агента будет отменена. Решение пишется в журнал аудита, карточки в Telegram закроются.'}
          </p>
          <Field label="Причина (необязательно)" hint={`${reason.length}/500 — увидят коллеги в истории решений`}>
            <textarea value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} className={inputClass} placeholder={approve ? 'Например: проверил текст письма' : 'Например: данные клиента устарели'} />
          </Field>
          {error && <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</p>}
        </div>
      )}
    </Modal>
  )
}

function HistoryTable({ rows, loading, names, base, focus }: {
  rows: ApprovalRow[] | undefined; loading: boolean; names: Record<string, string>; base: string; focus: string | null
}) {
  const columns: Column<ApprovalRow>[] = [
    { key: 'requested', header: 'Запрошено', render: (a) => <span id={`approval-${a.id}`} className={cx('whitespace-nowrap', a.id === focus && 'text-blue-200')} title={fmtDateTime(a.requested_at)}>{fmtAgo(a.requested_at)}</span> },
    { key: 'summary', header: 'Действие', render: (a) => <span className="block max-w-[320px] whitespace-normal text-slate-200">{a.summary}</span> },
    { key: 'agent', header: 'Агент', render: (a) => (a.agent_key ? names[a.agent_key] ?? <span className="font-mono text-[11px]">{a.agent_key}</span> : '—') },
    { key: 'company', header: 'Компания', render: (a) => (a.company_id ? a.company_name || a.company_id : <span className="text-slate-600">платформа</span>) },
    { key: 'perm', header: 'Право', render: (a) => <span title={a.permission}>{PERMISSION_LABEL[a.permission] ?? a.permission}</span> },
    { key: 'status', header: 'Статус', render: (a) => <StatusChip meta={approvalStatusMeta(a.status)} /> },
    {
      key: 'who',
      header: 'Кто и где решил',
      render: (a) => a.decided_at ? (
        <span className="block max-w-[260px] whitespace-normal">
          {shortActor(a.decided_by)} <span className="text-slate-500">{decidedViaLabel(a.decided_via)}</span>
          <span className="block text-[10px] text-slate-500">{fmtDateTime(a.decided_at)}</span>
          {a.decision_reason && <span className="block text-[11px] text-slate-400">«{a.decision_reason}»</span>}
        </span>
      ) : <span className="text-slate-600">{a.status === 'expired' ? 'никто не решил' : '—'}</span>,
    },
    { key: 'task', header: '', render: (a) => (a.task_id ? <Link href={`${base}/agents/tasks/${a.task_id}`} className="text-[11px] text-blue-300 hover:underline">задача</Link> : null) },
  ]
  return (
    <Panel title="История запросов" bodyClassName="p-0" description="До 100 последних запросов: кто, где и почему решил.">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(a) => a.id}
        loading={loading}
        empty={<EmptyState icon={<Stamp size={18} />} title="Запросов ещё не было" text="Агенты пока ни разу не просили разрешения." />}
      />
    </Panel>
  )
}
