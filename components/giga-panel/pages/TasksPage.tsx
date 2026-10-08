'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CalendarClock, CheckCircle2, Circle, ListChecks, RefreshCw } from 'lucide-react'
import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'
import { RequirePermission, useStaff } from '@/components/giga-panel/StaffContext'
import {
  Badge, Button, EmptyState, ErrorState, PageHeader, Panel, Select, Skeleton, Tabs, cx, fmtDate, gigaFetch, GigaApiError, inputClass, useGigaQuery,
} from '@/components/giga-panel/kit'
import { dueBucket, type DueBucket } from '@/lib/admin/tasks-due'

/**
 * «Мои задачи» — с чего начать день: все открытые задачи сотрудника по всем
 * клиентам, разложенные по сроку. Закрыть или перенести — прямо в строке,
 * без захода в карточку клиента.
 */

interface Task {
  id: string; user_id: string | null; title: string; due_at: string | null; status: 'open' | 'done' | 'cancelled'
  assignee_id: string | null; created_at: string; done_at: string | null
  client: { id: string; name: string; email: string | null; fullName: string | null } | null
}
interface Staff { id: string; name: string; roleLabel: string }

const SECTIONS: Array<{ key: DueBucket; title: string; tone: 'red' | 'amber' | 'blue' | 'neutral' }> = [
  { key: 'overdue', title: 'Просрочено', tone: 'red' },
  { key: 'today', title: 'Сегодня', tone: 'amber' },
  { key: 'week', title: 'На неделе', tone: 'blue' },
  { key: 'later', title: 'Позже', tone: 'neutral' },
  { key: 'none', title: 'Без срока', tone: 'neutral' },
]

function toDateInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function TasksInner() {
  const { base, label } = useWorkspace()
  const { me, can } = useStaff()
  const [who, setWho] = useState<string>('me')
  const [view, setView] = useState<'open' | 'done'>('open')
  const canOthers = can('experts.manage')
  const staff = useGigaQuery<{ data: Staff[] }>(canOthers ? '/api/giga-admin/staff/list' : null)

  const tz = useMemo(() => new Date().getTimezoneOffset(), [])
  const url = `/api/giga-admin/tasks?assignee=${encodeURIComponent(who)}&status=${view}&tz=${tz}`
  const { data, error, loading, reload } = useGigaQuery<{ data: Task[]; unavailable?: boolean; truncated?: boolean }>(url)
  const [busy, setBusy] = useState<string | null>(null)

  const tasks = useMemo(() => data?.data ?? [], [data])
  const grouped = useMemo(() => {
    const now = new Date()
    const m = new Map<DueBucket, Task[]>()
    for (const t of tasks) {
      const b = dueBucket(t.due_at, now, tz)
      m.set(b, [...(m.get(b) ?? []), t])
    }
    return m
  }, [tasks, tz])

  const patch = async (t: Task, body: Record<string, unknown>, okText: string) => {
    setBusy(t.id)
    try {
      await gigaFetch(`/api/giga-admin/tasks/${t.id}`, { method: 'PATCH', json: body })
      toast.success(okText)
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось изменить задачу')
    } finally {
      setBusy(null)
    }
  }

  const reschedule = (t: Task, date: string) => {
    if (!date) return void patch(t, { dueAt: null }, 'Срок снят')
    // Ручной ввод года даёт промежуточные даты вроде 0002-05-01 — ждём полную.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) < 2000) return
    void patch(t, { dueAt: new Date(`${date}T12:00:00`).toISOString() }, `Перенесено на ${fmtDate(new Date(`${date}T12:00:00`).toISOString())}`)
  }

  const whoOptions = [
    { value: 'me', label: 'Мои задачи' },
    ...(staff.data?.data ?? []).filter((s) => s.id !== me?.id).map((s) => ({ value: s.id, label: `${s.name} — ${s.roleLabel}` })),
  ]

  const row = (t: Task, overdue: boolean) => (
    <li key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
      {view === 'open' ? (
        <button
          onClick={() => void patch(t, { status: 'done' }, 'Задача выполнена')}
          disabled={busy === t.id}
          title="Выполнено"
          aria-label={`Отметить выполненной: ${t.title}`}
          className="mt-0.5 text-slate-600 transition-colors hover:text-emerald-400 disabled:opacity-50"
        >
          <Circle size={16} />
        </button>
      ) : (
        <CheckCircle2 size={16} className="mt-0.5 text-emerald-400" />
      )}
      <div className="min-w-0 flex-1">
        <p className={cx('text-sm', view === 'done' ? 'text-slate-400 line-through' : 'text-slate-200')}>{t.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
          {t.client ? (
            <Link href={`${base}/users/${t.client.id}?tab=tasks`} className="text-blue-300 hover:text-blue-200 hover:underline">
              {t.client.name}
            </Link>
          ) : <span>без клиента</span>}
          {view === 'open'
            ? <span className={overdue ? 'text-red-300' : undefined}>{t.due_at ? `срок ${fmtDate(t.due_at)}` : 'без срока'}</span>
            : <span>выполнена {fmtDate(t.done_at)}</span>}
        </p>
      </div>
      {view === 'open' && (
        <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <CalendarClock size={13} />
          <span className="sr-only">Перенести срок</span>
          <input
            type="date"
            defaultValue={toDateInput(t.due_at)}
            disabled={busy === t.id}
            onChange={(e) => reschedule(t, e.target.value)}
            className={cx(inputClass, 'w-36 py-1 text-xs')}
            aria-label={`Перенести срок: ${t.title}`}
          />
        </label>
      )}
    </li>
  )

  return (
    <div>
      <PageHeader
        crumbs={[{ label, href: base }, { label: 'Мои задачи' }]}
        title="Мои задачи"
        description="Все задачи по клиентам в одном месте: сначала просроченные, затем на сегодня и на неделю."
        actions={
          <>
            {canOthers && whoOptions.length > 1 && <Select label="Чьи задачи" value={who} onChange={setWho} options={whoOptions} />}
            <Button variant="ghost" icon={<RefreshCw size={13} />} onClick={reload} loading={loading && !!data}>Обновить</Button>
          </>
        }
      />
      <Tabs<'open' | 'done'>
        className="mb-4 w-fit"
        value={view}
        onChange={setView}
        tabs={[{ key: 'open', label: 'Открытые', count: view === 'open' && data ? tasks.length : null }, { key: 'done', label: 'Выполненные' }]}
      />
      <ErrorState error={error} onRetry={reload} />
      {data?.unavailable && (
        <p className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 text-xs text-amber-200">
          Хранилище задач недоступно — вероятно, не применена миграция 082.
        </p>
      )}
      {loading && !data ? <Skeleton className="h-64" /> : !tasks.length ? (
        <Panel>
          <EmptyState
            icon={<ListChecks size={18} />}
            title={view === 'open' ? 'Открытых задач нет' : 'Выполненных задач пока нет'}
            text="Задачи создаются в карточке клиента на вкладке «Задачи»."
          />
        </Panel>
      ) : view === 'done' ? (
        <Panel bodyClassName="p-0"><ul className="divide-y divide-white/[0.05]">{tasks.map((t) => row(t, false))}</ul></Panel>
      ) : (
        <div className="space-y-4">
          {SECTIONS.map((s) => {
            const list = grouped.get(s.key) ?? []
            if (!list.length) return null
            return (
              <Panel key={s.key} title={<span className="flex items-center gap-2">{s.title} <Badge tone={s.tone}>{list.length}</Badge></span>} bodyClassName="p-0">
                <ul className="divide-y divide-white/[0.05]">{list.map((t) => row(t, s.key === 'overdue'))}</ul>
              </Panel>
            )
          })}
        </div>
      )}
      {data?.truncated && <p className="mt-3 text-[11px] text-slate-600">Показаны первые 500 задач.</p>}
    </div>
  )
}

export function TasksPage() {
  return (
    <RequirePermission permission="users.sensitive">
      <TasksInner />
    </RequirePermission>
  )
}
