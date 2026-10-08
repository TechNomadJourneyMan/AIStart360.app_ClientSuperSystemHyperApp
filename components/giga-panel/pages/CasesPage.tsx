'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw, Siren } from 'lucide-react'
import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'
import { RequirePermission, useStaff } from '@/components/giga-panel/StaffContext'
import {
  Badge, Button, DataTable, EmptyState, ErrorState, PageHeader, Pagination, Panel, Select, cx, fmtAgo, fmtDateTime, gigaFetch, GigaApiError,
  useGigaQuery, type Column, type Tone,
} from '@/components/giga-panel/kit'

/**
 * «Эскалации» — очередь обращений клиентов к эксперту со сроком реакции.
 * Кейс создаёт ассистент («Позвать эксперта», риск, пробелы в данных) и сразу
 * отдаёт тому, кто ведёт клиента. Здесь их разбирают: взять в работу,
 * переназначить, поменять приоритет, закрыть.
 */

type Status = 'new' | 'in_progress' | 'resolved' | 'closed'
type Priority = 'critical' | 'high' | 'medium' | 'low'
type Sla = 'overdue' | 'due_soon' | 'ok' | 'met' | 'none'

interface CaseRow {
  id: string; user_id: string; status: Status; priority: Priority; trigger_type: string; title: string
  summary: string | null; user_message: string | null; assignee_id: string | null
  sla_due_at: string | null; first_response_at: string | null; created_at: string; updated_at: string
  sla: Sla
  client: { id: string; name: string; email: string | null }
  assignee: { id: string; name: string } | null
}
interface Staff { id: string; name: string; roleLabel: string }

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  new: { label: 'Новый', tone: 'amber' },
  in_progress: { label: 'В работе', tone: 'blue' },
  resolved: { label: 'Решён', tone: 'green' },
  closed: { label: 'Закрыт', tone: 'neutral' },
}
const PRIORITY: Record<Priority, { label: string; tone: Tone }> = {
  critical: { label: 'Критичный', tone: 'red' },
  high: { label: 'Высокий', tone: 'amber' },
  medium: { label: 'Средний', tone: 'blue' },
  low: { label: 'Низкий', tone: 'neutral' },
}
const TRIGGER: Record<string, string> = {
  user_requested_help: 'Клиент позвал эксперта',
  validation_issue: 'Ошибка в данных',
  llm_recommendation: 'Рекомендация ИИ',
  critical_risk: 'Критичный риск',
  incomplete_data: 'Не хватает данных',
  manual: 'Вручную',
}

function duration(ms: number): string {
  const m = Math.max(1, Math.round(Math.abs(ms) / 60_000))
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} ч${m % 60 ? ` ${m % 60} мин` : ''}`
  return `${Math.floor(h / 24)} дн`
}

function SlaBadge({ c, now }: { c: CaseRow; now: number }) {
  if (c.sla === 'met') {
    return c.first_response_at
      ? <span className="text-[11px] text-emerald-400" title={`Взят в работу ${fmtDateTime(c.first_response_at)}`}>реакция {fmtAgo(c.first_response_at)}</span>
      : <span className="text-[11px] text-slate-600">—</span>
  }
  if (!c.sla_due_at) return <span className="text-[11px] text-slate-600">без срока</span>
  const left = new Date(c.sla_due_at).getTime() - now
  if (left <= 0) return <Badge tone="red" title={`Срок: ${fmtDateTime(c.sla_due_at)}`}>Просрочено на {duration(left)}</Badge>
  return <Badge tone={c.sla === 'due_soon' ? 'amber' : 'neutral'} title={`Срок: ${fmtDateTime(c.sla_due_at)}`}>осталось {duration(left)}</Badge>
}

const selectCls = 'rounded-lg border border-white/[0.08] bg-[#0b1128] px-2 py-1 text-[11px] text-slate-200 focus:border-blue-500/40 focus:outline-none disabled:opacity-50'

function CasesInner() {
  const { base, label } = useWorkspace()
  const { can } = useStaff()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const get = (k: string, d = '') => sp.get(k) ?? d
  const setParams = useCallback((patch: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    if (!('page' in patch)) next.delete('page')
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [sp, router, pathname])

  const page = Number(get('page', '1')) || 1
  const url = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), status: get('status', 'open') })
    for (const k of ['priority', 'assignee', 'sla']) if (get(k)) p.set(k, get(k))
    return `/api/giga-admin/cases?${p.toString()}`
  }, [sp]) // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error, loading, reload } = useGigaQuery<{ data: CaseRow[]; total: number; page: number; pageSize: number; scope: 'all' | 'assigned' }>(url)
  const canEdit = can('users.sensitive')
  const staff = useGigaQuery<{ data: Staff[] }>(canEdit ? '/api/giga-admin/staff/list' : null)
  const [busy, setBusy] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id) }, [])
  const focus = get('case')

  const update = async (c: CaseRow, body: Record<string, unknown>, okText: string) => {
    setBusy(c.id)
    try {
      await gigaFetch(`/api/giga-admin/cases/${c.id}`, { method: 'PATCH', json: body })
      toast.success(okText)
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось изменить кейс')
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<CaseRow>[] = [
    {
      key: 'case', header: 'Обращение',
      render: (c) => (
        <div className={cx('min-w-0 max-w-[22rem]', focus === c.id && 'rounded-lg ring-1 ring-blue-400/50')}>
          <p className="truncate font-medium text-slate-100" title={c.title}>{c.title}</p>
          <p className="truncate text-[10px] text-slate-500">
            <Link href={`${base}/users/${c.client.id}`} className="text-blue-300 hover:underline">{c.client.name}</Link>
            {' · '}{TRIGGER[c.trigger_type] ?? c.trigger_type}{' · '}{fmtAgo(c.created_at)}
          </p>
          {c.user_message && <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-400">«{c.user_message}»</p>}
        </div>
      ),
    },
    { key: 'sla', header: 'SLA', render: (c) => <SlaBadge c={c} now={now} /> },
    {
      key: 'priority', header: 'Приоритет',
      render: (c) => canEdit ? (
        <select
          aria-label="Приоритет"
          value={c.priority}
          disabled={busy === c.id}
          onChange={(e) => void update(c, { priority: e.target.value }, 'Приоритет изменён, срок пересчитан')}
          className={selectCls}
        >
          {(Object.keys(PRIORITY) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
        </select>
      ) : <Badge tone={PRIORITY[c.priority]?.tone}>{PRIORITY[c.priority]?.label ?? c.priority}</Badge>,
    },
    {
      key: 'status', header: 'Статус',
      render: (c) => canEdit ? (
        <select
          aria-label="Статус"
          value={c.status}
          disabled={busy === c.id}
          onChange={(e) => void update(c, { status: e.target.value }, 'Статус изменён')}
          className={selectCls}
        >
          {(Object.keys(STATUS) as Status[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </select>
      ) : <Badge tone={STATUS[c.status]?.tone}>{STATUS[c.status]?.label ?? c.status}</Badge>,
    },
    {
      key: 'assignee', header: 'Ответственный',
      render: (c) => canEdit ? (
        <select
          aria-label="Ответственный"
          value={c.assignee_id ?? ''}
          disabled={busy === c.id}
          onChange={(e) => void update(c, { assigneeId: e.target.value || null }, e.target.value ? 'Назначено — ответственный получит уведомление' : 'Ответственный снят')}
          className={cx(selectCls, 'max-w-[11rem]')}
        >
          <option value="">Не назначен</option>
          {c.assignee && !(staff.data?.data ?? []).some((s) => s.id === c.assignee?.id) && <option value={c.assignee.id}>{c.assignee.name}</option>}
          {(staff.data?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ) : <span className="text-slate-400">{c.assignee?.name ?? '—'}</span>,
    },
  ]

  return (
    <div>
      <PageHeader
        crumbs={[{ label, href: base }, { label: 'Эскалации' }]}
        title="Эскалации"
        description={data
          ? `Найдено: ${data.total}${data.scope === 'assigned' ? ' · только ваши клиенты' : ''}`
          : 'Обращения клиентов к эксперту со сроком реакции'}
        actions={<Button variant="ghost" icon={<RefreshCw size={13} />} onClick={reload} loading={loading && !!data}>Обновить</Button>}
      />
      <Panel bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-3">
          <Select label="Статус" value={get('status', 'open')} onChange={(v) => setParams({ status: v === 'open' ? '' : v })} options={[
            { value: 'open', label: 'Открытые' }, { value: 'new', label: 'Новые' }, { value: 'in_progress', label: 'В работе' },
            { value: 'resolved', label: 'Решённые' }, { value: 'closed', label: 'Закрытые' }, { value: 'all', label: 'Все' },
          ]} />
          <Select label="Приоритет" value={get('priority')} onChange={(v) => setParams({ priority: v })} options={[
            { value: '', label: 'Любой приоритет' },
            ...(Object.keys(PRIORITY) as Priority[]).map((p) => ({ value: p, label: PRIORITY[p].label })),
          ]} />
          <Select label="Ответственный" value={get('assignee')} onChange={(v) => setParams({ assignee: v })} options={[
            { value: '', label: 'Все ответственные' }, { value: 'me', label: 'Назначены мне' }, { value: 'none', label: 'Без ответственного' },
          ]} />
          <Select label="SLA" value={get('sla')} onChange={(v) => setParams({ sla: v })} options={[
            { value: '', label: 'Любой срок' }, { value: 'overdue', label: 'Только просроченные' },
          ]} />
        </div>
        {error && <div className="p-3"><ErrorState error={error} onRetry={reload} /></div>}
        <DataTable
          columns={columns}
          rows={data?.data}
          rowKey={(c) => c.id}
          loading={loading}
          empty={<EmptyState icon={<Siren size={18} />} title="Эскалаций нет" text="Когда клиент позовёт эксперта или ассистент найдёт риск, обращение появится здесь." />}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(p) => setParams({ page: String(p) })} />}
      </Panel>
    </div>
  )
}

export function CasesPage() {
  return (
    <RequirePermission permission="users.view">
      <Suspense fallback={null}>
        <CasesInner />
      </Suspense>
    </RequirePermission>
  )
}
