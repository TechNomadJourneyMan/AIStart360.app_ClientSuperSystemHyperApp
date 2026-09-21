'use client'

import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import {
  BarList, Badge, DataTable, ErrorState, PageHeader, Pagination, Panel, Select, Skeleton, StatTile, fmtAgo, fmtDateTime, useGigaQuery, type Column,
} from '@/components/giga-panel/kit'
import { GRI_BLOCK_RU } from '@/lib/gri-assessment/labels'
import type { SectionId } from '@/lib/gri-assessment/sections'

interface Row { id: string; user_id: string; gri_index: number; is_current: boolean; created_at: string; user: { email: string | null; full_name: string | null; organization: string | null } | null }
interface Payload {
  data: {
    stats: { users: number; avgIndex: number | null; blocks: Array<{ id: SectionId; avg: number | null }>; buckets: Array<{ label: string; count: number }>; drafts: number }
    list: Row[]; drafts: Array<{ user_id: string; updated_at: string; user: Row['user'] }>; total: number; page: number; pageSize: number
  }
}

export function GriPage() {
  const { base, label } = useWorkspace()
  const router = useRouter()
  const [page, setPage] = useState(1)
  const [scope, setScope] = useState<'1' | '0'>('1')
  const [range, setRange] = useState('')
  const [min, max] = range ? range.split('-') : ['', '']
  const { data, error, loading, reload } = useGigaQuery<Payload>(`/api/giga-admin/gri?page=${page}&current=${scope}${min ? `&min=${min}` : ''}${max ? `&max=${max}` : ''}`)
  const d = data?.data

  const columns: Column<Row>[] = [
    { key: 'user', header: 'Клиент', render: (r) => <div><p className="text-slate-100">{r.user?.organization || r.user?.full_name || r.user?.email || r.user_id}</p><p className="text-[10px] text-slate-500">{r.user?.email}</p></div> },
    { key: 'index', header: 'Индекс', render: (r) => <span className="font-mono text-base font-bold text-slate-100">{r.gri_index.toFixed(1)}</span> },
    { key: 'state', header: '', render: (r) => r.is_current ? <Badge tone="green">текущий</Badge> : <Badge>архивный</Badge> },
    { key: 'at', header: 'Дата', render: (r) => fmtDateTime(r.created_at) },
  ]

  return (
    <RequirePermission permission="gri.view">
      <PageHeader
        crumbs={[{ label, href: base }, { label: 'GRI' }]}
        title="GRI Assessment"
        description="Результаты всех клиентов. Ответы, правка и удаление — в карточке клиента (вкладка GRI)."
      />
      <ErrorState error={error} onRetry={reload} />
      {!d ? <Skeleton className="h-80" /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Клиентов с результатом" value={d.stats.users} href={`${base}/users?segment=gri_completed`} />
            <StatTile label="Средний индекс" value={d.stats.avgIndex ?? '—'} hint="по текущим результатам" tone="violet" />
            <StatTile label="Проходят сейчас" value={d.stats.drafts} tone="amber" href={`${base}/users?segment=gri_in_progress`} />
            <StatTile label="Цель платформы" value="8.5+" hint={`достигли: ${d.stats.buckets.find((b) => b.label === '8–10')?.count ?? 0}`} tone="green" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Средний балл по блокам" description="Самые слабые блоки — ниже">
              <BarList items={[...d.stats.blocks].sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0)).map((b) => ({ key: b.id, label: GRI_BLOCK_RU[b.id], value: b.avg ?? 0 }))} format={(n) => n.toFixed(2)} />
            </Panel>
            <Panel title="Распределение индекса">
              <BarList items={d.stats.buckets.map((b) => ({ key: b.label, label: `Индекс ${b.label}`, value: b.count }))} />
            </Panel>
          </div>
          <Panel
            title="Результаты"
            bodyClassName="p-0"
            actions={
              <>
                <Select label="Какие результаты" value={scope} onChange={(v) => { setScope(v); setPage(1) }} options={[{ value: '1', label: 'Только текущие' }, { value: '0', label: 'Вся история' }] as const} />
                <Select label="Диапазон индекса" value={range} onChange={(v) => { setRange(v); setPage(1) }} options={[{ value: '', label: 'Любой индекс' }, { value: '0-4', label: 'до 4 — риск' }, { value: '4-7', label: '4–7 — рост' }, { value: '7-10', label: '7+ — готовы' }]} />
              </>
            }
          >
            <DataTable columns={columns} rows={d.list} rowKey={(r) => r.id} loading={loading} onRowClick={(r) => router.push(`${base}/users/${r.user_id}?tab=gri`)} />
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onChange={setPage} />
          </Panel>
          {d.drafts.length > 0 && (
            <Panel title="Незавершённые тесты">
              <ul className="divide-y divide-white/[0.05]">
                {d.drafts.map((x) => (
                  <li key={x.user_id} className="flex items-center justify-between py-2 text-xs">
                    <Link href={`${base}/users/${x.user_id}?tab=gri`} className="text-slate-200 hover:text-blue-300">{x.user?.organization || x.user?.full_name || x.user?.email || x.user_id}</Link>
                    <span className="text-slate-500">{fmtAgo(x.updated_at)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </RequirePermission>
  )
}
