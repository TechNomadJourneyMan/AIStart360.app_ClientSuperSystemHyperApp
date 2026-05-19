'use client'

import { useMemo, useState } from 'react'
import type { PointA, Risk, QuickWin } from '@/types/onboarding'
import { usePointAAggregate, useRecalculatePointA } from '@/hooks/usePointAAggregate'
import { useRealtimePointA } from '@/hooks/useRealtimePointA'
import PointAInsightCard from '@/components/point-a/PointAInsightCard'

interface Props {
  userId: string
  companyId: string | null
}

export default function PointAIntelligenceSection({ userId, companyId }: Props) {
  const { data, isLoading, isError, error, refetch } = usePointAAggregate()
  const recalc = useRecalculatePointA()
  const realtime = useRealtimePointA(userId, companyId)

  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null)

  const intelligence = data?.intelligence ?? null
  const risks: Risk[] = data?.risks ?? []
  const quickWins: QuickWin[] = data?.quick_wins ?? []

  const filteredDepartments = useMemo(() => {
    if (!intelligence?.by_department) return []
    if (!departmentFilter) return intelligence.by_department
    return intelligence.by_department.filter((d) => d.department === departmentFilter)
  }, [intelligence, departmentFilter])

  if (isLoading) {
    return (
      <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-8 animate-pulse">
        <div className="h-4 w-48 bg-surface-container rounded mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 bg-surface-container rounded-xl" />
          ))}
        </div>
      </section>
    )
  }

  if (isError) {
    return (
      <section className="bg-error/[0.04] border border-error/30 rounded-2xl p-6">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-error">error</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-on-surface">Не удалось загрузить интеллект-слой</p>
            <p className="text-xs text-on-surface-variant mt-1 font-mono">
              {error instanceof Error ? error.message : 'Неизвестная ошибка'}
            </p>
            <button
              onClick={() => refetch()}
              className="mt-3 text-xs font-mono text-primary hover:text-primary/80 inline-flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
              Повторить
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (!intelligence) {
    return (
      <section className="bg-surface-container-low border border-dashed border-white/[0.06] rounded-2xl p-8 text-center">
        <span className="material-symbols-outlined text-3xl text-on-surface-variant/40 mb-3 block">
          insights
        </span>
        <p className="text-sm text-on-surface-variant">Интеллект-слой ещё не построен</p>
        <p className="text-xs text-on-surface-variant/60 mt-1 font-mono">
          Заполните анкету и загрузите документы — система автоматически соберёт сильные стороны, пробелы и тренды.
        </p>
      </section>
    )
  }

  const departments = intelligence.by_department.map((d) => d.department)

  return (
    <section className="space-y-8">
      {/* Header bar with realtime status + recalc button */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-outline-variant/10 pb-4">
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1">
            Интеллект-слой · {intelligence.resolver_version}
          </p>
          <h2 className="font-headline text-xl font-bold text-on-surface">Real-time Intelligence</h2>
          <p className="text-xs text-on-surface-variant mt-1 font-mono">
            Покрытие данных:{' '}
            <span className="text-primary">{Math.round(intelligence.coverage.overall * 100)}%</span>
            {' · '}
            <span title="Realtime канал Supabase" className="inline-flex items-center gap-1">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  realtime.status === 'open'
                    ? 'bg-primary animate-pulse'
                    : realtime.status === 'connecting'
                    ? 'bg-amber-400/70'
                    : 'bg-on-surface-variant/40'
                }`}
              />
              {realtime.status === 'open'
                ? 'Realtime активен'
                : realtime.status === 'connecting'
                ? 'Подключение…'
                : 'Realtime недоступен'}
            </span>
          </p>
        </div>
        <button
          onClick={() => recalc.mutate()}
          disabled={recalc.isPending}
          className="inline-flex items-center gap-2 text-xs font-mono text-primary border border-primary/40 hover:bg-primary/10 disabled:opacity-50 rounded-xl px-3 py-2 transition-colors"
        >
          <span className={`material-symbols-outlined text-base ${recalc.isPending ? 'animate-spin' : ''}`}>
            {recalc.isPending ? 'progress_activity' : 'refresh'}
          </span>
          {recalc.isPending ? 'Пересчёт…' : 'Пересчитать'}
        </button>
      </div>

      {/* Coverage strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(['biz', 'kpi', 'gri', 'goal'] as const).map((ns) => {
          const ratio = intelligence.coverage[ns] ?? 0
          const label = ns === 'biz' ? 'Бизнес' : ns === 'kpi' ? 'KPI' : ns === 'gri' ? 'GRI' : 'Цели'
          return (
            <div
              key={ns}
              className="bg-surface-container-low rounded-xl border border-white/[0.04] p-3"
            >
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">
                {label}
              </p>
              <p className="text-xl font-mono font-bold text-on-surface">
                {Math.round(ratio * 100)}%
              </p>
              <div className="h-1 mt-2 bg-surface-container rounded-full overflow-hidden">
                <div
                  className={`h-full ${ratio >= 0.5 ? 'bg-primary' : ratio >= 0.2 ? 'bg-tertiary-container' : 'bg-error'}`}
                  style={{ width: `${ratio * 100}%` }}
                />
              </div>
            </div>
          )
        })}
        <div className="bg-primary/[0.06] rounded-xl border border-primary/30 p-3">
          <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-1">
            Всего
          </p>
          <p className="text-xl font-mono font-bold text-primary">
            {Math.round(intelligence.coverage.overall * 100)}%
          </p>
          <div className="h-1 mt-2 bg-surface-container rounded-full overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${intelligence.coverage.overall * 100}%` }} />
          </div>
        </div>
      </div>

      {/* Top strengths */}
      {intelligence.top_strengths.length > 0 && (
        <div>
          <h3 className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
            Сильные стороны
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {intelligence.top_strengths.slice(0, 6).map((s) => (
              <div
                key={s.metric_id}
                className="bg-surface-container-low rounded-2xl border border-primary/20 bg-primary/[0.03] p-4"
              >
                <div className="flex items-start justify-between mb-2">
                  <p className="text-xs text-on-surface-variant font-mono uppercase tracking-widest">
                    {s.namespace}
                  </p>
                  <span className="material-symbols-outlined text-primary/70 text-sm">
                    trending_up
                  </span>
                </div>
                <p className="text-sm text-on-surface font-bold mb-2 leading-snug">{s.label}</p>
                <p className="text-xl font-mono text-primary">
                  {s.value !== null && s.value !== undefined ? String(s.value) : '—'}
                  {s.unit ? <span className="text-xs text-on-surface-variant ml-1">{s.unit}</span> : null}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top gaps */}
      {intelligence.top_gaps.length > 0 && (
        <div>
          <h3 className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
            Что добавить для точности
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {intelligence.top_gaps.slice(0, 6).map((g) => (
              <div
                key={g.metric_id}
                className="bg-surface-container-low rounded-2xl border border-dashed border-white/10 p-4"
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="material-symbols-outlined text-on-surface-variant/60 text-sm">
                    help
                  </span>
                </div>
                <p className="text-sm text-on-surface font-bold mb-1 leading-snug">{g.label}</p>
                <p className="text-xs text-on-surface-variant/80 font-mono">{g.suggested_source}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* By department drilldown */}
      {departments.length > 0 && (
        <div>
          <div className="flex items-end justify-between mb-3">
            <h3 className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em]">
              По департаментам
            </h3>
            <div className="flex gap-1.5 overflow-x-auto scrollbar-thin">
              <button
                onClick={() => setDepartmentFilter(null)}
                className={`text-[11px] font-mono rounded-full border px-2.5 py-1 whitespace-nowrap transition-colors ${
                  departmentFilter === null
                    ? 'bg-primary/15 text-primary border-primary/40'
                    : 'bg-surface-container text-on-surface-variant border-white/[0.04] hover:border-white/15'
                }`}
              >
                Все
              </button>
              {departments.map((d) => (
                <button
                  key={d}
                  onClick={() => setDepartmentFilter(d)}
                  className={`text-[11px] font-mono rounded-full border px-2.5 py-1 whitespace-nowrap transition-colors ${
                    departmentFilter === d
                      ? 'bg-primary/15 text-primary border-primary/40'
                      : 'bg-surface-container text-on-surface-variant border-white/[0.04] hover:border-white/15'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredDepartments.map((d) => (
              <div
                key={d.department}
                className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-sm font-bold text-on-surface">{d.department}</p>
                    <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mt-0.5">
                      Покрытие {Math.round(d.coverage * 100)}%
                    </p>
                  </div>
                </div>
                {d.strongest.length > 0 && (
                  <div className="mb-3">
                    <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-2">
                      Сильное
                    </p>
                    <ul className="space-y-1.5">
                      {d.strongest.map((m) => (
                        <li
                          key={m.metric_id}
                          className="flex items-center justify-between text-xs"
                        >
                          <span className="text-on-surface truncate mr-2">{m.label}</span>
                          <span className="font-mono text-primary whitespace-nowrap">
                            {m.value !== null && m.value !== undefined ? String(m.value) : '—'}{' '}
                            <span className="text-on-surface-variant">{m.unit}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {d.weakest.length > 0 && (
                  <div>
                    <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">
                      Не хватает
                    </p>
                    <ul className="space-y-1.5">
                      {d.weakest.map((m) => (
                        <li key={m.metric_id} className="text-xs">
                          <span className="text-on-surface">{m.label}</span>
                          <p className="text-[10px] text-on-surface-variant/70 font-mono mt-0.5">
                            {m.reason}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risks + Quick Wins as PointAInsightCard */}
      {(risks.length > 0 || quickWins.length > 0) && (
        <div>
          <h3 className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
            Действия
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {risks.slice(0, 4).map((r, i) => (
              <PointAInsightCard
                key={`risk-${i}`}
                kind="risk"
                level={r.level}
                area={r.area}
                text={r.text}
                impact={r.impact}
              />
            ))}
            {quickWins.slice(0, 4).map((q, i) => (
              <PointAInsightCard
                key={`qw-${i}`}
                kind="quick_win"
                area={q.area}
                text={q.action}
                timeline={q.timeline}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
