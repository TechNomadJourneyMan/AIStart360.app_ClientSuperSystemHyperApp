'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { HorizonPlan, PointBV2 } from '@/lib/point-b/engine'
import { Card, formatMoneyFull, formatScore, DASH, blockLabel } from './shared'

const HORIZON_ORDER: { key: keyof PointBV2['horizons']; short: string; icon: string }[] = [
  { key: 'three_year', short: '3 года', icon: 'flight_takeoff' },
  { key: 'one_year', short: '12 мес', icon: 'calendar_month' },
  { key: 'quarter', short: 'Квартал', icon: 'date_range' },
  { key: 'month', short: 'Месяц', icon: 'event' },
  { key: 'week', short: 'Неделя', icon: 'today' },
]

function PlanBody({ plan }: { plan: HorizonPlan }) {
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
        </Card>
        <Card className="!p-4">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">
            Целевой GRI
          </p>
          <p className="text-lg font-mono font-bold text-primary">{formatScore(plan.target_overall_score)}</p>
        </Card>
      </div>

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
          <p className="text-sm text-on-surface-variant/60 font-mono">{DASH}</p>
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
          <p className="text-sm text-on-surface-variant/60 font-mono">{DASH}</p>
        )}
      </div>

      {/* KPIs */}
      {plan.kpis.length > 0 && (
        <div>
          <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-2">KPI</p>
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
        </div>
      )}
    </div>
  )
}

export function HorizonPlans({ horizons }: { horizons: PointBV2['horizons'] }) {
  const [active, setActive] = useState<keyof PointBV2['horizons']>('one_year')
  const activePlan = horizons[active]

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div
        className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1"
        role="tablist"
        aria-label="Горизонты планирования"
      >
        {HORIZON_ORDER.map((h) => {
          const selected = active === h.key
          return (
            <button
              key={h.key}
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(h.key)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 py-2 text-xs font-mono transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                selected
                  ? 'bg-primary/[0.10] border-primary/30 text-primary'
                  : 'bg-surface-container-low border-white/[0.06] text-on-surface-variant hover:text-on-surface hover:border-white/10'
              }`}
            >
              <span className="material-symbols-outlined text-sm" aria-hidden>
                {h.icon}
              </span>
              {h.short}
            </button>
          )
        })}
      </div>

      {/* Active plan */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <h3 className="font-headline text-base font-bold text-on-surface">{activePlan.title}</h3>
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <PlanBody plan={activePlan} />
          </motion.div>
        </AnimatePresence>
      </Card>
    </div>
  )
}
