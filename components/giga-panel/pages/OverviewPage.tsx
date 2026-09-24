'use client'

import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'

import { useState } from 'react'
import Link from 'next/link'
import { Activity, Eye, Radar, ShieldAlert, UserCheck, UserPlus, Users2 } from 'lucide-react'
import {
  BarList, Badge, ColumnChart, ErrorState, Funnel, PageHeader, Panel, Select, Skeleton, StatTile, fmtAgo, useGigaQuery,
} from '@/components/giga-panel/kit'
import { useStaff } from '@/components/giga-panel/StaffContext'
import { JOURNEY_LABEL } from '@/lib/admin/journey'
import { eventLabel } from '@/lib/events/registry'
import { EVENT_SOURCE, auditLabel } from '@/lib/admin/labels'
import { ConversionTiles } from '@/components/giga-panel/analytics/ConversionTiles'

interface Overview {
  days: number
  generated_at: string
  users: Record<'total' | 'clients' | 'staff' | 'new_7d' | 'new_period' | 'active_1d' | 'active_7d' | 'active_30d' | 'pending_approval' | 'blocked', number>
  funnel: Array<{ key: string; count: number }> | null
  /** 'daily_activity' (migration 090) or the older 'last_seen_at' snapshot. */
  active_source?: 'daily_activity' | 'last_seen_at'
  signups_by_day: Array<{ day: string; count: number }>
  events_by_day: Array<{ day: string; count: number; users: number }>
  top_pages: Array<{ page: string; views: number; users: number }>
  recent_events: Array<{ id: number; user_id: string; event_name: string; source: string; created_at: string; email: string | null; full_name: string | null }>
  recent_admin_actions: Array<{ id: number; actor_id: string; actor_email: string | null; actor_role: string | null; action: string; target_user_id: string | null; target_email: string | null; created_at: string }>
  gri: { assessments: number; avg_index: number | null; drafts: number } | null
  impersonation_active: number
}

const DAYS = [
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
] as const

const dayLabel = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

export function OverviewPage() {
  const { base, label } = useWorkspace()
  const [days, setDays] = useState<'7' | '30' | '90'>('30')
  const { can, me } = useStaff()
  const { data, error, loading, reload } = useGigaQuery<{ data: Overview }>(`/api/giga-admin/overview?days=${days}`)
  const o = data?.data
  const u = o?.users

  return (
    <div>
      <PageHeader
        title="Центр управления"
        description={me ? `${me.roleLabel}${me.email ? ` · ${me.email}` : ''}${o ? ` · обновлено ${fmtAgo(o.generated_at)}` : ''}` : undefined}
        actions={<Select label="Период" value={days} onChange={setDays} options={DAYS} />}
      />
      <ErrorState error={error} onRetry={reload} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading && !o ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px]" />) : u && (
          <>
            <StatTile label="Всего пользователей" value={u.total} hint={`клиентов ${u.clients} · персонал ${u.staff}`} icon={<Users2 size={14} />} href={can('users.view') ? `${base}/users` : undefined} />
            <StatTile label={`Новые за ${o!.days} дн`} value={u.new_period} hint={`за 7 дней: ${u.new_7d}`} icon={<UserPlus size={14} />} tone="green" href={can('users.view') ? `${base}/users?segment=new_7d` : undefined} />
            <div className="h-full" title={o!.active_source === 'daily_activity'
              ? 'Уникальные клиенты с событиями (без персонала и действий «от имени»): по ежедневной свёртке + сегодняшние события.'
              : 'По времени последнего визита (profiles.last_seen_at) — ежедневная свёртка ещё не наполнена.'}>
              <StatTile label="Активные за 7 дней" value={u.active_7d} hint={`сегодня ${u.active_1d} · 30 дн ${u.active_30d}`} icon={<Activity size={14} />} tone="violet" href={can('activity.view') ? `${base}/activity` : undefined} />
            </div>
            <StatTile label="Ожидают одобрения" value={u.pending_approval} hint={u.blocked ? `заблокировано / в архиве: ${u.blocked}` : 'заявки на доступ'} icon={<UserCheck size={14} />} tone="amber" href={can('users.view') ? `${base}/requests` : undefined} />
          </>
        )}
      </div>

      {can('analytics.view') && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ConversionTiles days={days} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {can('cjm.view') && <Panel
          className="lg:col-span-2"
          title="Путь клиентов (CJM)"
          description="Сколько клиентов дошло до этапа · доля от всех · отсев от предыдущего"
          actions={<>
            {can('analytics.view') && <a href={`/api/giga-admin/analytics/export?report=funnel&days=${days}`} download className="text-[11px] text-slate-400 hover:text-slate-200">CSV</a>}
            <Link href={`${base}/cjm`} className="text-[11px] text-blue-300 hover:underline">Подробнее</Link>
          </>}
        >
          {o?.funnel ? (
            <Funnel steps={o.funnel.map((f) => ({ key: f.key, label: JOURNEY_LABEL[f.key] ?? f.key, count: f.count, href: can('cjm.view') ? `${base}/cjm?stage=${f.key}` : undefined }))} />
          ) : <Skeleton className="h-64" />}
        </Panel>}

        <div className="space-y-4">
          {can('gri.view') && <Panel title="GRI">
            {o?.gri ? (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-xl font-bold text-slate-100">{o.gri.assessments}</p><p className="text-[10px] text-slate-500">прохождений</p></div>
                <div><p className="text-xl font-bold text-slate-100">{o.gri.avg_index ?? '—'}</p><p className="text-[10px] text-slate-500">средний индекс</p></div>
                <div><p className="text-xl font-bold text-slate-100">{o.gri.drafts}</p><p className="text-[10px] text-slate-500">в процессе</p></div>
              </div>
            ) : <Skeleton className="h-16" />}
            <Link href={`${base}/gri`} className="mt-3 flex items-center gap-1 text-[11px] text-blue-300 hover:underline"><Radar size={12} /> Все результаты GRI</Link>
          </Panel>}
          <Panel title="Безопасность">
            <ul className="space-y-2 text-xs">
              <li className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-400"><Eye size={13} /> Открытые сессии «от имени»</span>
                <Badge tone={o?.impersonation_active ? 'amber' : 'neutral'}>{o?.impersonation_active ?? '—'}</Badge>
              </li>
              <li className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-400"><ShieldAlert size={13} /> Заблокировано / архив</span>
                <Badge tone={u?.blocked ? 'red' : 'neutral'}>{u?.blocked ?? '—'}</Badge>
              </li>
            </ul>
          </Panel>
        </div>

        <Panel title="Регистрации по дням">
          {o ? <ColumnChart label="Регистрации по дням" points={o.signups_by_day.map((p) => ({ label: dayLabel(p.day), value: p.count }))} /> : <Skeleton className="h-32" />}
        </Panel>

        {can('analytics.view') && (
          <Panel title="Активность по дням" description="события пользователей">
            {o ? <ColumnChart label="События по дням" points={o.events_by_day.map((p) => ({ label: dayLabel(p.day), value: p.count }))} /> : <Skeleton className="h-32" />}
          </Panel>
        )}

        {can('analytics.view') && (
          <Panel title="Популярные разделы">
            {o ? <BarList items={o.top_pages.map((p) => ({ key: p.page, label: <span className="font-mono">{p.page}</span>, value: p.views, hint: `· ${p.users} чел` }))} emptyText="Просмотров ещё нет — трекинг начал собирать данные" /> : <Skeleton className="h-32" />}
          </Panel>
        )}

        {can('users.view') && (
          <Panel className="lg:col-span-2" title="Последние события" actions={can('activity.view') ? <Link href={`${base}/activity`} className="text-[11px] text-blue-300 hover:underline">Все</Link> : undefined}>
            {o ? (
              o.recent_events.length ? (
                <ul className="divide-y divide-white/[0.05]">
                  {o.recent_events.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 py-2 text-xs">
                      <span className="w-24 shrink-0 text-[10px] text-slate-600">{fmtAgo(e.created_at)}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-200">{eventLabel(e.event_name)}</span>
                      <Link href={`${base}/users/${e.user_id}`} className="max-w-[40%] truncate text-slate-400 hover:text-blue-300">{e.full_name || e.email}</Link>
                      <Badge tone={EVENT_SOURCE[e.source]?.tone}>{EVENT_SOURCE[e.source]?.label ?? e.source}</Badge>
                    </li>
                  ))}
                </ul>
              ) : <p className="py-6 text-center text-xs text-slate-600">Событий пока нет</p>
            ) : <Skeleton className="h-40" />}
          </Panel>
        )}

        {can('audit.view') && (
          <Panel title="Действия персонала" actions={<Link href={`${base}/audit`} className="text-[11px] text-blue-300 hover:underline">Журнал</Link>}>
            {o ? (
              o.recent_admin_actions.length ? (
                <ul className="space-y-2">
                  {o.recent_admin_actions.map((a) => (
                    <li key={a.id} className="text-xs">
                      <p className="text-slate-200">{auditLabel(a.action)}</p>
                      <p className="truncate text-[10px] text-slate-500">
                        {a.actor_email || a.actor_id}{a.target_email ? ` → ${a.target_email}` : ''} · {fmtAgo(a.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : <p className="py-6 text-center text-xs text-slate-600">Действий пока нет</p>
            ) : <Skeleton className="h-40" />}
          </Panel>
        )}
      </div>
    </div>
  )
}
