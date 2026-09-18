'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import {
  Badge, DiffView, Drawer, ErrorState, Field, JsonValue, PageHeader, Pagination, Panel, Select, Skeleton, SearchInput, fmtDateTime, useDebounced, useGigaQuery,
} from '@/components/giga-panel/kit'
import { auditLabel } from '@/lib/admin/labels'
import { STAFF_ROLE_LABELS, isStaffRole } from '@/lib/admin/rbac'

interface Row {
  id: number; actor_id: string; actor_kind: string; actor_role: string | null; actor_email: string | null; target_user_id: string | null
  impersonation_session_id: string | null; action: string; entity_type: string; entity_id: string | null
  old_value: unknown; new_value: unknown; metadata: Record<string, unknown>; ip_address: string | null; created_at: string
  target: { email: string; full_name: string | null } | null
}

const GROUPS = [
  { value: '', label: 'Все действия' },
  { value: 'user.', label: 'Пользователи' },
  { value: 'request.', label: 'Заявки' },
  { value: 'impersonation.', label: 'Вход от имени' },
  { value: 'gri.', label: 'GRI' },
  { value: 'staff.', label: 'Роли' },
  { value: 'content.', label: 'Контент' },
  { value: 'platform.', label: 'Разделы платформы' },
  { value: 'settings.', label: 'Настройки' },
  { value: 'admin.', label: 'Входы в панель' },
  { value: 'insight.', label: 'Модерация' },
] as const

function Inner() {
  const sp = useSearchParams()
  const [page, setPage] = useState(1)
  const [group, setGroup] = useState<string>('')
  const [actor, setActor] = useState('')
  const [from, setFrom] = useState('')
  const [onlyImp, setOnlyImp] = useState(sp.get('imp') === '1')
  const target = sp.get('target') ?? ''
  const debActor = useDebounced(actor, 400)
  const [open, setOpen] = useState<Row | null>(null)
  const qs = new URLSearchParams({ page: String(page) })
  if (group) qs.set('action', group)
  if (debActor) qs.set('actor', debActor)
  if (from) qs.set('from', from)
  if (onlyImp) qs.set('imp', '1')
  if (target) qs.set('target', target)
  const { data, error, loading, reload } = useGigaQuery<{ data: Row[]; total: number; page: number; pageSize: number }>(`/api/giga-admin/audit?${qs}`)

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Журнал аудита' }]}
        title="Журнал аудита"
        description="Неизменяемый журнал действий персонала: кто, над кем, что изменил (было → стало). Записи нельзя изменить или удалить."
      />
      <Panel bodyClassName="p-0">
        <div className="flex flex-wrap items-end gap-2 border-b border-white/[0.06] p-3">
          <Select label="Группа" value={group} onChange={(v) => { setGroup(v); setPage(1) }} options={GROUPS as unknown as Array<{ value: string; label: string }>} />
          <SearchInput value={actor} onChange={(v) => { setActor(v); setPage(1) }} placeholder="Кто: email или id" className="min-w-[200px] flex-1" />
          <input type="date" aria-label="С даты" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs text-slate-200 [color-scheme:dark] focus:border-blue-500/40 focus:outline-none" />
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={onlyImp} onChange={(e) => { setOnlyImp(e.target.checked); setPage(1) }} />
            Только в кабинетах пользователей
          </label>
          {target && <Badge tone="blue">по пользователю</Badge>}
        </div>
        {error && <div className="p-3"><ErrorState error={error} onRetry={reload} /></div>}
        {!data && loading ? <div className="p-4"><Skeleton className="h-64" /></div> : (
          <ul className="divide-y divide-white/[0.05]">
            {data?.data.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setOpen(r)} className="grid w-full gap-1 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03] md:grid-cols-[9rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-3">
                  <span className="text-[11px] text-slate-500">{fmtDateTime(r.created_at)}</span>
                  <span className="text-xs text-slate-100">
                    {auditLabel(r.action)}
                    {r.impersonation_session_id && <Badge tone="amber" className="ml-2">в кабинете</Badge>}
                    {r.actor_kind === 'break_glass' && <Badge tone="red" className="ml-2">аварийный вход</Badge>}
                  </span>
                  <span className="truncate text-[11px] text-slate-400">{r.actor_email || r.actor_id}{r.actor_role && isStaffRole(r.actor_role) ? ` · ${STAFF_ROLE_LABELS[r.actor_role]}` : ''}</span>
                  <span className="truncate text-[11px] text-slate-400">{r.target ? (r.target.full_name || r.target.email) : r.entity_id ?? ''}</span>
                </button>
              </li>
            ))}
            {data && data.data.length === 0 && <li className="px-4 py-8 text-center text-xs text-slate-600">Записей нет</li>}
          </ul>
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      </Panel>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? auditLabel(open.action) : ''}>
        {open && (
          <div className="space-y-4 text-xs">
            <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-y-1.5">
              <dt className="text-slate-500">Когда</dt><dd className="text-slate-200">{fmtDateTime(open.created_at)}</dd>
              <dt className="text-slate-500">Кто</dt><dd className="break-all text-slate-200">{open.actor_email || open.actor_id} <span className="text-slate-500">({open.actor_kind}{open.actor_role ? `, ${open.actor_role}` : ''})</span></dd>
              <dt className="text-slate-500">Над кем</dt><dd className="text-slate-200">{open.target_user_id ? <Link className="text-blue-300 hover:underline" href={`/admin-giga-panel/users/${open.target_user_id}`}>{open.target?.full_name || open.target?.email || open.target_user_id}</Link> : '—'}</dd>
              <dt className="text-slate-500">Объект</dt><dd className="break-all text-slate-200">{open.entity_type}{open.entity_id ? ` · ${open.entity_id}` : ''}</dd>
              <dt className="text-slate-500">Код действия</dt><dd className="font-mono text-slate-400">{open.action}</dd>
              <dt className="text-slate-500">IP</dt><dd className="text-slate-400">{open.ip_address ?? '—'}</dd>
              {open.impersonation_session_id && (<><dt className="text-slate-500">Сессия</dt><dd className="font-mono text-slate-400">{open.impersonation_session_id}</dd></>)}
            </dl>
            {(open.old_value != null || open.new_value != null) && (
              <Field label="Изменения"><DiffView oldValue={open.old_value} newValue={open.new_value} /></Field>
            )}
            <Field label="Метаданные"><JsonValue value={open.metadata} /></Field>
          </div>
        )}
      </Drawer>
    </>
  )
}

export default function AuditPage() {
  return (
    <RequirePermission permission="audit.view">
      <Suspense fallback={null}><Inner /></Suspense>
    </RequirePermission>
  )
}
