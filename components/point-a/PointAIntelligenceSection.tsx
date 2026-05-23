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
  const [activeTab, setActiveTab] = useState<'strengths' | 'gaps' | 'departments' | 'actions'>('strengths')

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
    <section className="space-y-5">
      {/* Compact bar — live status + recalc + coverage chips */}
      <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              title="Realtime канал Supabase"
              className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider"
            >
              <span className="relative flex w-2 h-2">
                {realtime.status === 'open' && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-70" />
                )}
                <span
                  className={`relative inline-flex w-2 h-2 rounded-full ${
                    realtime.status === 'open'
                      ? 'bg-primary'
                      : realtime.status === 'connecting'
                      ? 'bg-amber-400'
                      : 'bg-on-surface-variant/40'
                  }`}
                />
              </span>
              <span
                className={
                  realtime.status === 'open'
                    ? 'text-primary'
                    : realtime.status === 'connecting'
                    ? 'text-amber-400'
                    : 'text-on-surface-variant/70'
                }
              >
                {realtime.status === 'open' ? 'live' : realtime.status === 'connecting' ? 'connecting' : 'offline'}
              </span>
            </span>
            <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">
              · Покрытие <span className="text-primary">{Math.round(intelligence.coverage.overall * 100)}%</span>
            </span>
          </div>
          <button
            onClick={() => recalc.mutate()}
            disabled={recalc.isPending}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-primary border border-primary/40 hover:bg-primary/10 disabled:opacity-50 rounded-lg px-2.5 py-1.5 transition-colors"
          >
            <span className={`material-symbols-outlined text-[14px] ${recalc.isPending ? 'animate-spin' : ''}`}>
              {recalc.isPending ? 'progress_activity' : 'refresh'}
            </span>
            {recalc.isPending ? 'Пересчёт…' : 'Пересчитать'}
          </button>
        </div>

        {/* Compact live coverage bars */}
        <div className="grid grid-cols-5 gap-1.5">
          {(['biz', 'kpi', 'gri', 'goal'] as const).map((ns) => {
            const ratio = intelligence.coverage[ns] ?? 0
            const label = ns === 'biz' ? 'Бизнес' : ns === 'kpi' ? 'KPI' : ns === 'gri' ? 'GRI' : 'Цели'
            const barClass =
              ratio >= 0.5 ? 'bg-primary' : ratio >= 0.2 ? 'bg-amber-400' : 'bg-error/70'
            return (
              <div key={ns} className="bg-surface-container rounded-lg px-2 py-1.5">
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-wide truncate">
                    {label}
                  </span>
                  <span className="text-[11px] font-mono font-bold text-on-surface tabular-nums">
                    {Math.round(ratio * 100)}%
                  </span>
                </div>
                <div className="h-0.5 mt-1 bg-surface-container-high rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-700 ${barClass} ${
                      realtime.status === 'open' ? 'animate-pulse' : ''
                    }`}
                    style={{ width: `${ratio * 100}%` }}
                  />
                </div>
              </div>
            )
          })}
          <div className="bg-primary/[0.08] rounded-lg px-2 py-1.5 border border-primary/30">
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-[9px] font-mono text-primary/70 uppercase tracking-wide">Всего</span>
              <span className="text-[11px] font-mono font-bold text-primary tabular-nums">
                {Math.round(intelligence.coverage.overall * 100)}%
              </span>
            </div>
            <div className="h-0.5 mt-1 bg-surface-container-high rounded-full overflow-hidden">
              <div
                className={`h-full bg-primary transition-all duration-700 ${
                  realtime.status === 'open' ? 'animate-pulse' : ''
                }`}
                style={{ width: `${intelligence.coverage.overall * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Interactive tabbed intelligence panel — strengths / gaps / departments / actions */}
      {(intelligence.top_strengths.length > 0 ||
        intelligence.top_gaps.length > 0 ||
        departments.length > 0 ||
        risks.length > 0 ||
        quickWins.length > 0) && (
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
          {/* Tab strip */}
          <div className="flex items-center gap-1 p-1.5 border-b border-white/[0.04] bg-surface-container/40 overflow-x-auto scrollbar-thin">
            {[
              { key: 'strengths' as const, label: 'Сильные стороны', icon: 'trending_up', count: intelligence.top_strengths.length },
              { key: 'gaps' as const, label: 'Пробелы', icon: 'help', count: intelligence.top_gaps.length },
              { key: 'departments' as const, label: 'Департаменты', icon: 'apartment', count: departments.length },
              { key: 'actions' as const, label: 'Действия', icon: 'bolt', count: risks.length + quickWins.length },
            ].filter((t) => t.count > 0).map((tab) => {
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 text-[11px] font-mono rounded-lg px-2.5 py-1.5 whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-primary/15 text-primary border border-primary/40 shadow-[0_0_0_1px_rgba(110,255,192,0.1)]'
                      : 'text-on-surface-variant border border-transparent hover:bg-surface-container hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">{tab.icon}</span>
                  <span>{tab.label}</span>
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                      isActive ? 'bg-primary/20 text-primary' : 'bg-surface-container-high text-on-surface-variant'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="p-3">
            {activeTab === 'strengths' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                {intelligence.top_strengths.slice(0, 12).map((s) => (
                  <div
                    key={s.metric_id}
                    className="rounded-xl border border-primary/20 bg-primary/[0.04] p-2.5 hover:bg-primary/[0.07] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[9px] text-on-surface-variant font-mono uppercase tracking-wider truncate">
                        {s.namespace}
                      </p>
                      <span className="material-symbols-outlined text-primary/70 text-[12px]">trending_up</span>
                    </div>
                    <p className="text-[11px] text-on-surface font-bold leading-tight mb-1 line-clamp-2 min-h-[28px]">
                      {s.label}
                    </p>
                    <p className="text-sm font-mono font-bold text-primary tabular-nums">
                      {s.value !== null && s.value !== undefined ? String(s.value) : '—'}
                      {s.unit ? <span className="text-[9px] text-on-surface-variant ml-0.5">{s.unit}</span> : null}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'gaps' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {intelligence.top_gaps.slice(0, 12).map((g) => (
                  <div
                    key={g.metric_id}
                    className="rounded-xl border border-dashed border-white/10 p-2.5 hover:border-white/20 transition-colors flex items-start gap-2"
                  >
                    <span className="material-symbols-outlined text-on-surface-variant/60 text-[14px] mt-0.5 flex-shrink-0">help</span>
                    <div className="min-w-0">
                      <p className="text-[11px] text-on-surface font-bold leading-tight mb-0.5">{g.label}</p>
                      <p className="text-[10px] text-on-surface-variant/70 font-mono leading-snug truncate">{g.suggested_source}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'departments' && (
              <div className="space-y-2">
                <div className="flex gap-1 overflow-x-auto scrollbar-thin">
                  <button
                    onClick={() => setDepartmentFilter(null)}
                    className={`text-[10px] font-mono rounded-md border px-2 py-0.5 whitespace-nowrap transition-colors ${
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
                      className={`text-[10px] font-mono rounded-md border px-2 py-0.5 whitespace-nowrap transition-colors ${
                        departmentFilter === d
                          ? 'bg-primary/15 text-primary border-primary/40'
                          : 'bg-surface-container text-on-surface-variant border-white/[0.04] hover:border-white/15'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {filteredDepartments.map((d) => {
                    const cov = Math.round(d.coverage * 100)
                    const covColor = cov >= 60 ? 'bg-primary' : cov >= 30 ? 'bg-amber-400' : 'bg-error/70'
                    return (
                      <div
                        key={d.department}
                        className="rounded-xl border border-white/[0.04] bg-surface-container/50 p-2.5 hover:border-primary/20 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1.5 gap-2">
                          <p className="text-[11px] font-bold text-on-surface truncate">{d.department}</p>
                          <span className="text-[10px] font-mono text-on-surface-variant tabular-nums flex-shrink-0">{cov}%</span>
                        </div>
                        <div className="h-0.5 bg-surface-container-high rounded-full overflow-hidden mb-2">
                          <div className={`h-full ${covColor}`} style={{ width: `${cov}%` }} />
                        </div>
                        {d.strongest.length > 0 && (
                          <ul className="space-y-0.5 mb-1.5">
                            {d.strongest.slice(0, 3).map((m) => (
                              <li
                                key={m.metric_id}
                                className="flex items-center justify-between text-[10px] gap-1"
                              >
                                <span className="text-on-surface/85 truncate flex items-center gap-1 min-w-0">
                                  <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                                  {m.label}
                                </span>
                                <span className="font-mono text-primary tabular-nums whitespace-nowrap">
                                  {m.value !== null && m.value !== undefined ? String(m.value) : '—'}
                                  {m.unit ? <span className="text-on-surface-variant/60 ml-0.5">{m.unit}</span> : null}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {d.weakest.length > 0 && (
                          <ul className="space-y-0.5 pt-1.5 border-t border-white/[0.04]">
                            {d.weakest.slice(0, 3).map((m) => (
                              <li key={m.metric_id} className="text-[10px] flex items-center gap-1 text-on-surface-variant">
                                <span className="w-1 h-1 rounded-full bg-on-surface-variant/40 flex-shrink-0" />
                                <span className="truncate">{m.label}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {activeTab === 'actions' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
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
            )}
          </div>
        </div>
      )}
    </section>
  )
}
