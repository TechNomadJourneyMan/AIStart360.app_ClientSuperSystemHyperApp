'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import {
  BarList, Badge, DataTable, ErrorState, HoverCard, PageHeader, Pagination, Panel, SearchInput, Select, Skeleton, StatTile,
  fmtAgo, fmtDate, useDebounced, useGigaQuery, type Column,
} from '@/components/giga-panel/kit'
import { SurveyPreviewCard } from '@/components/giga-panel/surveys/SurveyPreviewCard'
import { SurveyDrawer } from '@/components/giga-panel/surveys/SurveyDrawer'
import { STEPS } from '@/components/onboarding/constants/step-config'
import { SURVEY_LABELS } from '@/lib/survey-labels'
import { PROFILE_ROLE, PROFILE_STATUS } from '@/lib/admin/labels'

interface Stats {
  data: {
    clients: number; started: number; completed: number; avgSteps: number
    distribution: Array<{ steps: number; users: number }>
    perStep: Array<{ step: number; users: number }>
    recentEdits: Array<{ id: number; user_id: string; question_key: string; source: string; updated_at: string; user_label: string; actor_label: string | null }>
  }
}
interface UserRow {
  id: string; email: string | null; full_name: string | null; role: string; status: string; organization: string | null
  company_name: string | null; created_at: string; last_seen_at: string | null; survey_steps: number; survey_updated_at: string | null
  staff_role: string | null
}

const SOURCE: Record<string, string> = { user: 'пользователь', admin: 'админ', impersonation: 'админ в кабинете', service: 'система' }
const FILTERS = [
  { value: '', label: 'Все пользователи' },
  { value: 'survey_in_progress', label: 'Анкета в процессе' },
  { value: 'survey_completed', label: 'Анкета заполнена' },
  { value: 'survey_not_started', label: 'Анкета не начата' },
  { value: 'new_7d', label: 'Новые (7 дней)' },
  { value: 'inactive_30d', label: 'Неактивные 30+ дней' },
] as const
const SORTS = [
  { value: 'survey_updated', label: 'Сначала недавно изменённые' },
  { value: 'survey', label: 'По заполненности' },
  { value: 'name', label: 'По названию' },
  { value: 'created_at', label: 'По дате регистрации' },
] as const

function SurveysInner() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const get = (k: string, d = '') => sp.get(k) ?? d
  const set = useCallback((patch: Record<string, string>) => {
    const n = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k) }
    if (!('page' in patch) && !('user' in patch)) n.delete('page')
    router.replace(`${pathname}?${n}`, { scroll: false })
  }, [sp, router, pathname])

  const [statsOpen, setStatsOpen] = useState(true)
  const stats = useGigaQuery<Stats>('/api/giga-admin/surveys')
  const d = stats.data?.data

  const [q, setQ] = useState(get('q'))
  const dq = useDebounced(q, 350)
  useEffect(() => { if (dq !== get('q')) set({ q: dq }) }, [dq]) // eslint-disable-line react-hooks/exhaustive-deps

  const page = Number(get('page', '1')) || 1
  const sortKey = get('sort', 'survey_updated')
  const listUrl = useMemo(() => {
    const sort = sortKey
    const p = new URLSearchParams({ page: String(page), pageSize: '25', sort, dir: sortKey === 'name' ? 'asc' : 'desc' })
    if (get('q')) p.set('q', get('q'))
    if (get('segment')) p.set('segment', get('segment'))
    if (get('status')) p.set('status', get('status'))
    return `/api/giga-admin/users?${p}`
  }, [sp]) // eslint-disable-line react-hooks/exhaustive-deps
  const list = useGigaQuery<{ data: UserRow[]; total: number; page: number; pageSize: number }>(listUrl)

  const selectedId = get('user')
  const selected = list.data?.data.find((u) => u.id === selectedId) ?? (selectedId ? { id: selectedId, full_name: null, email: null, company_name: null, organization: null, role: undefined, staff_role: null } as unknown as UserRow : null)

  const columns: Column<UserRow>[] = [
    {
      key: 'user', header: 'Пользователь',
      render: (u) => (
        <HoverCard trigger={
          <span className="block min-w-0 max-w-[22rem]">
            <span className="block truncate font-medium text-slate-100 underline decoration-dotted decoration-slate-600 underline-offset-4">{u.company_name || u.organization || u.full_name || u.email}</span>
            <span className="block truncate text-[10px] text-slate-500">{[u.full_name, u.email].filter(Boolean).join(' · ')}</span>
          </span>
        }>
          {() => <SurveyPreviewCard userId={u.id} />}
        </HoverCard>
      ),
    },
    {
      key: 'progress', header: 'Анкета',
      render: (u) => (
        <div className="w-36">
          <div className="flex justify-between text-[10px] text-slate-400"><span>{u.survey_steps}/12 шагов</span><span>{Math.round((u.survey_steps / 12) * 100)}%</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className={u.survey_steps >= 12 ? 'h-full bg-emerald-400' : 'h-full bg-blue-400'} style={{ width: `${(u.survey_steps / 12) * 100}%` }} />
          </div>
        </div>
      ),
    },
    {
      key: 'state', header: 'Статус',
      render: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.survey_steps >= 12 ? <Badge tone="green">заполнена</Badge> : u.survey_steps > 0 ? <Badge tone="blue">в процессе</Badge> : <Badge>не начата</Badge>}
          <Badge tone={PROFILE_STATUS[u.status]?.tone}>{PROFILE_STATUS[u.status]?.label ?? u.status}</Badge>
          {u.role !== 'client' && <Badge>{PROFILE_ROLE[u.role] ?? u.role}</Badge>}
        </div>
      ),
    },
    { key: 'updated', header: 'Изменена', render: (u) => <span className="text-slate-400">{u.survey_updated_at ? fmtAgo(u.survey_updated_at) : '—'}</span> },
    { key: 'registered', header: 'Регистрация', render: (u) => <span className="text-slate-500">{fmtDate(u.created_at)}</span> },
  ]

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Анкеты' }]}
        title="Анкеты"
        description="Все пользователи и их анкеты. Наведите на пользователя — краткая сводка; нажмите — ответы, правка, удаление, добавление данных и история."
      />

      <Panel
        className="mb-4"
        title="Статистика анкет"
        actions={<button type="button" onClick={() => setStatsOpen((v) => !v)} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200">{statsOpen ? <><ChevronUp size={13} /> Свернуть</> : <><ChevronDown size={13} /> Показать</>}</button>}
        bodyClassName={statsOpen ? 'p-4' : 'hidden'}
      >
        <ErrorState error={stats.error} onRetry={stats.reload} />
        {!d ? <Skeleton className="h-40" /> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Клиентов" value={d.clients} />
              <StatTile label="Начали анкету" value={d.started} hint={d.clients ? `${Math.round((d.started / d.clients) * 100)}% клиентов` : undefined} tone="blue" />
              <StatTile label="Заполнили все 12 шагов" value={d.completed} hint={d.started ? `${Math.round((d.completed / d.started) * 100)}% от начавших` : undefined} tone="green" />
              <StatTile label="Среднее число шагов" value={d.avgSteps} hint="у начавших" tone="violet" />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-300">Заполненность по шагам</p>
                <BarList items={d.perStep.map((s) => ({ key: String(s.step), label: `${s.step}. ${STEPS[s.step - 1]?.title ?? ''}`, value: s.users }))} />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-300">Сколько шагов заполнено</p>
                <BarList items={d.distribution.filter((x) => x.steps > 0).map((x) => ({ key: String(x.steps), label: `${x.steps} из 12`, value: x.users }))} />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-300">Последние изменения ответов</p>
                {d.recentEdits.length === 0 ? <p className="text-xs text-slate-600">История пуста</p> : (
                  <ul className="space-y-2">
                    {d.recentEdits.slice(0, 8).map((e) => (
                      <li key={e.id} className="text-[11px]">
                        <button type="button" onClick={() => set({ user: e.user_id })} className="text-left text-slate-200 hover:text-blue-300">{e.user_label}</button>
                        <span className="text-slate-500"> · {SURVEY_LABELS[e.question_key] ?? e.question_key}</span>
                        <span className="block text-[10px] text-slate-600">{fmtAgo(e.updated_at)} · {SOURCE[e.source] ?? e.source}{e.actor_label && e.source !== 'user' ? ` · ${e.actor_label}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Анкеты пользователей" description={list.data ? `Найдено: ${list.data.total}` : undefined} bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Имя, email, компания, телефон" className="min-w-[220px] flex-1" />
          <Select label="Фильтр" value={get('segment')} onChange={(v) => set({ segment: v })} options={FILTERS} />
          <Select label="Статус" value={get('status')} onChange={(v) => set({ status: v })} options={[{ value: '', label: 'Любой статус' }, ...Object.entries(PROFILE_STATUS).map(([value, x]) => ({ value, label: x.label }))]} />
          <Select label="Сортировка" value={sortKey as (typeof SORTS)[number]['value']} onChange={(v) => set({ sort: v })} options={SORTS} />
        </div>
        {list.error && <div className="p-3"><ErrorState error={list.error} onRetry={list.reload} /></div>}
        <DataTable columns={columns} rows={list.data?.data} rowKey={(u) => u.id} loading={list.loading} onRowClick={(u) => set({ user: u.id })} />
        {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => set({ page: String(p) })} />}
      </Panel>

      {selected && (
        <SurveyDrawer
          user={{ id: selected.id, name: selected.full_name, email: selected.email, company: selected.company_name || selected.organization, role: selected.role, staffRole: selected.staff_role }}
          onClose={() => set({ user: '' })}
          onChanged={() => { void list.reload(); void stats.reload() }}
        />
      )}
      <p className="mt-3 text-[11px] text-slate-600">Полный профиль пользователя — в разделе <Link href="/admin-giga-panel/users" className="text-blue-300 hover:underline">Пользователи</Link>.</p>
    </div>
  )
}

export default function SurveysPage() {
  return (
    <RequirePermission permission="survey.view">
      <Suspense fallback={null}><SurveysInner /></Suspense>
    </RequirePermission>
  )
}
