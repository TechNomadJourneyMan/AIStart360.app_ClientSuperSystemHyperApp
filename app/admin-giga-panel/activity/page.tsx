'use client'

import { useState } from 'react'
import Link from 'next/link'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import {
  BarList, Badge, ColumnChart, DataTable, ErrorState, PageHeader, Pagination, Panel, Select, Skeleton, StatTile, fmtDateTime, useGigaQuery, type Column,
} from '@/components/giga-panel/kit'
import { EVENTS, eventLabel, type EventName } from '@/lib/events/registry'
import { EVENT_SOURCE } from '@/lib/admin/labels'

interface Stats {
  days: number; total: number; users: number; sessions: number; returning_users: number
  by_name: Array<{ event_name: string; event_type: string; count: number; users: number }>
  exit_pages: Array<{ page: string; exits: number }>
  by_hour: Array<{ hour: number; count: number }>
}
interface EventRow { id: number; user_id: string | null; event_name: string; page: string | null; source: string; metadata: Record<string, unknown>; created_at: string; user: { email: string | null; full_name: string | null } | null }

const DAYS = [{ value: '1', label: 'Сутки' }, { value: '7', label: '7 дней' }, { value: '14', label: '14 дней' }, { value: '30', label: '30 дней' }, { value: '90', label: '90 дней' }] as const

export default function ActivityPage() {
  const [days, setDays] = useState<(typeof DAYS)[number]['value']>('14')
  const [event, setEvent] = useState('')
  const [source, setSource] = useState('')
  const [views, setViews] = useState<'1' | '0'>('0')
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useGigaQuery<{ stats: Stats; data: EventRow[]; total: number; page: number; pageSize: number }>(
    `/api/giga-admin/activity?days=${days}&page=${page}&event=${event}&source=${source}&pageviews=${views}`,
  )
  const s = data?.stats
  const reset = () => setPage(1)

  const columns: Column<EventRow>[] = [
    { key: 'at', header: 'Время', render: (e) => <span className="whitespace-nowrap text-slate-400">{fmtDateTime(e.created_at)}</span> },
    { key: 'user', header: 'Пользователь', render: (e) => e.user_id ? <Link href={`/admin-giga-panel/users/${e.user_id}?tab=activity`} className="text-slate-200 hover:text-blue-300" onClick={(ev) => ev.stopPropagation()}>{e.user?.full_name || e.user?.email || e.user_id.slice(0, 8)}</Link> : '—' },
    { key: 'event', header: 'Событие', render: (e) => eventLabel(e.event_name) },
    { key: 'page', header: 'Страница', render: (e) => <span className="font-mono text-[11px] text-slate-500">{e.page ?? '—'}</span> },
    { key: 'src', header: 'Источник', render: (e) => <Badge tone={EVENT_SOURCE[e.source]?.tone}>{EVENT_SOURCE[e.source]?.label ?? e.source}</Badge> },
  ]

  return (
    <RequirePermission permission="activity.view">
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Активность' }]}
        title="Аналитика активности"
        description="События пользователей: входы, разделы, анкета, GRI, материалы. Действия администраторов в кабинетах помечены отдельно."
        actions={<Select label="Период" value={days} onChange={(v) => { setDays(v); reset() }} options={DAYS} />}
      />
      <ErrorState error={error} onRetry={reload} />
      {!s ? <Skeleton className="h-80" /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Событий" value={s.total.toLocaleString('ru-RU')} />
            <StatTile label="Активных пользователей" value={s.users} tone="green" />
            <StatTile label="Сессий" value={s.sessions} tone="violet" />
            <StatTile label="Вернулись повторно" value={s.returning_users} hint="активны больше одного дня" tone="amber" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="События по типу">
              <BarList items={s.by_name.map((b) => ({ key: b.event_name, label: eventLabel(b.event_name), value: b.count, hint: `· ${b.users} чел` }))} emptyText="Событий за период нет" />
            </Panel>
            <Panel title="Точки выхода" description="Последняя страница сессии">
              <BarList items={s.exit_pages.map((p) => ({ key: p.page, label: <span className="font-mono">{p.page}</span>, value: p.exits }))} emptyText="Данных о сессиях ещё нет" />
            </Panel>
            <Panel title="Активность по часам" description="Время Алматы">
              <ColumnChart label="События по часам" points={s.by_hour.map((h) => ({ label: `${h.hour}:00`, value: h.count }))} />
            </Panel>
          </div>
          <Panel
            title="Поток событий"
            description={`Найдено: ${data?.total ?? 0}`}
            bodyClassName="p-0"
            actions={
              <>
                <Select label="Событие" value={event} onChange={(v) => { setEvent(v); reset() }} options={[{ value: '', label: 'Все события' }, ...(Object.keys(EVENTS) as EventName[]).map((n) => ({ value: n, label: eventLabel(n) }))]} />
                <Select label="Источник" value={source} onChange={(v) => { setSource(v); reset() }} options={[{ value: '', label: 'Все источники' }, ...Object.entries(EVENT_SOURCE).map(([value, x]) => ({ value, label: x.label }))]} />
                <Select label="Просмотры страниц" value={views} onChange={(v) => { setViews(v); reset() }} options={[{ value: '0', label: 'Без просмотров' }, { value: '1', label: 'С просмотрами' }] as const} />
              </>
            }
          >
            <DataTable columns={columns} rows={data?.data} rowKey={(e) => String(e.id)} loading={loading} />
            {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
          </Panel>
        </div>
      )}
    </RequirePermission>
  )
}
