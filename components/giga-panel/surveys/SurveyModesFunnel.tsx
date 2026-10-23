'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'
import { Badge, EmptyState, ErrorState, Panel, Select, Skeleton, StatTile, useGigaQuery } from '@/components/giga-panel/kit'
import { SURVEY_MODE_STAFF_NAME, shortDate } from '@/lib/survey/staff-status'
import { SURVEY_MODE_ORDER } from '@/lib/survey/modes'
import type { ModeFunnel } from '@/lib/survey/mode-funnel'

export interface ModeFunnelPayload extends ModeFunnel {
  days: number
  people: Record<string, { name: string; company: string | null }>
  submissionsSource: 'completions' | 'events'
}

const PERIODS = [
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
  { value: '180', label: '180 дней' },
] as const
type Period = (typeof PERIODS)[number]['value']

const pctText = (v: number | null) => (v === null ? '—' : `${v}%`)

/**
 * «Способы заполнения анкеты» (survey Ф5, spec §15): the funnel of the modes
 * from user_events, the mode split, the express and chat metrics, the clients
 * stuck on the express. Presentational; the data: GET /api/giga-admin/surveys/modes.
 */
export function SurveyModesFunnelView({ data, base, period, onPeriod }: {
  data: ModeFunnelPayload
  base: string
  period?: Period
  onPeriod?: (p: Period) => void
}) {
  const person = (id: string) => data.people[id] ?? { name: `Пользователь ${id.slice(0, 8)}`, company: null }
  const userHref = (id: string) => `${base}/users/${id}?tab=survey`
  const modes = (r: Record<string, number>) => SURVEY_MODE_ORDER.map((m) => `${SURVEY_MODE_STAFF_NAME[m]} — ${r[m] ?? 0}`).join(' · ')
  return (
    <Panel
      className="mb-4"
      title="Способы заполнения анкеты"
      description="Когорта — клиенты, впервые выбравшие способ за период. Шаги не строгие: выбравший полную анкету сразу попадает в последний шаг. «Анкета отправлена» — только полная анкета."
      actions={onPeriod && period ? <Select label="Период" value={period} onChange={onPeriod} options={PERIODS} /> : undefined}
    >
      {data.cohort === 0 ? (
        <EmptyState
          title="За период никто не выбирал способ заполнения"
          text="Выбор появляется у клиентов, когда включены режимы (переменная NEXT_PUBLIC_SURVEY_MODES)."
        />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Выбрали способ" value={data.cohort} hint={`переключались: ${data.switched}`} tone="blue" />
            <StatTile label="Экспресс: медиана" value={data.express.medianMinutes === null ? '—' : `${data.express.medianMinutes} мин`} hint={`прошли: ${data.express.completed}`} tone="violet" />
            <StatTile label="Блок за 7 дней после экспресса" value={pctText(data.express.blockWithin7dShare)} hint={`${data.express.blockWithin7d} из ${data.express.completed} · цель ≥ 30%`} tone="amber" />
            <StatTile label="Беседа: принято без правки" value={pctText(data.chat.acceptedWithoutEdit)} hint={`записано ${data.chat.applied} · исправлено ${data.chat.edited} · пропущено ${data.chat.rejected} · цель ≥ 70%`} tone="green" />
          </div>

          <ol aria-label="Воронка способов заполнения" className="space-y-2">
            {data.steps.map((s, i) => (
              <li key={s.key} data-step={s.key}>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-slate-200">{i + 1}. {s.label}</span>
                  <span className="whitespace-nowrap text-slate-400">
                    <b className="text-slate-100">{s.users}</b> · {pctText(s.ofCohort)} от выбравших{s.ofPrevious !== null ? ` · ${pctText(s.ofPrevious)} от предыдущего` : ''}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
                  <div className={s.key === 'full_submitted' ? 'h-full bg-emerald-400' : 'h-full bg-blue-400'} style={{ width: `${Math.min(100, s.ofCohort ?? 0)}%` }} />
                </div>
              </li>
            ))}
          </ol>

          <div className="grid gap-3 text-[11px] text-slate-400 lg:grid-cols-2">
            <p><span className="text-slate-300">Первый выбор:</span> {modes(data.byFirstMode)}</p>
            <p><span className="text-slate-300">Последний выбор:</span> {modes(data.byLastMode)}</p>
            <p><span className="text-slate-300">Беседа с ИИ:</span> карточек показано {data.chat.shown} · отклонено проверкой чисел {data.chat.guardBlocked} · передано эксперту {data.chat.escalated} · «Помощник» у поля {data.chat.helperOpened}</p>
            {data.submissionsSource === 'events' && <p className="text-amber-300">Отправка анкеты посчитана по событиям: функция admin_survey_completions недоступна.</p>}
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="stuck-express">
          <h3 id="stuck-express" className="mb-2 text-xs font-semibold text-slate-300">Застряли на экспрессе <Badge tone="amber">{data.stuck.length}</Badge></h3>
          {data.stuck.length === 0 ? <p className="text-xs text-slate-600">Никого: все, кто прошёл экспресс, отправили полную анкету.</p> : (
            <ul className="space-y-1.5">
              {data.stuck.map((s) => (
                <li key={s.userId} className="flex items-baseline justify-between gap-2 text-[11px]">
                  <Link href={userHref(s.userId)} className="min-w-0 truncate text-slate-200 hover:text-blue-300">
                    {person(s.userId).company ?? person(s.userId).name}
                    {person(s.userId).company && <span className="text-slate-500"> · {person(s.userId).name}</span>}
                  </Link>
                  <span className="whitespace-nowrap text-slate-500">экспресс {shortDate(s.expressCompletedAt)} · {s.days} дн. без полной анкеты</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="pending-full">
          <h3 id="pending-full" className="mb-2 text-xs font-semibold text-slate-300">Выбрали способ, полную анкету не отправили <Badge>{data.pending.length}</Badge></h3>
          {data.pending.length === 0 ? <p className="text-xs text-slate-600">Никого за период.</p> : (
            <ul className="space-y-1.5">
              {data.pending.map((p) => (
                <li key={p.userId} className="flex items-baseline justify-between gap-2 text-[11px]">
                  <Link href={userHref(p.userId)} className="min-w-0 truncate text-slate-200 hover:text-blue-300">{person(p.userId).company ?? person(p.userId).name}</Link>
                  <span className="whitespace-nowrap text-slate-500">{p.mode ? SURVEY_MODE_STAFF_NAME[p.mode] : '—'} · с {shortDate(p.chosenAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Panel>
  )
}

export function SurveyModesFunnel() {
  const { base } = useWorkspace()
  const [period, setPeriod] = useState<Period>('30')
  const q = useGigaQuery<{ data: ModeFunnelPayload }>(`/api/giga-admin/surveys/modes?days=${period}`)
  if (q.error) return <div className="mb-4"><ErrorState error={q.error} onRetry={q.reload} /></div>
  if (!q.data) return <Skeleton className="mb-4 h-48" />
  return <SurveyModesFunnelView data={q.data.data} base={base} period={period} onPeriod={setPeriod} />
}
