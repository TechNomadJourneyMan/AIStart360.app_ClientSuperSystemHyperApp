'use client'

import { useMemo, useState } from 'react'
import { Check, Minus } from 'lucide-react'
import { STAFF_ROLES, STAFF_ROLE_LABELS, type StaffRole } from '@/lib/admin/rbac'
import { navForRole, permissionCount, permissionMatrix } from '@/lib/devtools/matrix'
import { Badge, Panel, SearchInput, Select } from '../kit'

/**
 * Матрица «роль × право» и меню каждой роли — прямо из кода (lib/admin/rbac.ts,
 * lib/admin/nav.ts): ровно то, что проверяет сервер. Только чтение.
 */
export function PermissionsTab() {
  const [q, setQ] = useState('')
  const [role, setRole] = useState<StaffRole>('support')
  const rows = useMemo(() => permissionMatrix(), [])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? rows.filter((r) => r.permission.toLowerCase().includes(s) || r.description.toLowerCase().includes(s)) : rows
  }, [rows, q])
  const nav = useMemo(() => navForRole(role), [role])

  return (
    <div className="space-y-4">
      <Panel
        title="Матрица прав"
        description="Право проверяется сервером на каждом запросе; интерфейс лишь прячет недоступное. Изменить матрицу можно только в коде (lib/admin/rbac.ts)."
        actions={<SearchInput value={q} onChange={setQ} placeholder="Право или описание…" className="w-56" />}
        bodyClassName="p-0"
      >
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#0a1024]">
              <tr className="border-b border-white/[0.07]">
                <th className="px-4 py-2.5 font-medium text-slate-400">Право</th>
                {STAFF_ROLES.map((r) => (
                  <th key={r} className="px-2 py-2.5 text-center font-medium text-slate-400">
                    <span className="block whitespace-nowrap">{STAFF_ROLE_LABELS[r]}</span>
                    <span className="text-[10px] font-normal text-slate-600">{permissionCount(r)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.permission} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-4 py-2">
                    <p className="font-mono text-[11px] text-slate-200">{row.permission}</p>
                    <p className="text-[11px] text-slate-500">{row.description}</p>
                  </td>
                  {STAFF_ROLES.map((r) => (
                    <td key={r} className="px-2 py-2 text-center">
                      {row.roles[r]
                        ? <Check size={14} className="inline text-emerald-400" aria-label="есть" />
                        : <Minus size={14} className="inline text-slate-700" aria-label="нет" />}
                    </td>
                  ))}
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={STAFF_ROLES.length + 1} className="px-4 py-8 text-center text-slate-500">Ничего не найдено</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Меню роли"
        description="Какие разделы видит сотрудник этой роли (то же правило, что у боковой панели)."
        actions={<Select label="Роль" value={role} onChange={setRole} options={STAFF_ROLES.map((r) => ({ value: r, label: STAFF_ROLE_LABELS[r] }))} />}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Панель GIGA-CRM</p>
            <NavList groups={nav.giga} />
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Кабинет SuperExpert</p>
            {nav.superExpert ? <NavList groups={nav.superExpert} /> : <p className="text-xs text-slate-600">Роль не допускается в /super-expert.</p>}
          </div>
        </div>
      </Panel>
    </div>
  )
}

function NavList({ groups }: { groups: ReturnType<typeof navForRole>['giga'] }) {
  if (!groups.length) return <p className="text-xs text-slate-600">Нет доступных разделов.</p>
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-1 text-[11px] text-slate-400">{g.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {g.items.map((i) => <Badge key={i.href} title={`${i.href} · ${i.permission}`}>{i.label}</Badge>)}
          </div>
        </div>
      ))}
    </div>
  )
}
