'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { RefreshCw, UserCheck, UserMinus, UserPlus } from 'lucide-react'
import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import {
  Badge, Button, DataTable, Drawer, EmptyState, ErrorState, PageHeader, Panel, SearchInput, Skeleton, cx, fmtAgo, gigaFetch, GigaApiError,
  useDebounced, useGigaQuery, type Column,
} from '@/components/giga-panel/kit'

/**
 * Модуль «Эксперты»: кто из SuperExpert-ов чем загружен, кого из клиентов
 * он ведёт и видит ли он всю базу или только своих. Назначение клиентов —
 * пачкой, из поиска.
 */

interface Expert {
  id: string; name: string; email: string | null; status: string | null
  clientScope: 'all' | 'assigned'; grantedAt: string | null
  load: { clients: number; openCases: number; overdueCases: number; overdueTasks: number }
  lastActivityAt: string | null; manageable: boolean
}
interface AssignedClient { id: string; name: string; email: string | null; status: string | null; assignedAt: string }
interface UserHit { id: string; email: string | null; full_name: string | null; company_name: string | null; organization: string | null; assignee_id?: string | null; staff_role: string | null }

function ScopeToggle({ e, onChanged }: { e: Expert; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const set = async (scope: 'all' | 'assigned') => {
    if (scope === e.clientScope) return
    setBusy(true)
    try {
      await gigaFetch(`/api/giga-admin/staff/${e.id}/scope`, { method: 'PUT', json: { scope } })
      toast.success(scope === 'assigned' ? `${e.name} теперь видит только назначенных клиентов` : `${e.name} теперь видит всех клиентов`)
      onChanged()
    } catch (err) {
      toast.error(err instanceof GigaApiError ? err.message : 'Не удалось изменить видимость')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div role="radiogroup" aria-label={`Видимость клиентов: ${e.name}`} className="inline-flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
      {(['all', 'assigned'] as const).map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={e.clientScope === s}
          disabled={busy || !e.manageable}
          onClick={(ev) => { ev.stopPropagation(); void set(s) }}
          className={cx(
            'rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
            e.clientScope === s ? 'bg-blue-500/20 text-blue-200' : 'text-slate-500 hover:text-slate-300',
          )}
        >
          {s === 'all' ? 'Все клиенты' : 'Только назначенные'}
        </button>
      ))}
    </div>
  )
}

function ClientsDrawer({ expert, onClose, onChanged }: { expert: Expert | null; onClose: () => void; onChanged: () => void }) {
  const { base } = useWorkspace()
  const assigned = useGigaQuery<{ data: AssignedClient[]; unavailable?: boolean }>(expert ? `/api/giga-admin/experts/${expert.id}/clients` : null)
  const [q, setQ] = useState('')
  const debounced = useDebounced(q, 350)
  const search = useGigaQuery<{ data: UserHit[] }>(expert && debounced.trim().length >= 2
    ? `/api/giga-admin/users?pageSize=20&role=client&q=${encodeURIComponent(debounced.trim())}`
    : null)
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [drop, setDrop] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n }
  const reset = () => { setPick(new Set()); setDrop(new Set()); setQ('') }

  const run = async (method: 'POST' | 'DELETE', ids: Set<string>) => {
    if (!expert || !ids.size) return
    setBusy(true)
    try {
      const r = await gigaFetch<{ assigned?: number; removed?: number; skipped?: number }>(`/api/giga-admin/experts/${expert.id}/clients`, { method, json: { userIds: Array.from(ids) } })
      toast.success(method === 'POST'
        ? `Назначено клиентов: ${r.assigned ?? 0}${r.skipped ? ` (уже были у эксперта: ${r.skipped})` : ''}`
        : `Снято назначений: ${r.removed ?? 0}`)
      reset()
      assigned.reload()
      onChanged()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  const assignedIds = new Set((assigned.data?.data ?? []).map((c) => c.id))
  const hits = (search.data?.data ?? []).filter((u) => !u.staff_role && !assignedIds.has(u.id))

  return (
    <Drawer open={!!expert} onClose={() => { reset(); onClose() }} title={expert ? `Клиенты: ${expert.name}` : ''} width="max-w-2xl">
      {expert && (
        <div className="space-y-4">
          <Panel title="Назначить клиентов" description="Найдите клиентов и отметьте нужных. Клиент ведётся одним ответственным: назначение снимет прежнего.">
            <SearchInput value={q} onChange={setQ} placeholder="Имя, email, компания (от 2 символов)" />
            {search.loading && <Skeleton className="mt-3 h-16" />}
            {!!hits.length && (
              <ul className="mt-3 max-h-64 divide-y divide-white/[0.05] overflow-y-auto rounded-xl border border-white/[0.06]">
                {hits.map((u) => (
                  <li key={u.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-xs hover:bg-white/[0.03]">
                      <input type="checkbox" checked={pick.has(u.id)} onChange={() => setPick((s) => toggle(s, u.id))} className="h-3.5 w-3.5 accent-blue-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-slate-200">{u.company_name || u.organization || u.full_name || u.email}</span>
                        <span className="block truncate text-[10px] text-slate-500">{[u.full_name, u.email].filter(Boolean).join(' · ')}</span>
                      </span>
                      {u.assignee_id && <Badge tone="amber">есть ответственный</Badge>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {debounced.trim().length >= 2 && !search.loading && !hits.length && <p className="mt-3 text-[11px] text-slate-600">Никого не нашли (сотрудники и уже назначенные скрыты).</p>}
            <div className="mt-3 flex justify-end">
              <Button variant="primary" icon={<UserPlus size={13} />} disabled={!pick.size} loading={busy} onClick={() => void run('POST', pick)}>
                Назначить{pick.size ? ` (${pick.size})` : ''}
              </Button>
            </div>
          </Panel>

          <Panel
            title={`Ведёт сейчас${assigned.data ? ` · ${assigned.data.data.length}` : ''}`}
            actions={drop.size ? <Button size="sm" variant="danger" icon={<UserMinus size={12} />} loading={busy} onClick={() => void run('DELETE', drop)}>Снять назначение ({drop.size})</Button> : undefined}
            bodyClassName="p-0"
          >
            <ErrorState error={assigned.error} onRetry={assigned.reload} />
            {assigned.loading && !assigned.data ? <div className="p-4"><Skeleton className="h-24" /></div> : !(assigned.data?.data ?? []).length ? (
              <div className="p-4"><EmptyState title="Клиентов пока нет" text="Назначьте клиентов через поиск выше." /></div>
            ) : (
              <ul className="divide-y divide-white/[0.05]">
                {(assigned.data?.data ?? []).map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                    <input
                      type="checkbox"
                      aria-label={`Выбрать для снятия: ${c.name}`}
                      checked={drop.has(c.id)}
                      onChange={() => setDrop((s) => toggle(s, c.id))}
                      className="h-3.5 w-3.5 accent-red-500"
                    />
                    <Link href={`${base}/users/${c.id}`} className="min-w-0 flex-1 truncate text-slate-200 hover:text-blue-200 hover:underline">{c.name}</Link>
                    <span className="text-[10px] text-slate-600">с {fmtAgo(c.assignedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </Drawer>
  )
}

function ExpertsInner() {
  const { base, label } = useWorkspace()
  const { data, error, loading, reload } = useGigaQuery<{ data: Expert[]; scopeAvailable: boolean }>('/api/giga-admin/experts')
  const [open, setOpen] = useState<Expert | null>(null)

  const columns: Column<Expert>[] = [
    {
      key: 'name', header: 'Эксперт',
      render: (e) => (
        <div className="min-w-0">
          <Link href={`${base}/users/${e.id}`} className="block truncate font-medium text-slate-100 hover:underline">{e.name}</Link>
          <p className="truncate text-[10px] text-slate-500">{e.email}{e.status && e.status !== 'approved' ? ` · ${e.status}` : ''}</p>
        </div>
      ),
    },
    { key: 'clients', header: 'Клиенты', render: (e) => <span className="font-mono text-slate-100">{e.load.clients}</span> },
    {
      key: 'cases', header: 'Эскалации',
      render: (e) => (
        <span className="flex items-center gap-1.5">
          <span className="font-mono">{e.load.openCases}</span>
          {e.load.overdueCases > 0 && <Badge tone="red">просрочено {e.load.overdueCases}</Badge>}
        </span>
      ),
    },
    {
      key: 'tasks', header: 'Просроч. задачи',
      render: (e) => e.load.overdueTasks ? <Badge tone="amber">{e.load.overdueTasks}</Badge> : <span className="text-slate-600">0</span>,
    },
    { key: 'seen', header: 'Активность', render: (e) => <span className="text-slate-400">{fmtAgo(e.lastActivityAt)}</span> },
    { key: 'scope', header: 'Видит', render: (e) => data?.scopeAvailable === false ? <span className="text-[11px] text-slate-600">нужна миграция 086</span> : <ScopeToggle e={e} onChanged={reload} /> },
    {
      key: 'actions', header: '',
      render: (e) => <Button size="sm" variant="secondary" icon={<UserCheck size={12} />} onClick={() => setOpen(e)}>Назначить клиентов</Button>,
    },
  ]

  return (
    <div>
      <PageHeader
        crumbs={[{ label, href: base }, { label: 'Эксперты' }]}
        title="Эксперты"
        description="Нагрузка SuperExpert-ов, видимость клиентов и назначение клиентов."
        actions={<Button variant="ghost" icon={<RefreshCw size={13} />} onClick={reload} loading={loading && !!data}>Обновить</Button>}
      />
      <Panel bodyClassName="p-0">
        {error && <div className="p-3"><ErrorState error={error} onRetry={reload} /></div>}
        <DataTable
          columns={columns}
          rows={data?.data}
          rowKey={(e) => e.id}
          loading={loading}
          empty={<EmptyState icon={<UserCheck size={18} />} title="Экспертов пока нет" text="Выдайте роль SuperExpert в разделе «Роли и права»." />}
        />
      </Panel>
      <ClientsDrawer expert={open} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  )
}

export function ExpertsPage() {
  return (
    <RequirePermission permission="experts.manage">
      <ExpertsInner />
    </RequirePermission>
  )
}
