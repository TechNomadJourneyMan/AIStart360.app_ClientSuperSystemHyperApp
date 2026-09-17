'use client'

import Link from 'next/link'
import { Check, Minus } from 'lucide-react'
import { useStaff } from '@/components/giga-panel/StaffContext'
import { Badge, ErrorState, PageHeader, Panel, Skeleton, fmtAgo, fmtDate, useGigaQuery } from '@/components/giga-panel/kit'
import type { Permission, StaffRole } from '@/lib/admin/rbac'
import { STAFF_ROLE_LABELS } from '@/lib/admin/rbac'

interface Payload {
  data: {
    matrix: Array<{ role: StaffRole; label: string; permissions: Permission[] }>
    permissions: Record<Permission, string>
    grantable: StaffRole[]
    me: { role: StaffRole }
    staff: Array<{ user_id: string; role: StaffRole; granted_by: string | null; granted_at: string; person: { email: string; full_name: string | null; status: string; last_seen_at: string | null } | null }> | null
  }
}

export default function StaffPage() {
  const { can } = useStaff()
  const { data, error, reload } = useGigaQuery<Payload>('/api/giga-admin/staff')
  const d = data?.data
  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Роли и права' }]}
        title="Роли и права"
        description="Права проверяются на сервере при каждом запросе. Роль выдаёт Super Admin в карточке пользователя (вкладка «Профиль» → «Роль персонала»)."
      />
      <ErrorState error={error} onRetry={reload} />
      {!d ? <Skeleton className="h-96" /> : (
        <div className="space-y-4">
          {d.staff && (
            <Panel title="Сотрудники" description={`Всего: ${d.staff.length}`}>
              <ul className="divide-y divide-white/[0.05]">
                {d.staff.map((s) => (
                  <li key={s.user_id} className="flex flex-wrap items-center gap-3 py-2 text-xs">
                    <Link href={`/admin-giga-panel/users/${s.user_id}`} className="min-w-0 flex-1 truncate text-slate-100 hover:text-blue-300">{s.person?.full_name || s.person?.email || s.user_id}</Link>
                    <span className="text-slate-500">{s.person?.email}</span>
                    <Badge tone="violet">{STAFF_ROLE_LABELS[s.role]}</Badge>
                    <span className="text-[10px] text-slate-600">с {fmtDate(s.granted_at)} · активность {fmtAgo(s.person?.last_seen_at)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {!can('roles.manage') && <p className="text-xs text-slate-500">Список сотрудников видит только Super Admin. Ваша роль: {STAFF_ROLE_LABELS[d.me.role]}.</p>}
          <Panel title="Матрица прав" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[11px]">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2.5">Право</th>
                    {d.matrix.map((m) => <th key={m.role} className={`px-2 py-2.5 text-center ${m.role === d.me.role ? 'text-blue-300' : ''}`}>{m.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(d.permissions) as Permission[]).map((p) => (
                    <tr key={p} className="border-b border-white/[0.04]">
                      <td className="px-3 py-2"><span className="text-slate-200">{d.permissions[p]}</span><span className="ml-2 font-mono text-[10px] text-slate-600">{p}</span></td>
                      {d.matrix.map((m) => (
                        <td key={m.role} className="px-2 py-2 text-center">
                          {m.permissions.includes(p) ? <Check size={13} className="mx-auto text-emerald-400" /> : <Minus size={13} className="mx-auto text-slate-700" />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}
