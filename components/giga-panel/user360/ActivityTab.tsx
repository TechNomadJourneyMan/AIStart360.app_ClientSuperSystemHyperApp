'use client'

import { useState } from 'react'
import { Badge, DataTable, ErrorState, Pagination, Panel, Select, fmtDateTime, useGigaQuery, type Column } from '../kit'
import { EVENT_TYPES, eventLabel } from '@/lib/events/registry'
import { EVENT_SOURCE } from '@/lib/admin/labels'

interface EventRow {
  id: number; event_name: string; event_type: string; page: string | null; entity_type: string | null; entity_id: string | null
  metadata: Record<string, unknown>; source: string; session_id: string | null; created_at: string
}

const TYPE_LABEL: Record<string, string> = {
  auth: 'Вход/регистрация', navigation: 'Навигация', interaction: 'Клики', questionnaire: 'Анкета', gri: 'GRI',
  content: 'Контент', document: 'Документы', diagnostics: 'Диагностика', system: 'Система', admin: 'Администратор',
}

export function ActivityTab({ userId }: { userId: string }) {
  const [page, setPage] = useState(1)
  const [type, setType] = useState('')
  const [source, setSource] = useState('')
  const [views, setViews] = useState<'1' | '0'>('1')
  const url = `/api/giga-admin/users/${userId}/events?page=${page}&type=${type}&source=${source}&pageviews=${views}`
  const { data, error, loading, reload } = useGigaQuery<{ data: EventRow[]; total: number; page: number; pageSize: number }>(url)

  const columns: Column<EventRow>[] = [
    { key: 'at', header: 'Время', render: (e) => <span className="whitespace-nowrap text-slate-400">{fmtDateTime(e.created_at)}</span> },
    { key: 'event', header: 'Событие', render: (e) => <span className="font-medium text-slate-100">{eventLabel(e.event_name)}</span> },
    { key: 'page', header: 'Страница', render: (e) => e.page ? <span className="font-mono text-[11px] text-slate-400">{e.page}</span> : <span className="text-slate-700">—</span> },
    {
      key: 'details', header: 'Детали',
      render: (e) => {
        const parts = Object.entries(e.metadata ?? {}).filter(([k]) => k !== 'backfilled').slice(0, 4).map(([k, v]) => `${k}: ${String(v)}`)
        return <span className="line-clamp-2 text-[11px] text-slate-500">{parts.join(' · ') || (e.entity_type ? `${e.entity_type}` : '—')}</span>
      },
    },
    { key: 'source', header: 'Источник', render: (e) => <Badge tone={EVENT_SOURCE[e.source]?.tone}>{EVENT_SOURCE[e.source]?.label ?? e.source}</Badge> },
    { key: 'session', header: 'Сессия', render: (e) => <span className="font-mono text-[10px] text-slate-600">{e.session_id?.slice(0, 8) ?? '—'}</span> },
  ]

  return (
    <Panel
      title="Активность"
      description={data ? `Событий: ${data.total}` : undefined}
      bodyClassName="p-0"
      actions={
        <>
          <Select label="Тип" value={type} onChange={(v) => { setType(v); setPage(1) }} options={[{ value: '', label: 'Все типы' }, ...EVENT_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] ?? t }))]} />
          <Select label="Источник" value={source} onChange={(v) => { setSource(v); setPage(1) }} options={[{ value: '', label: 'Все источники' }, ...Object.entries(EVENT_SOURCE).map(([value, s]) => ({ value, label: s.label }))]} />
          <Select label="Просмотры страниц" value={views} onChange={(v) => { setViews(v); setPage(1) }} options={[{ value: '1', label: 'С просмотрами' }, { value: '0', label: 'Без просмотров' }] as const} />
        </>
      }
    >
      {error && <div className="p-3"><ErrorState error={error} onRetry={reload} /></div>}
      <DataTable columns={columns} rows={data?.data} rowKey={(e) => String(e.id)} loading={loading} />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </Panel>
  )
}
