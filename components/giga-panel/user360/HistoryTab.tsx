'use client'

import { useState } from 'react'
import { Badge, DiffView, ErrorState, Pagination, Panel, Skeleton, fmtDateTime, useGigaQuery } from '../kit'
import { auditLabel } from '@/lib/admin/labels'
import { STAFF_ROLE_LABELS, isStaffRole } from '@/lib/admin/rbac'

interface AuditRow {
  id: number; actor_id: string; actor_kind: string; actor_role: string | null; actor_email: string | null; action: string
  entity_type: string; entity_id: string | null; old_value: unknown; new_value: unknown; metadata: Record<string, unknown>
  impersonation_session_id: string | null; ip_address: string | null; created_at: string
}
interface Session { id: string; admin_id: string; admin_email: string | null; admin_role: string; mode: string; reason: string; started_at: string; expires_at: string; ended_at: string | null; end_reason: string | null }

export function HistoryTab({ userId }: { userId: string }) {
  const [page, setPage] = useState(1)
  const { data, error, reload } = useGigaQuery<{ data: AuditRow[]; sessions: Session[]; total: number; page: number; pageSize: number }>(`/api/giga-admin/users/${userId}/audit?page=${page}`)
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <Skeleton className="h-80" />
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Panel title="Действия персонала" description={`Записей: ${data.total}`}>
        {data.data.length === 0 ? <p className="py-6 text-center text-xs text-slate-600">С этим пользователем ещё ничего не делали</p> : (
          <ul className="space-y-3">
            {data.data.map((a) => (
              <li key={a.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-100">{auditLabel(a.action)}</p>
                  <time className="text-[10px] text-slate-500">{fmtDateTime(a.created_at)}</time>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {a.actor_email || a.actor_id}
                  {a.actor_role && isStaffRole(a.actor_role) ? ` · ${STAFF_ROLE_LABELS[a.actor_role]}` : ''}
                  {a.actor_kind === 'break_glass' && <Badge tone="red" className="ml-2">аварийный вход</Badge>}
                  {a.impersonation_session_id && <Badge tone="amber" className="ml-2">в кабинете пользователя</Badge>}
                </p>
                {typeof a.metadata?.reason === 'string' && a.metadata.reason && <p className="mt-1 text-[11px] text-slate-400">Причина: {a.metadata.reason}</p>}
                {(a.old_value != null || a.new_value != null) && <div className="mt-2"><DiffView oldValue={a.old_value} newValue={a.new_value} /></div>}
                {a.action === 'impersonation.request' && <p className="mt-1 font-mono text-[10px] text-slate-500">{a.entity_id}</p>}
              </li>
            ))}
          </ul>
        )}
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
      </Panel>
      <Panel title="Входы в кабинет от имени">
        {data.sessions.length === 0 ? <p className="text-xs text-slate-600">Не было</p> : (
          <ul className="space-y-3">
            {data.sessions.map((s) => (
              <li key={s.id} className="text-xs">
                <p className="text-slate-200">{s.admin_email || s.admin_id}</p>
                <p className="text-[10px] text-slate-500">{fmtDateTime(s.started_at)} → {s.ended_at ? fmtDateTime(s.ended_at) : 'открыта'} · {s.mode === 'edit' ? 'правка' : 'просмотр'}</p>
                <p className="text-[11px] text-slate-400">{s.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
