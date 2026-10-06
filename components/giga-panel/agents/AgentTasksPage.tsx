'use client'

/**
 * «Задачи агентов» — the agent_tasks ledger with status / agent / company
 * filters (kept in the URL so links from cards and alerts land filtered) and
 * cursor pagination («Показать ещё»).
 */
import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { RequirePermission } from '../StaffContext'
import { useWorkspace } from '../WorkspaceContext'
import { Button, EmptyState, ErrorState, PageHeader, Panel, Select, gigaFetch, useGigaQuery } from '../kit'
import { CompanyPicker } from './CompanyPicker'
import { TASK_STATUS, TASK_STATUSES, type TaskStatus } from './model'
import { TasksTable } from './TasksTable'
import type { TaskRow, TasksResponse } from './types'
import { useAgentDirectory } from './useAgentDirectory'
import { ChipFilter } from './ui'

const PAGE_SIZE = 50
const STATUS_OPTIONS = [{ value: '', label: 'Все' }, ...TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS[s].label }))]

export function AgentTasksPage() {
  const { base } = useWorkspace()
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname() ?? `${base}/agents/tasks`
  const rawStatus = sp.get('status') ?? ''
  const status = (TASK_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as TaskStatus) : ''
  const agent = sp.get('agent') ?? ''
  const companyId = sp.get('company') ?? ''
  const companyName = sp.get('cname')
  const dir = useAgentDirectory()

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const qs = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (status) qs.set('status', status)
  if (agent) qs.set('agent', agent)
  if (companyId) qs.set('company', companyId)
  const url = `/api/giga-admin/agents/tasks?${qs}`
  const q = useGigaQuery<TasksResponse>(url)

  const [more, setMore] = useState<{ url: string; items: TaskRow[]; cursor: string | null } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const extra = more?.url === url ? more : null
  const rows = q.data ? dedupe([...q.data.items, ...(extra?.items ?? [])]) : null
  const cursor = extra ? extra.cursor : q.data?.nextCursor ?? null

  const loadMore = async () => {
    if (!cursor) return
    setLoadingMore(true)
    setMoreError(null)
    try {
      const r = await gigaFetch<TasksResponse>(`${url}&before=${encodeURIComponent(cursor)}`)
      setMore({ url, items: [...(extra?.items ?? []), ...r.items], cursor: r.nextCursor })
    } catch (e) {
      setMoreError(e instanceof Error ? e.message : 'Не удалось загрузить')
    } finally {
      setLoadingMore(false)
    }
  }

  const refresh = () => { setMore(null); setMoreError(null); void q.reload() }
  const agentOptions = agent && !dir.options.some((o) => o.value === agent) ? [...dir.options, { value: agent, label: agent }] : dir.options
  const filtered = !!(status || agent || companyId)

  return (
    <RequirePermission permission="agents.view">
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: base }, { label: 'ИИ-агенты', href: `${base}/agents` }, { label: 'Задачи агентов' }]}
        title="Задачи агентов"
        description="Каждая задача — одна работа агента: от постановки в очередь до результата. Dead-letter — задачи, исчерпавшие все попытки."
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={q.loading && !!q.data} onClick={refresh}>Обновить</Button>}
      />
      <Panel bodyClassName="p-0">
        <div className="space-y-3 border-b border-white/[0.06] p-3">
          <ChipFilter label="Статус задачи" value={status} options={STATUS_OPTIONS} onChange={(v) => setParams({ status: v || null })} />
          <div className="flex flex-wrap items-center gap-2">
            <Select label="Агент" value={agent} options={agentOptions} onChange={(v) => setParams({ agent: v || null })} />
            <div className="min-w-[240px] flex-1 sm:max-w-sm">
              <CompanyPicker
                compact
                label="Фильтр по компании"
                value={companyId ? { id: companyId, name: companyName } : null}
                onChange={(c) => setParams({ company: c?.id ?? null, cname: c?.name ?? null })}
              />
            </div>
            {filtered && <Button size="sm" variant="ghost" onClick={() => router.replace(pathname, { scroll: false })}>Сбросить фильтры</Button>}
          </div>
        </div>
        {q.error && <div className="p-3"><ErrorState error={q.error} onRetry={refresh} /></div>}
        <TasksTable
          rows={rows}
          loading={q.loading}
          base={base}
          agentNames={dir.names}
          onCompany={(c) => setParams({ company: c.id, cname: c.name })}
          empty={filtered
            ? <EmptyState title="Задач по этим условиям нет" text="Измените статус, агента или компанию." action={<Button size="sm" onClick={() => router.replace(pathname, { scroll: false })}>Сбросить фильтры</Button>} />
            : <EmptyState title="Задач ещё не было" text="Задачи появятся, когда агент сработает на событие, по расписанию или после ручного запуска." />}
        />
        {rows && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-[11px] text-slate-500">
            <span>Показано: {rows.length}{cursor ? '' : ' — это все задачи по фильтру'}</span>
            {moreError && <span role="alert" className="text-red-300">{moreError}</span>}
            {cursor && <Button size="sm" loading={loadingMore} onClick={() => void loadMore()}>Показать ещё</Button>}
          </div>
        )}
      </Panel>
    </RequirePermission>
  )
}

function dedupe(rows: TaskRow[]): TaskRow[] {
  const seen = new Set<string>()
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
}
