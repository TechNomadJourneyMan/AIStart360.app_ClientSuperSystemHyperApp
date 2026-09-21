'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Circle, Plus, UserCog, XCircle } from 'lucide-react'
import { Button, EmptyState, ErrorState, Field, GigaApiError, Panel, Skeleton, cx, fmtDate, gigaFetch, inputClass, useGigaQuery } from '../kit'

/**
 * Ответственный за клиента и задачи по нему.
 *
 * Сознательно просто: кто ведёт, что сделать, к какому сроку. Колонок,
 * статусов-воронок и подзадач здесь нет — в команде из нескольких человек они
 * добавляют работы, а не порядка.
 */

interface Staff { id: string; name: string; roleLabel: string }
interface Task {
  id: string; title: string; due_at: string | null; status: 'open' | 'done' | 'cancelled'
  assignee_id: string | null; assignee: { full_name: string | null; email: string | null } | null
  created_at: string; done_at: string | null
}
interface Assignment { assignee_id: string | null; person: { full_name: string | null; email: string | null } | null }

const overdue = (t: Task) => t.status === 'open' && !!t.due_at && new Date(t.due_at).getTime() < Date.now()

export function TasksTab({ userId }: { userId: string }) {
  const staff = useGigaQuery<{ data: Staff[] }>('/api/giga-admin/staff/list')
  const assignment = useGigaQuery<{ data: Assignment | null; unavailable?: boolean }>(`/api/giga-admin/users/${userId}/assignment`)
  const tasks = useGigaQuery<{ data: Task[]; unavailable?: boolean }>(`/api/giga-admin/users/${userId}/tasks`)

  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)

  const assign = async (assigneeId: string) => {
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/assignment`, { method: 'PUT', json: { assigneeId: assigneeId || null } })
      toast.success(assigneeId ? 'Ответственный назначен' : 'Ответственный снят')
      assignment.reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось назначить')
    }
  }

  const addTask = async () => {
    if (!title.trim()) return
    setBusy(true)
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/tasks`, {
        method: 'POST',
        json: { title: title.trim(), dueAt: due ? new Date(`${due}T12:00:00`).toISOString() : null },
      })
      setTitle(''); setDue('')
      toast.success('Задача создана')
      tasks.reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось создать')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (t: Task, status: Task['status']) => {
    try {
      await gigaFetch(`/api/giga-admin/tasks/${t.id}`, { method: 'PATCH', json: { status } })
      tasks.reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось изменить')
    }
  }

  const list = tasks.data?.data ?? []
  const open = list.filter((t) => t.status === 'open')
  const closed = list.filter((t) => t.status !== 'open')

  return (
    <div className="space-y-4">
      <Panel title={<span className="flex items-center gap-2"><UserCog size={14} className="text-blue-300" /> Ответственный</span>} description="Кто ведёт этого клиента.">
        {assignment.loading && !assignment.data ? <Skeleton className="h-9" /> : (
          <select
            value={assignment.data?.data?.assignee_id ?? ''}
            onChange={(e) => void assign(e.target.value)}
            className={inputClass}
            aria-label="Ответственный за клиента"
          >
            <option value="">Не назначен</option>
            {(staff.data?.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {s.roleLabel}</option>
            ))}
          </select>
        )}
      </Panel>

      <Panel title="Новая задача">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_auto] md:items-end">
          <Field label="Что сделать">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} className={inputClass} placeholder="Позвонить и разобрать шаг «Финансы»" />
          </Field>
          <Field label="Срок">
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputClass} />
          </Field>
          <Button variant="primary" icon={<Plus size={13} />} loading={busy} disabled={!title.trim()} onClick={() => void addTask()}>Создать</Button>
        </div>
      </Panel>

      <ErrorState error={tasks.error} onRetry={tasks.reload} />
      {(tasks.data?.unavailable || assignment.data?.unavailable) && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 text-xs text-amber-200">
          Хранилище задач недоступно — вероятно, не применена миграция 082.
        </p>
      )}

      <Panel title="Открытые задачи" description={open.length ? undefined : 'Пусто — значит, по клиенту ничего не запланировано.'} bodyClassName="p-0">
        {tasks.loading && !tasks.data ? <div className="p-4"><Skeleton className="h-20" /></div> : !open.length ? (
          <div className="p-4"><EmptyState title="Задач нет" text="Добавьте первую — она появится здесь и в общем списке задач." /></div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {open.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                <button onClick={() => void setStatus(t, 'done')} title="Выполнено" aria-label="Отметить выполненной" className="mt-0.5 text-slate-600 transition-colors hover:text-emerald-400">
                  <Circle size={15} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-200">{t.title}</p>
                  <p className={cx('mt-0.5 text-[11px]', overdue(t) ? 'text-red-300' : 'text-slate-500')}>
                    {t.due_at ? `срок ${fmtDate(t.due_at)}${overdue(t) ? ' · просрочена' : ''}` : 'без срока'}
                    {t.assignee && ` · ${t.assignee.full_name || t.assignee.email}`}
                  </p>
                </div>
                <button onClick={() => void setStatus(t, 'cancelled')} title="Отменить" aria-label="Отменить задачу" className="mt-0.5 text-slate-700 transition-colors hover:text-slate-400">
                  <XCircle size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {closed.length > 0 && (
        <Panel title="Закрытые" bodyClassName="p-0">
          <ul className="divide-y divide-white/[0.05]">
            {closed.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                <CheckCircle2 size={14} className={t.status === 'done' ? 'text-emerald-400' : 'text-slate-600'} />
                <span className="min-w-0 flex-1 truncate text-slate-400 line-through">{t.title}</span>
                <span className="text-[11px] text-slate-600">{t.done_at ? fmtDate(t.done_at) : t.status === 'cancelled' ? 'отменена' : ''}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}
