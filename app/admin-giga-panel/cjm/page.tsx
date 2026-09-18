'use client'

import { Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import {
  BarList, Badge, Button, DataTable, ErrorState, Funnel, PageHeader, Pagination, Panel, Select, Skeleton, StatTile, fmtAgo, useGigaQuery, type Column,
} from '@/components/giga-panel/kit'
import { JOURNEY_LABEL, JOURNEY_STAGES } from '@/lib/admin/journey'

interface ListRow {
  user: { id: string; email?: string | null; full_name?: string | null; organization?: string | null }
  current: { key: string; label: string } | null; next: { key: string; label: string } | null
  completed: number; daysInStage: number | null; lastSeenAt: string | null
}
interface Payload {
  data: {
    total: number; stalledDays: number; stalledTotal: number
    funnel: Array<{ key: string; label: string; count: number; current: number }>
    dropOff: Array<{ key: string; label: string; stalled: number }>
    list: ListRow[]; listTotal: number; page: number; pageSize: number
  }
}

function CjmInner() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const stage = sp.get('stage') ?? ''
  const page = Number(sp.get('page')) || 1
  const stalledDays = sp.get('stalledDays') ?? '14'
  const set = (patch: Record<string, string>) => {
    const n = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k) }
    if (!('page' in patch)) n.delete('page')
    router.replace(`${pathname}?${n}`, { scroll: false })
  }
  const { data, error, loading, reload } = useGigaQuery<Payload>(`/api/giga-admin/cjm?stage=${stage}&page=${page}&stalledDays=${stalledDays}`)
  const d = data?.data

  const columns: Column<ListRow>[] = [
    { key: 'user', header: 'Клиент', render: (r) => <div><p className="text-slate-100">{r.user.organization || r.user.full_name || r.user.email || r.user.id}</p><p className="text-[10px] text-slate-500">{r.user.email}</p></div> },
    { key: 'stage', header: 'Этап', render: (r) => r.current ? <Badge tone="green">{r.current.label}</Badge> : '—' },
    { key: 'next', header: 'Следующий шаг', render: (r) => r.next ? <Badge tone="blue">{r.next.label}</Badge> : <Badge tone="green">путь пройден</Badge> },
    { key: 'days', header: 'На этапе', render: (r) => r.daysInStage != null ? <span className={r.daysInStage >= 14 ? 'text-amber-300' : ''}>{r.daysInStage} дн</span> : '—' },
    { key: 'progress', header: 'Прогресс', render: (r) => `${r.completed}/${JOURNEY_STAGES.length}` },
    { key: 'seen', header: 'Активность', render: (r) => fmtAgo(r.lastSeenAt) },
  ]

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Путь клиента (CJM)' }]}
        title="Путь клиента (CJM)"
        description="Этапы считаются по фактическим данным: регистрация → доступ → анкета → Точка А → GRI → Точка Б → обучение."
        actions={<Select label="Застряли дольше" value={stalledDays} onChange={(v) => set({ stalledDays: v })} options={[{ value: '7', label: 'Застряли 7+ дней' }, { value: '14', label: 'Застряли 14+ дней' }, { value: '30', label: 'Застряли 30+ дней' }]} />}
      />
      <ErrorState error={error} onRetry={reload} />
      {!d ? <Skeleton className="h-80" /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatTile label="Клиентов в пути" value={d.total} />
            <StatTile label={`Застряли ${d.stalledDays}+ дней`} value={d.stalledTotal} tone="amber" hint="нет перехода к следующему этапу" />
            <StatTile label="Дошли до обучения" value={d.funnel[d.funnel.length - 1]?.count ?? 0} hint="последний этап пути" tone="green" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel className="lg:col-span-2" title="Воронка этапов" description="Дошли до этапа · доля от всех · отсев от предыдущего. Нажмите этап — список клиентов на нём.">
              <Funnel steps={d.funnel.map((f) => ({ key: f.key, label: `${f.label} (сейчас ${f.current})`, count: f.count, href: `${pathname}?stage=${f.key}` }))} />
            </Panel>
            <Panel title="Где останавливаются" description={`Текущий этап у застрявших ${d.stalledDays}+ дней`}>
              <BarList items={d.dropOff.filter((x) => x.stalled > 0).map((x) => ({ key: x.key, label: x.label, value: x.stalled }))} emptyText="Застрявших нет" />
            </Panel>
          </div>
          <Panel
            title={stage ? `Сейчас на этапе «${JOURNEY_LABEL[stage] ?? stage}»` : `Застряли ${d.stalledDays}+ дней`}
            description={`Клиентов: ${d.listTotal}`}
            bodyClassName="p-0"
            actions={stage ? <Button size="sm" variant="ghost" onClick={() => set({ stage: '' })}>Показать застрявших</Button> : undefined}
          >
            <DataTable columns={columns} rows={d.list} rowKey={(r) => r.user.id} loading={loading} onRowClick={(r) => router.push(`/admin-giga-panel/users/${r.user.id}?tab=cjm`)} />
            <Pagination page={d.page} pageSize={d.pageSize} total={d.listTotal} onChange={(p) => set({ page: String(p) })} />
          </Panel>
        </div>
      )}
    </>
  )
}

export default function CjmPage() {
  return (
    <RequirePermission permission="cjm.view">
      <Suspense fallback={null}><CjmInner /></Suspense>
    </RequirePermission>
  )
}
