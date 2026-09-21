'use client'

import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'

import Link from 'next/link'
import { CopyCheck } from 'lucide-react'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import { Badge, EmptyState, ErrorState, PageHeader, Panel, Skeleton, StatTile, fmtDate, useGigaQuery } from '@/components/giga-panel/kit'
import { PROFILE_STATUS } from '@/lib/admin/labels'

/** Возможные дубли: один клиент завёл несколько аккаунтов. */

interface Member { id: string; email: string | null; full_name: string | null; company: string | null; status: string; created_at: string }
interface Group { id: string; reason: string; reasonLabel: string; value: string; count: number; members: Member[] }

export function DuplicatesPage() {
  const { base, label } = useWorkspace()
  const { data, error, loading, reload } = useGigaQuery<{ data: Group[]; scanned: number; affected: number }>('/api/giga-admin/duplicates')
  const groups = data?.data ?? []

  return (
    <RequirePermission permission="users.sensitive">
      <PageHeader
        crumbs={[{ label, href: base }, { label: 'Дубликаты' }]}
        title="Возможные дубликаты"
        description="Один и тот же клиент на нескольких аккаунтах: совпали компания, телефон или адрес. Это подсказка, а не приговор — решает человек."
      />
      <ErrorState error={error} onRetry={reload} />
      {loading && !data && <Skeleton className="h-64" />}

      {data && (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <StatTile label="Групп совпадений" value={groups.length} tone={groups.length ? 'amber' : 'green'} />
            <StatTile label="Затронуто аккаунтов" value={data.affected} />
            <StatTile label="Проверено" value={data.scanned} hint="без архивных" />
          </div>

          {!groups.length ? (
            <Panel>
              <EmptyState icon={<CopyCheck size={22} className="text-emerald-400" />} title="Дубликатов не найдено" text="Совпадений по компании, телефону и адресу нет." />
            </Panel>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <Panel
                  key={g.id}
                  title={<span className="flex flex-wrap items-center gap-2">{g.value || '— пусто —'} <Badge tone="amber">{g.reasonLabel}</Badge></span>}
                  description={`Аккаунтов: ${g.count}`}
                  bodyClassName="p-0"
                >
                  <ul className="divide-y divide-white/[0.05]">
                    {g.members.map((m, i) => (
                      <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs">
                        <Link href={`${base}/users/${m.id}`} className="min-w-0 flex-1 truncate text-slate-200 hover:text-blue-300">
                          {m.company || m.full_name || m.email || m.id}
                        </Link>
                        <span className="truncate text-[11px] text-slate-500">{m.email}</span>
                        <Badge tone={PROFILE_STATUS[m.status]?.tone}>{PROFILE_STATUS[m.status]?.label ?? m.status}</Badge>
                        <span className="text-[11px] text-slate-600">{fmtDate(m.created_at)}</span>
                        {i === 0 && <Badge tone="blue">самый старый</Badge>}
                      </li>
                    ))}
                  </ul>
                </Panel>
              ))}
            </div>
          )}
        </>
      )}
    </RequirePermission>
  )
}
