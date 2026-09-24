'use client'

import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import { Badge, Button, EmptyState, ErrorState, GigaApiError, PageHeader, Panel, Skeleton, StatTile, fmtAgo, fmtDateTime, gigaFetch, useGigaQuery } from '@/components/giga-panel/kit'
import { CASE_PRIORITY, CASE_STATUS, CASE_TRIGGER } from '@/lib/admin/case-labels'

/**
 * «Мой день» — с чего сотрудник начинает работу: мои задачи по срокам,
 * открытые обращения клиентов по приоритету и что изменилось у клиентов с
 * момента, когда я последний раз открывал их карточку.
 */

interface Who { id: string; name: string }
interface Task { id: string; user_id: string | null; title: string; due_at: string | null; status: string; user: Who | null }
interface CaseRow { id: string; user_id: string; status: string; priority: string; trigger_type: string; title: string; created_at: string; user: Who | null }
interface Change { userId: string; user: Who | null; lines: string[]; changedAt: string | null; lastViewedAt: string | null }
interface Today {
  clientScope: 'all' | 'assigned'
  generatedAt: string
  tasks: { overdue: Task[]; today: Task[]; week: Task[]; later: Task[]; noDate: Task[] }
  cases: { total: number; groups: Array<{ priority: string; items: CaseRow[] }>; unavailable: boolean }
  changes: Change[]
  unavailable: { tasks: boolean; views: boolean }
}

function TaskList({ title, tone, tasks, base, onDone }: { title: string; tone: 'red' | 'amber' | 'blue' | 'neutral'; tasks: Task[]; base: string; onDone: (t: Task) => void }) {
  if (!tasks.length) return null
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-slate-400">{title}<Badge tone={tone}>{tasks.length}</Badge></p>
      <ul className="space-y-1.5">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-start gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2">
            <button onClick={() => onDone(t)} title="Отметить выполненной" aria-label="Отметить задачу выполненной" className="mt-0.5 text-slate-600 transition-colors hover:text-emerald-400">
              <CheckCircle2 size={15} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-200">{t.title}</p>
              <p className="text-[11px] text-slate-500">
                {t.due_at ? fmtDateTime(t.due_at) : 'без срока'}
                {t.user && <> · <Link className="text-blue-300 hover:underline" href={`${base}/users/${t.user.id}?tab=tasks`}>{t.user.name}</Link></>}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TodayInner() {
  const { base, label } = useWorkspace()
  const tz = typeof window === 'undefined' ? -300 : new Date().getTimezoneOffset()
  const { data, error, loading, reload } = useGigaQuery<{ data: Today }>(`/api/giga-admin/me/today?tz=${tz}`)
  const d = data?.data
  const [busyTask, setBusyTask] = useState<string | null>(null)

  const done = async (t: Task) => {
    if (busyTask) return
    setBusyTask(t.id)
    try {
      await gigaFetch(`/api/giga-admin/tasks/${t.id}`, { method: 'PATCH', json: { status: 'done' } })
      toast.success('Задача выполнена')
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось изменить задачу')
    } finally {
      setBusyTask(null)
    }
  }

  const tasksOpen = d ? d.tasks.overdue.length + d.tasks.today.length + d.tasks.week.length + d.tasks.later.length + d.tasks.noDate.length : 0

  return (
    <div>
      <PageHeader
        crumbs={[{ label, href: base }, { label: 'Мой день' }]}
        title="Мой день"
        description={d ? `${d.clientScope === 'assigned' ? 'Только назначенные вам клиенты' : 'Все клиенты платформы'} · обновлено ${fmtAgo(d.generatedAt)}` : 'Задачи, обращения клиентов и изменения с вашего последнего просмотра'}
        actions={<Button variant="ghost" icon={<RefreshCw size={13} />} onClick={reload} loading={loading && !!d}>Обновить</Button>}
      />
      <ErrorState error={error} onRetry={reload} />
      {!d && loading && <Skeleton className="h-64" />}
      {d && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Просрочено" value={d.tasks.overdue.length} hint="моих задач" tone={d.tasks.overdue.length ? 'red' : 'green'} />
            <StatTile label="На сегодня" value={d.tasks.today.length} hint={`всего открыто: ${tasksOpen}`} tone="amber" />
            <StatTile label="Открытых обращений" value={d.cases.total} hint="new + в работе" tone="violet" />
            <StatTile label="Изменилось у клиентов" value={d.changes.length} hint="с вашего просмотра" tone="blue" />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Мои задачи" description="Задачи, где вы ответственный">
              {d.unavailable.tasks && <p className="mb-2 text-xs text-amber-300">Хранилище задач недоступно.</p>}
              {!tasksOpen ? (
                <EmptyState title="Открытых задач нет" text="Задачи ставятся во вкладке «Задачи» карточки клиента." />
              ) : (
                <div className="space-y-4">
                  <TaskList title="Просрочено" tone="red" tasks={d.tasks.overdue} base={base} onDone={done} />
                  <TaskList title="Сегодня" tone="amber" tasks={d.tasks.today} base={base} onDone={done} />
                  <TaskList title="Ближайшие 7 дней" tone="blue" tasks={d.tasks.week} base={base} onDone={done} />
                  <TaskList title="Позже" tone="neutral" tasks={d.tasks.later} base={base} onDone={done} />
                  <TaskList title="Без срока" tone="neutral" tasks={d.tasks.noDate} base={base} onDone={done} />
                </div>
              )}
            </Panel>

            <Panel title="Открытые обращения" description="Эскалации Smart Assistant, которые ждут эксперта">
              {d.cases.unavailable && <p className="mb-2 text-xs text-amber-300">Хранилище кейсов недоступно.</p>}
              {!d.cases.total ? (
                <EmptyState title="Открытых обращений нет" />
              ) : (
                <div className="space-y-4">
                  {d.cases.groups.map((g) => (
                    <div key={g.priority}>
                      <p className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-slate-400">
                        <Badge tone={CASE_PRIORITY[g.priority]?.tone}>{CASE_PRIORITY[g.priority]?.label ?? g.priority}</Badge>{g.items.length}
                      </p>
                      <ul className="space-y-1.5">
                        {g.items.map((c) => (
                          <li key={c.id}>
                            <Link href={`${base}/users/${c.user_id}?tab=cases`} className="block rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2 transition-colors hover:border-white/[0.12]">
                              <p className="flex items-center gap-2 text-sm text-slate-200">{c.title}<Badge tone={CASE_STATUS[c.status]?.tone}>{CASE_STATUS[c.status]?.label ?? c.status}</Badge></p>
                              <p className="text-[11px] text-slate-500">{c.user?.name ?? 'Клиент'} · {CASE_TRIGGER[c.trigger_type] ?? c.trigger_type} · ждёт {fmtAgo(c.created_at)}</p>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Panel className="mt-4" title="Что изменилось" description="Клиенты, которых вы открывали или которые назначены вам: изменения после вашего последнего просмотра карточки">
            {d.unavailable.views && <p className="mb-2 text-xs text-amber-300">История просмотров недоступна — вероятно, не применена миграция 086.</p>}
            {!d.changes.length ? (
              <EmptyState title="Ничего нового" text="Когда клиент обновит анкету, пройдёт GRI, пересчитает Точку А или загрузит документ, он появится здесь." />
            ) : (
              <ul className="divide-y divide-white/[0.05]">
                {d.changes.map((c) => (
                  <li key={c.userId}>
                    <Link href={`${base}/users/${c.userId}`} className="flex flex-wrap items-start justify-between gap-2 py-2.5 hover:bg-white/[0.02]">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-200">{c.user?.name ?? 'Клиент'}</p>
                        <p className="text-xs text-slate-400">{c.lines.join(' · ')}</p>
                      </div>
                      <p className="text-right text-[11px] text-slate-500">
                        {c.changedAt ? fmtAgo(c.changedAt) : ''}
                        <br />
                        {c.lastViewedAt ? `вы смотрели ${fmtAgo(c.lastViewedAt)}` : 'ещё не открывали'}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}

export function TodayPage() {
  return (
    <RequirePermission permission="users.sensitive">
      <TodayInner />
    </RequirePermission>
  )
}
