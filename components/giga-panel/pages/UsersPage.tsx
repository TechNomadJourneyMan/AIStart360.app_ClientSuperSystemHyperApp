'use client'

import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'

import { Suspense, useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { RequirePermission, useStaff } from '@/components/giga-panel/StaffContext'
import {
  Badge, Button, DataTable, ErrorState, PageHeader, Pagination, Panel, SearchInput, Select, fmtAgo, fmtDate, useDebounced, useGigaQuery, type Column,
} from '@/components/giga-panel/kit'
import { PROFILE_ROLE, PROFILE_STATUS } from '@/lib/admin/labels'
import { SURVEY_TOTAL_STEPS } from '@/lib/survey/steps'
import { BellRing, Download } from 'lucide-react'
import { toast } from 'sonner'
import { BulkRemindDialog } from '@/components/giga-panel/user360/BulkRemindDialog'
import { UsersBulkBar } from '@/components/giga-panel/UsersBulkBar'
import { BULK_PERMISSIONS } from '@/lib/admin/bulk-users-shared'
import { STAFF_ROLE_LABELS, type StaffRole } from '@/lib/admin/rbac'
import { useEffect, useState } from 'react'

interface UserRow {
  id: string; email: string | null; full_name: string | null; role: string; status: string; tier: string | null
  organization: string | null; company_name: string | null; created_at: string; last_seen_at: string | null
  survey_steps: number; survey_filled_steps: number[] | null
  gri_index: number | null; gri_runs: number; gri_draft: boolean; diag_score: number | null; staff_role: StaffRole | null
  /** Кто ведёт клиента (user_assignments, миграция 088). */
  assignee_id?: string | null
}
interface StaffRef { id: string; name: string; roleLabel: string }

/** Номера шагов, которых человек не касался. */
function missingSteps(u: UserRow): number[] {
  const filled = new Set(u.survey_filled_steps ?? [])
  return Array.from({ length: SURVEY_TOTAL_STEPS }, (_, i) => i + 1).filter((n) => !filled.has(n))
}

const SEGMENTS = [
  { value: '', label: 'Все сегменты' },
  { value: 'new_7d', label: 'Новые (7 дней)' },
  { value: 'active_7d', label: 'Активные (7 дней)' },
  { value: 'inactive_30d', label: 'Неактивные 30+ дней' },
  { value: 'survey_not_started', label: 'Анкета не начата' },
  { value: 'survey_in_progress', label: 'Анкета в процессе' },
  { value: 'survey_completed', label: 'Анкета заполнена' },
  { value: 'gri_not_started', label: 'GRI не начат' },
  { value: 'gri_in_progress', label: 'GRI в процессе' },
  { value: 'gri_completed', label: 'GRI пройден' },
  { value: 'staff', label: 'Персонал' },
] as const
const STATUSES = [{ value: '', label: 'Любой статус' }, ...Object.entries(PROFILE_STATUS).map(([value, v]) => ({ value, label: v.label }))]
const ROLES = [{ value: '', label: 'Любая роль' }, ...['client', 'expert', 'owner', 'admin', 'super_admin'].map((value) => ({ value, label: PROFILE_ROLE[value] }))]
const ASSIGNEE = [
  { value: '', label: 'Все клиенты' },
  { value: 'me', label: 'Мои клиенты' },
  { value: 'none', label: 'Без ответственного' },
] as const

function UsersInner() {
  const { base, label } = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const get = (k: string, d = '') => sp.get(k) ?? d
  const [q, setQ] = useState(get('q'))
  const debounced = useDebounced(q, 350)

  const setParams = useCallback((patch: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    if (!('page' in patch)) next.delete('page')
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [sp, router, pathname])

  useEffect(() => { if (debounced !== get('q')) setParams({ q: debounced }) }, [debounced]) // eslint-disable-line react-hooks/exhaustive-deps

  const page = Number(get('page', '1')) || 1
  const sort = get('sort', 'created_at')
  const dir = (get('dir', 'desc') === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
  const url = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '25', sort, dir })
    for (const k of ['q', 'segment', 'status', 'role', 'assignee']) if (get(k)) p.set(k, get(k))
    return `/api/giga-admin/users?${p.toString()}`
  }, [sp]) // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error, loading, reload } = useGigaQuery<{ data: UserRow[]; total: number; page: number; pageSize: number }>(url)
  const { can } = useStaff()
  // Выбор живёт между страницами: храним сами строки, чтобы предпросмотр
  // массового действия знал статусы и тех, кто уже не на экране.
  const [selected, setSelected] = useState<Map<string, UserRow>>(new Map())
  const [remindOpen, setRemindOpen] = useState(false)
  const staff = useGigaQuery<{ data: StaffRef[] }>('/api/giga-admin/staff/list')
  const staffById = useMemo(() => new Map((staff.data?.data ?? []).map((s) => [s.id, s])), [staff.data])

  const rows = data?.data ?? []
  const chosen = Array.from(selected.values())
  // Напоминать есть смысл только тем, кто анкету не закончил.
  const remindChosen = chosen.filter((u) => u.survey_steps < SURVEY_TOTAL_STEPS)
  const allChosen = rows.length > 0 && rows.every((u) => selected.has(u.id))

  const toggle = (u: UserRow) => setSelected((prev) => {
    const next = new Map(prev)
    if (next.has(u.id)) next.delete(u.id); else next.set(u.id, u)
    return next
  })
  const toggleAll = () => setSelected((prev) => {
    const next = new Map(prev)
    if (allChosen) for (const u of rows) next.delete(u.id)
    else for (const u of rows) next.set(u.id, u)
    return next
  })

  const exportCsv = () => {
    const p = new URLSearchParams({ sort, dir })
    for (const k of ['q', 'segment', 'status', 'role']) if (get(k)) p.set(k, get(k))
    toast.success('Готовим файл — он скачается через пару секунд')
    window.location.href = `/api/giga-admin/users/export?${p.toString()}`
  }

  const canRemind = can('users.invite') && can('users.sensitive')
  const canBulk = canRemind || Object.values(BULK_PERMISSIONS).some((ps) => ps.every((p) => can(p)))
  const columns: Column<UserRow>[] = [
    ...(canBulk ? [{
      key: 'pick',
      header: (
        <input
          type="checkbox"
          checked={allChosen}
          onChange={toggleAll}
          aria-label="Выбрать всех на странице"
          className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
        />
      ) as unknown as string,
      render: (u: UserRow) => (
        <input
          type="checkbox"
          checked={selected.has(u.id)}
          onChange={() => toggle(u)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Выбрать: ${u.company_name || u.full_name || u.email || u.id}`}
          className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
        />
      ),
    } as Column<UserRow>] : []),
    {
      key: 'name', header: 'Пользователь', sortKey: 'name',
      render: (u) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-100">{u.company_name || u.organization || u.full_name || u.email}</p>
          <p className="truncate text-[10px] text-slate-500">{[u.full_name, u.email].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    {
      key: 'status', header: 'Статус',
      render: (u) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={PROFILE_STATUS[u.status]?.tone}>{PROFILE_STATUS[u.status]?.label ?? u.status}</Badge>
          <Badge>{PROFILE_ROLE[u.role] ?? u.role}</Badge>
          {u.staff_role && <Badge tone="violet">{STAFF_ROLE_LABELS[u.staff_role]}</Badge>}
          {u.tier === 'pro' && <Badge tone="blue">Pro</Badge>}
        </div>
      ),
    },
    {
      key: 'survey', header: 'Анкета', sortKey: 'survey',
      render: (u) => (
        <div className="w-24">
          <div className="flex justify-between text-[10px]"><span>{u.survey_steps}/12</span></div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div className={u.survey_steps >= 12 ? 'h-full bg-emerald-400' : 'h-full bg-blue-400'} style={{ width: `${(u.survey_steps / 12) * 100}%` }} />
          </div>
        </div>
      ),
    },
    {
      key: 'gri', header: 'GRI', sortKey: 'gri',
      render: (u) => u.gri_index != null
        ? <span className="font-mono font-semibold text-slate-100">{u.gri_index.toFixed(1)}<span className="ml-1 text-[10px] font-normal text-slate-500">×{u.gri_runs}</span></span>
        : u.gri_draft ? <Badge tone="amber">в процессе</Badge> : <span className="text-slate-600">—</span>,
    },
    {
      key: 'stuck', header: 'Где застрял',
      render: (u) => {
        const miss = missingSteps(u)
        if (!miss.length) return <span className="text-[11px] text-emerald-400">всё заполнено</span>
        if (miss.length === SURVEY_TOTAL_STEPS) return <span className="text-[11px] text-slate-500">не начинал</span>
        return (
          <span className="flex flex-wrap gap-1" title={`Не заполнены шаги: ${miss.join(', ')}`}>
            {miss.slice(0, 5).map((n) => (
              <span key={n} className="rounded border border-amber-500/20 bg-amber-500/[0.08] px-1 text-[10px] text-amber-200">{n}</span>
            ))}
            {miss.length > 5 && <span className="text-[10px] text-slate-500">+{miss.length - 5}</span>}
          </span>
        )
      },
    },
    {
      key: 'assignee', header: 'Ответственный',
      render: (u) => {
        if (!u.assignee_id) return <span className="text-slate-600">—</span>
        const s = staffById.get(u.assignee_id)
        return <span className="block max-w-[9rem] truncate text-slate-300" title={s ? `${s.name} — ${s.roleLabel}` : undefined}>{s?.name ?? 'сотрудник'}</span>
      },
    },
    { key: 'pointa', header: 'Точка А', render: (u) => u.diag_score != null ? <span className="font-mono">{Math.round(u.diag_score)}</span> : <span className="text-slate-600">—</span> },
    { key: 'seen', header: 'Активность', sortKey: 'last_seen_at', render: (u) => <span className="text-slate-400">{fmtAgo(u.last_seen_at)}</span> },
    { key: 'created', header: 'Регистрация', sortKey: 'created_at', render: (u) => <span className="text-slate-400">{fmtDate(u.created_at)}</span> },
  ]

  return (
    <div>
      <PageHeader
        crumbs={[{ label, href: base }, { label: 'Пользователи' }]}
        title="Пользователи"
        description={data ? `Найдено: ${data.total}` : 'Все аккаунты платформы: поиск, сегменты, прогресс'}
        actions={
          <>
            {canRemind && (
              <Button
                variant="secondary"
                icon={<BellRing size={13} />}
                disabled={!remindChosen.length}
                onClick={() => setRemindOpen(true)}
              >
                Напомнить{remindChosen.length ? ` (${remindChosen.length})` : ''}
              </Button>
            )}
            <Button variant="ghost" icon={<Download size={13} />} onClick={exportCsv}>Выгрузить</Button>
          </>
        }
      />
      <Panel bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Имя, email, компания, телефон, id" className="min-w-[220px] flex-1" />
          <Select label="Сегмент" value={get('segment') as (typeof SEGMENTS)[number]['value']} onChange={(v) => setParams({ segment: v })} options={SEGMENTS} />
          <Select label="Статус" value={get('status')} onChange={(v) => setParams({ status: v })} options={STATUSES} />
          <Select label="Роль" value={get('role')} onChange={(v) => setParams({ role: v })} options={ROLES} />
          <Select label="Ответственный" value={get('assignee') as (typeof ASSIGNEE)[number]['value']} onChange={(v) => setParams({ assignee: v })} options={ASSIGNEE} />
        </div>
        {error && <div className="p-3"><ErrorState error={error} onRetry={reload} /></div>}
        <DataTable
          columns={columns}
          rows={data?.data}
          rowKey={(u) => u.id}
          loading={loading}
          sort={{ key: sort, dir }}
          onSort={(key) => setParams({ sort: key, dir: sort === key && dir === 'desc' ? 'asc' : 'desc' })}
          onRowClick={(u) => router.push(`${base}/users/${u.id}`)}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(p) => setParams({ page: String(p) })} />}
      </Panel>

      <UsersBulkBar
        users={chosen.map((u) => ({ id: u.id, label: u.company_name || u.full_name || u.email || u.id, status: u.status, staffRole: u.staff_role, surveySteps: u.survey_steps }))}
        staff={staff.data?.data ?? []}
        remindable={remindChosen.length}
        onRemind={canRemind ? () => setRemindOpen(true) : undefined}
        onClear={() => setSelected(new Map())}
        onDone={() => { setSelected(new Map()); reload() }}
      />

      <BulkRemindDialog
        open={remindOpen}
        onClose={() => setRemindOpen(false)}
        users={remindChosen.map((u) => ({ id: u.id, label: u.company_name || u.full_name || u.email || u.id, steps: u.survey_steps }))}
        onSent={() => { setSelected(new Map()); reload() }}
      />
    </div>
  )
}

export function UsersPage() {
  return (
    <RequirePermission permission="users.view">
      <Suspense fallback={null}>
        <UsersInner />
      </Suspense>
    </RequirePermission>
  )
}
