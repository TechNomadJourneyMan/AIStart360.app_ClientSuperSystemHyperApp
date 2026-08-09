'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import type { HorizonPlan, PointBV2 } from '@/lib/point-b/engine'
import {
  Card,
  Chevron,
  Expandable,
  formatMoney,
  formatMoneyFull,
  formatScore,
  DASH,
  blockLabel,
} from './shared'

type HorizonKey = keyof PointBV2['horizons']

const HORIZON_ORDER: {
  key: HorizonKey
  short: string
  icon: string
  /** Where this horizon's numbers come from — shown in the раскрытие. */
  provenance: string
}[] = [
  {
    key: 'three_year',
    short: '3 года',
    icon: 'flight_takeoff',
    provenance: 'Целевая выручка — ваша цель на 3 года. Фокус — три самых слабых блока Точки А.',
  },
  {
    key: 'one_year',
    short: '12 мес',
    icon: 'calendar_month',
    provenance: 'Целевая выручка — ваша цель на 12 месяцев. Действия — ТОП-ограничения из GRI.',
  },
  {
    key: 'quarter',
    short: 'Квартал',
    icon: 'date_range',
    provenance: 'Целевая выручка — 3-й месяц траектории к годовой цели (равномерный темп роста).',
  },
  {
    key: 'month',
    short: 'Месяц',
    icon: 'event',
    provenance: 'Целевая выручка — 1-й месяц траектории к годовой цели. Действия — quick wins из Точки А.',
  },
  {
    key: 'week',
    short: 'Неделя',
    icon: 'today',
    provenance: 'Отдельной цели по выручке на неделю нет — здесь только ближайшие шаги из Точки А.',
  },
]

function EmptyLine({ text, href, cta }: { text: string; href?: string; cta?: string }) {
  return (
    <p className="text-xs text-on-surface-variant/70">
      {text}
      {href && cta && (
        <>
          {' '}
          <Link href={href} className="text-primary hover:underline font-medium">
            {cta}
          </Link>
        </>
      )}
    </p>
  )
}

function PlanBody({
  plan,
  provenance,
  surveyHref,
}: {
  plan: HorizonPlan
  provenance: string
  surveyHref: string
}) {
  return (
    <div className="space-y-5">
      {/* Targets */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="!p-4">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">
            Целевая выручка
          </p>
          <p className="text-lg font-mono font-bold text-primary">
            {formatMoneyFull(plan.target_revenue)}
          </p>
          {plan.target_revenue == null && (
            <p className="text-[11px] text-on-surface-variant/70 mt-1">
              Цель на этот горизонт не задана
            </p>
          )}
        </Card>
        <Card className="!p-4">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">
            Целевой GRI
          </p>
          <p className="text-lg font-mono font-bold text-primary">{formatScore(plan.target_overall_score)}</p>
          {plan.target_overall_score == null && (
            <p className="text-[11px] text-on-surface-variant/70 mt-1">
              Балл ставится только на годовом и трёхлетнем горизонте
            </p>
          )}
        </Card>
      </div>

      {/* Where these numbers come from — the plan is computed, not authored. */}
      <p className="text-xs text-on-surface-variant leading-relaxed rounded-xl bg-surface-container/60 border border-white/[0.06] px-3.5 py-3">
        {provenance}
      </p>

      {/* Focus */}
      <div>
        <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-2">Фокус</p>
        {plan.focus.length ? (
          <div className="flex flex-wrap gap-1.5">
            {plan.focus.map((f, i) => (
              <span
                key={`${f}-${i}`}
                className="text-xs font-mono bg-white/[0.05] text-on-surface-variant px-2.5 py-1 rounded-lg"
              >
                {blockLabel(f)}
              </span>
            ))}
          </div>
        ) : (
          <EmptyLine
            text="Фокус не определён — он строится из баллов блоков Точки А."
            href="/point-a"
            cta="Открыть Точку А"
          />
        )}
      </div>

      {/* Actions */}
      <div>
        <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-2">Действия</p>
        {plan.actions.length ? (
          <ul className="space-y-2">
            {plan.actions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-on-surface">
                <span className="material-symbols-outlined text-primary/50 text-base mt-0.5 flex-shrink-0" aria-hidden>
                  check_circle
                </span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyLine
            text="Действий нет: они собираются из ТОП-ограничений GRI и quick wins Точки А."
            href={surveyHref}
            cta="Заполнить анкету"
          />
        )}
      </div>

      {/* KPIs */}
      <div>
        <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-2">KPI</p>
        {plan.kpis.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {plan.kpis.map((kpi, i) => (
              <div
                key={i}
                className="flex items-center justify-between bg-surface-container rounded-xl px-3.5 py-2.5 border border-white/[0.04]"
              >
                <span className="text-xs text-on-surface-variant">{kpi.label}</span>
                <span className="text-xs font-mono font-bold text-on-surface">{kpi.target || DASH}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyLine text="KPI на этот горизонт появятся, когда будет задана цель по выручке." />
        )}
      </div>
    </div>
  )
}

/**
 * Пять горизонтов как одна лестница: 3 года → 12 мес → квартал → месяц → неделя.
 * Раньше это был переключатель (виден ровно один горизонт), теперь — аккордеон:
 * каждый этап раскрывается отдельно, можно держать открытыми несколько.
 */
export function HorizonPlans({
  horizons,
  surveyHref = '/client/onboarding',
}: {
  horizons: PointBV2['horizons']
  /** Куда ведут ссылки «заполнить анкету» (зависит от оболочки). */
  surveyHref?: string
}) {
  // 12 месяцев — рабочий горизонт владельца, он открыт сразу.
  const [open, setOpen] = useState<Record<string, boolean>>({ one_year: true })

  const openCount = HORIZON_ORDER.filter((h) => open[h.key]).length
  const allOpen = openCount === HORIZON_ORDER.length

  const toggleAll = () => {
    const next: Record<string, boolean> = {}
    for (const h of HORIZON_ORDER) next[h.key] = !allOpen
    setOpen(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={toggleAll}
          className="inline-flex items-center gap-1.5 text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] hover:border-primary/30 rounded-lg px-3 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className="material-symbols-outlined text-sm" aria-hidden>
            {allOpen ? 'unfold_less' : 'unfold_more'}
          </span>
          {allOpen ? 'Свернуть все' : 'Развернуть все'}
        </button>
      </div>

      {HORIZON_ORDER.map((h) => {
        const plan = horizons[h.key]
        const isOpen = !!open[h.key]
        return (
          <Expandable
            key={h.key}
            open={isOpen}
            onOpenChange={(v) => setOpen((prev) => ({ ...prev, [h.key]: v }))}
            ariaLabel={`${isOpen ? 'Свернуть' : 'Раскрыть'} этап «${plan.title}»`}
            className="bg-surface-container-low rounded-2xl border border-white/[0.06] shadow-card overflow-hidden"
            triggerClassName={`!rounded-none px-5 py-4 transition-colors ${
              isOpen ? 'bg-primary/[0.04]' : 'hover:bg-white/[0.02]'
            }`}
            panelClassName="px-5 pb-5"
            summary={(o) => (
              <div className="flex items-center gap-3">
                <span
                  className={`material-symbols-outlined text-lg flex-shrink-0 ${
                    o ? 'text-primary' : 'text-on-surface-variant'
                  }`}
                  aria-hidden
                >
                  {h.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
                    {h.short}
                  </p>
                  <p className={`text-sm font-bold truncate ${o ? 'text-primary' : 'text-on-surface'}`}>
                    {plan.title}
                  </p>
                </div>
                <span className="text-xs font-mono text-on-surface-variant flex-shrink-0 hidden sm:block">
                  {formatMoney(plan.target_revenue)}
                </span>
                <Chevron open={o} className="text-on-surface-variant flex-shrink-0" />
              </div>
            )}
          >
            <AnimatePresence initial={false}>
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
              >
                <PlanBody plan={plan} provenance={h.provenance} surveyHref={surveyHref} />
              </motion.div>
            </AnimatePresence>
          </Expandable>
        )
      })}
    </div>
  )
}
