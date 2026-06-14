'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import type { PointBV2, GapEntry, Scenario, Lever } from '@/lib/point-b/engine'
import {
  Section,
  Card,
  Pill,
  EmptyState,
  blockLabel,
  realismStyle,
  severityStyle,
  DIFFICULTY_LABEL,
  CONFIDENCE_LABEL,
  formatMoney,
  formatMoneyFull,
  formatPercent,
  formatMultiplier,
  formatNum,
  formatScore,
  DASH,
} from './shared'
import { TrajectoryChart } from './TrajectoryChart'
import { HorizonPlans } from './HorizonPlans'
import { AiStrategy } from './AiStrategy'

export interface PointBViewProps {
  pointB: PointBV2 | null
  loading?: boolean
  error?: string | null
  reason?: string | null
  onRecalculate?: () => void
}

// ─── State: loading skeleton ──────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-10 animate-pulse" aria-busy="true" aria-label="Загрузка Точки Б">
      <div className="space-y-3">
        <div className="h-3 w-48 bg-white/[0.06] rounded" />
        <div className="h-9 w-64 bg-white/[0.06] rounded-lg" />
        <div className="h-4 w-96 max-w-full bg-white/[0.04] rounded" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 bg-surface-container-low rounded-2xl border border-white/[0.06]" />
        ))}
      </div>
      <div className="h-56 bg-surface-container-low rounded-2xl border border-white/[0.06]" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-48 bg-surface-container-low rounded-2xl border border-white/[0.06]" />
        ))}
      </div>
    </div>
  )
}

// ─── State: error ─────────────────────────────────────────────────────────────

function ErrorPanel({ error, onRecalculate }: { error: string; onRecalculate?: () => void }) {
  return (
    <div className="bg-error/[0.04] border border-error/20 rounded-2xl p-10 text-center">
      <span className="material-symbols-outlined text-4xl text-error/70 mb-3 block" aria-hidden>
        error
      </span>
      <h2 className="font-headline text-xl font-bold text-on-surface mb-2">Не удалось загрузить Точку Б</h2>
      <p className="text-sm text-on-surface-variant mb-6 max-w-md mx-auto">{error}</p>
      {onRecalculate && (
        <button
          onClick={onRecalculate}
          className="inline-flex items-center gap-2 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-sm px-5 py-2.5 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className="material-symbols-outlined text-base" aria-hidden>
            refresh
          </span>
          Повторить
        </button>
      )}
    </div>
  )
}

// ─── State: no diagnostic ─────────────────────────────────────────────────────

function NoDiagnostic() {
  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
        <span className="material-symbols-outlined text-3xl text-primary" aria-hidden>
          flag
        </span>
      </div>
      <h2 className="font-headline text-2xl font-bold text-on-surface mb-2">
        Точка Б появится после диагностики Точки А
      </h2>
      <p className="text-sm text-on-surface-variant mb-7 max-w-md mx-auto">
        Целевое состояние строится из вашей текущей выручки, целей из анкеты и результатов диагностики.
        Сначала пройдите Точку А.
      </p>
      <Link
        href="/client/point-a"
        className="inline-flex items-center gap-2 bg-gradient-to-r from-primary to-primary-fixed-dim text-on-primary font-bold text-sm px-5 py-2.5 rounded-xl transition-all hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <span className="material-symbols-outlined text-base" aria-hidden>
          assessment
        </span>
        Перейти к Точке А
      </Link>
    </div>
  )
}

// ─── Insufficient-data honest panel ──────────────────────────────────────────

function InsufficientPanel({ missing, confidence }: { missing: string[]; confidence: number }) {
  return (
    <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.05] p-6">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-2xl text-amber-400 flex-shrink-0" aria-hidden>
          warning
        </span>
        <div className="space-y-3 flex-1">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">
              Недостаточно данных для точного плана
            </h2>
            <p className="text-sm text-on-surface-variant mt-1">
              Уверенность расчёта: <span className="font-mono text-amber-400">{Math.round(confidence)}%</span>.
              Часть показателей ниже отмечена как «{DASH}» — мы не подставляем выдуманные цифры.
            </p>
          </div>

          {missing.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-amber-400/80 uppercase tracking-widest mb-2">
                Чего не хватает
              </p>
              <ul className="space-y-1.5">
                {missing.map((m, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-on-surface">
                    <span className="material-symbols-outlined text-amber-400/70 text-base mt-0.5 flex-shrink-0" aria-hidden>
                      remove
                    </span>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl bg-surface-container/60 border border-white/[0.06] p-3.5">
            <p className="text-xs text-on-surface-variant">
              Как добавить: откройте{' '}
              <Link href="/client/onboarding" className="text-primary hover:underline font-medium">
                анкету
              </Link>{' '}
              и заполните блок «Финансы» (текущая выручка) и цели — целевую выручку на 12 месяцев и 3 года.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── HERO ─────────────────────────────────────────────────────────────────────

function HeroGoalCard({
  label,
  horizon,
  year,
  month,
}: {
  label: string
  horizon: string
  year: number | null
  month: number | null
}) {
  return (
    <Card hover>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest">{label}</p>
        <span className="text-[10px] font-mono text-on-surface-variant">{horizon}</span>
      </div>
      <p className="text-2xl font-mono font-bold text-primary leading-tight">{formatMoney(year)}</p>
      <p className="text-xs font-mono text-on-surface-variant mt-1.5">{formatMoney(month)} / мес</p>
    </Card>
  )
}

function Hero({ pointB }: { pointB: PointBV2 }) {
  const r = realismStyle(pointB.realism.level)
  const { goals } = pointB
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <div className="space-y-3">
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em]">
          Точка Б · Целевое состояние
        </p>
        <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
          Куда вы идёте
        </h1>
        {goals.goal_12m_text && (
          <p className="text-sm text-on-surface italic max-w-2xl">«{goals.goal_12m_text}»</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Current */}
        <Card>
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-3">
            Сейчас (выручка)
          </p>
          <p className="text-2xl font-mono font-bold text-on-surface leading-tight">
            {formatMoney(goals.current_revenue_year)}
          </p>
          <p className="text-xs font-mono text-on-surface-variant mt-1.5">
            {formatMoney(goals.current_revenue_month)} / мес
          </p>
        </Card>

        <HeroGoalCard
          label="Цель · 12 месяцев"
          horizon="12 мес"
          year={goals.goal_12m_revenue_year}
          month={goals.goal_12m_revenue_month}
        />
        <HeroGoalCard
          label="Цель · 3 года"
          horizon="3 года"
          year={goals.goal_3y_revenue_year}
          month={goals.goal_3y_revenue_month}
        />
      </div>

      {/* Realism badge */}
      <div className={`flex flex-wrap items-center gap-3 rounded-2xl border ${r.border} ${r.bg} px-4 py-3`}>
        <span className={`material-symbols-outlined text-xl ${r.text}`} aria-hidden>
          {r.icon}
        </span>
        <div>
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
            Реалистичность цели
          </p>
          <p className={`text-sm font-bold ${r.text}`}>{r.label}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Оценка</p>
          <p className={`text-lg font-mono font-bold ${r.text}`}>
            {pointB.realism.level === 'unknown' ? DASH : `${pointB.realism.score}/100`}
          </p>
        </div>
      </div>
    </motion.section>
  )
}

// ─── A→B comparison ───────────────────────────────────────────────────────────

function ComparisonRow({
  label,
  current,
  target,
}: {
  label: string
  current: string
  target: string
}) {
  return (
    <Card>
      <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-3">{label}</p>
      <div className="flex items-baseline gap-3">
        <span className="text-base font-mono text-on-surface-variant line-through">{current}</span>
        <span className="material-symbols-outlined text-primary/60 text-base" aria-hidden>
          arrow_forward
        </span>
        <span className="text-2xl font-mono font-bold text-primary">{target}</span>
      </div>
    </Card>
  )
}

function cap(s: string): string {
  if (!s) return DASH
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function Comparison({ pointB }: { pointB: PointBV2 }) {
  const blocks = Object.entries(pointB.target_blocks)
  return (
    <Section eyebrow="A → B" title="Сравнение текущего и целевого состояния" icon="compare_arrows">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ComparisonRow
          label="Общий балл (GRI)"
          current={DASH}
          target={formatScore(pointB.target_overall_score)}
        />
        <ComparisonRow
          label="Health Index"
          current={DASH}
          target={formatScore(pointB.target_health_index)}
        />
        <ComparisonRow label="Стадия" current={DASH} target={cap(pointB.target_stage)} />
      </div>

      {blocks.length > 0 && (
        <div className="space-y-3">
          {blocks.map(([key, b]) => {
            const sev = severityStyle(b.priority)
            const pct = Math.round((b.current / Math.max(b.target, 1)) * 100)
            return (
              <Card key={key}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-bold text-on-surface">{blockLabel(key)}</p>
                  <div className="flex items-center gap-2">
                    <Pill className={`${sev.text} ${sev.border} ${sev.bg}`}>{sev.label}</Pill>
                    <span className="text-[10px] font-mono text-on-surface-variant">{b.effort}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs font-mono text-on-surface-variant w-10 text-right">{b.current}</span>
                  <div className="flex-1 h-2 bg-surface-container-high rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-primary-fixed-dim transition-all duration-700"
                      style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-primary w-10">{b.target}</span>
                  <span className="text-xs font-mono text-primary/80 w-12 text-right">+{b.gap}</span>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ─── GAP analysis ─────────────────────────────────────────────────────────────

const GAP_META: Record<GapEntry['horizon'], { title: string; sub: string }> = {
  '12m': { title: 'Горизонт 12 месяцев', sub: 'Цель на год' },
  '3y': { title: 'Горизонт 3 года', sub: 'Стратегическая цель' },
}

function GapMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.04] py-2 last:border-0">
      <span className="text-xs text-on-surface-variant">{label}</span>
      <span className="text-sm font-mono font-bold text-on-surface">{value}</span>
    </div>
  )
}

function GapAnalysis({ gap }: { gap: GapEntry[] }) {
  return (
    <Section
      eyebrow="GAP-анализ"
      title="Разрыв между текущим и целевым"
      icon="trending_up"
      description="Что нужно, чтобы дойти от текущей выручки до цели на каждом горизонте."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {gap.map((g) => {
          const meta = GAP_META[g.horizon]
          return (
            <Card key={g.horizon}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest">{meta.sub}</p>
                  <h3 className="font-headline text-base font-bold text-on-surface">{meta.title}</h3>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Цель</p>
                  <p className="text-sm font-mono font-bold text-primary">{formatMoney(g.target_revenue)}</p>
                </div>
              </div>

              {!g.data_complete ? (
                <div className="flex items-center gap-2 rounded-xl bg-amber-400/[0.06] border border-amber-400/20 px-3 py-2.5">
                  <span className="material-symbols-outlined text-base text-amber-400" aria-hidden>
                    info
                  </span>
                  <span className="text-xs text-on-surface-variant">
                    Недостаточно данных для расчёта разрыва на этом горизонте.
                  </span>
                </div>
              ) : (
                <div>
                  <GapMetric label="Абсолютный разрыв" value={formatMoney(g.gap_absolute)} />
                  <GapMetric label="Относительный прирост" value={formatPercent(g.gap_percent)} />
                  <GapMetric label="Мультипликатор" value={formatMultiplier(g.multiplier)} />
                  <GapMetric label="Требуемый CAGR" value={formatPercent(g.required_cagr)} />
                  <GapMetric label="Рост в месяц (MoM)" value={formatPercent(g.required_mom_growth)} />
                  <GapMetric label="Рост в квартал (QoQ)" value={formatPercent(g.required_qoq_growth)} />
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </Section>
  )
}

// ─── Realism detail ───────────────────────────────────────────────────────────

function ReasonList({ icon, title, items, accent }: { icon: string; title: string; items: string[]; accent: string }) {
  if (!items.length) return null
  return (
    <div>
      <p className={`text-[10px] font-mono uppercase tracking-widest mb-2 ${accent}`}>{title}</p>
      <ul className="space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-on-surface">
            <span className={`material-symbols-outlined text-base mt-0.5 flex-shrink-0 ${accent}`} aria-hidden>
              {icon}
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RealismDetail({ pointB }: { pointB: PointBV2 }) {
  const r = realismStyle(pointB.realism.level)
  const { realism } = pointB
  return (
    <Section eyebrow="Реалистичность" title="Оценка достижимости цели" icon="balance">
      <Card>
        <div className={`flex flex-wrap items-center gap-4 mb-5 pb-5 border-b border-white/[0.06]`}>
          <span className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl ${r.bg} ${r.text}`}>
            <span className="material-symbols-outlined text-2xl" aria-hidden>
              {r.icon}
            </span>
          </span>
          <div>
            <p className={`text-lg font-bold ${r.text}`}>{r.label}</p>
            <p className="text-xs font-mono text-on-surface-variant">
              Оценка: {realism.level === 'unknown' ? DASH : `${realism.score}/100`}
            </p>
          </div>
        </div>

        <div className="space-y-5">
          <ReasonList icon="lightbulb" title="Обоснование" items={realism.rationale} accent="text-primary/80" />
          <ReasonList icon="report" title="Факторы риска" items={realism.risk_factors} accent="text-error/80" />
          {realism.weak_blocks.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-amber-400/80 uppercase tracking-widest mb-2">
                Слабые блоки
              </p>
              <div className="flex flex-wrap gap-1.5">
                {realism.weak_blocks.map((b) => (
                  <span
                    key={b}
                    className="text-xs font-mono bg-amber-400/[0.08] text-amber-400 border border-amber-400/20 px-2.5 py-1 rounded-lg"
                  >
                    {blockLabel(b)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>
    </Section>
  )
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

const SCENARIO_ICON: Record<Scenario['key'], string> = {
  cautious: 'shield',
  base: 'flag',
  aggressive: 'bolt',
}

function Scenarios({ scenarios }: { scenarios: Scenario[] }) {
  return (
    <Section eyebrow="Сценарии" title="Три сценария роста" icon="alt_route">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {scenarios.map((s) => {
          const isBase = s.key === 'base'
          const conf = CONFIDENCE_LABEL[s.confidence] ?? CONFIDENCE_LABEL.low
          return (
            <Card key={s.key} className={isBase ? '!border-primary/30 ring-1 ring-primary/10' : ''}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className={`material-symbols-outlined text-lg ${isBase ? 'text-primary' : 'text-on-surface-variant'}`} aria-hidden>
                    {SCENARIO_ICON[s.key]}
                  </span>
                  <p className={`text-sm font-bold ${isBase ? 'text-primary' : 'text-on-surface'}`}>{s.label}</p>
                </div>
              </div>

              <div className="space-y-3 mb-4">
                <div>
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">
                    Выручка · 12 мес
                  </p>
                  <p className="text-lg font-mono font-bold text-on-surface">{formatMoney(s.target_revenue_12m)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">
                    Выручка · 3 года
                  </p>
                  <p className="text-lg font-mono font-bold text-on-surface">{formatMoney(s.target_revenue_3y)}</p>
                </div>
              </div>

              {s.assumptions.length > 0 && (
                <ul className="space-y-1.5 mb-4">
                  {s.assumptions.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-on-surface-variant">
                      <span className="material-symbols-outlined text-primary/40 text-sm mt-0.5 flex-shrink-0" aria-hidden>
                        chevron_right
                      </span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 ${conf.bg}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${conf.text.replace('text-', 'bg-')}`} />
                <span className={`text-[10px] font-mono uppercase tracking-widest ${conf.text}`}>{conf.label}</span>
              </div>
            </Card>
          )
        })}
      </div>
    </Section>
  )
}

// ─── Trajectory ───────────────────────────────────────────────────────────────

function Trajectory({ pointB }: { pointB: PointBV2 }) {
  return (
    <Section
      eyebrow="Траектория"
      title="Финансовая траектория"
      icon="show_chart"
      description="Помесячная динамика к цели на 12 месяцев и поквартальная — на 3 года."
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-4">12 месяцев · по месяцам</p>
          <TrajectoryChart
            points={pointB.trajectory.monthly_12m}
            unitLabel="Месяц"
            emptyText="Недостаточно данных для построения траектории на 12 месяцев."
          />
        </Card>
        <Card>
          <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-4">3 года · по кварталам</p>
          <TrajectoryChart
            points={pointB.trajectory.quarterly_3y}
            unitLabel="Квартал"
            emptyText="Недостаточно данных для построения траектории на 3 года."
          />
        </Card>
      </div>
    </Section>
  )
}

// ─── Levers ───────────────────────────────────────────────────────────────────

function LeverCard({ lever }: { lever: Lever }) {
  const diff = DIFFICULTY_LABEL[lever.difficulty] ?? DIFFICULTY_LABEL.medium

  if (!lever.data_available) {
    return (
      <Card className="opacity-80">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-on-surface">{lever.label}</p>
          <span className="text-[10px] font-mono text-on-surface-variant bg-white/[0.04] px-2 py-0.5 rounded">
            {blockLabel(lever.linked_block)}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white/[0.03] border border-dashed border-white/[0.08] px-3 py-2.5">
          <span className="material-symbols-outlined text-base text-on-surface-variant/60" aria-hidden>
            add_circle
          </span>
          <span className="text-xs text-on-surface-variant">Нет данных — добавьте в анкете</span>
        </div>
      </Card>
    )
  }

  return (
    <Card hover>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-bold text-on-surface">{lever.label}</p>
        <span className="text-[10px] font-mono text-on-surface-variant bg-white/[0.04] px-2 py-0.5 rounded">
          {blockLabel(lever.linked_block)}
        </span>
      </div>

      <div className="flex items-baseline gap-2.5 mb-3">
        <span className="text-base font-mono text-on-surface-variant">{formatNum(lever.current, lever.unit)}</span>
        <span className="material-symbols-outlined text-sm text-primary/60" aria-hidden>
          arrow_forward
        </span>
        <span className="text-lg font-mono font-bold text-primary">{formatNum(lever.target, lever.unit)}</span>
      </div>

      <p className="text-xs text-on-surface-variant mb-3">{lever.expected_effect}</p>

      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className={diff.text}>{diff.label}</span>
        <span className="text-on-surface-variant">Приоритет {lever.priority}</span>
      </div>
    </Card>
  )
}

function Levers({ levers }: { levers: Lever[] }) {
  const sorted = [...levers].sort((a, b) => a.priority - b.priority)
  return (
    <Section
      eyebrow="Рычаги роста"
      title="Точки приложения усилий"
      icon="tune"
      description="Конкретные метрики, влияющие на выручку. Заполните анкету, чтобы раскрыть недостающие."
    >
      {sorted.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((l) => (
            <LeverCard key={l.key} lever={l} />
          ))}
        </div>
      ) : (
        <EmptyState icon="tune" text="Рычаги роста пока не определены." />
      )}
    </Section>
  )
}

// ─── TOP-5 limits ─────────────────────────────────────────────────────────────

function Top5Limits({ limits }: { limits: PointBV2['top5_limits'] }) {
  return (
    <Section eyebrow="Ограничения" title="ТОП-5 ограничений роста" icon="block">
      {limits.length ? (
        <div className="space-y-2.5">
          {limits.map((l) => {
            const sev = severityStyle(l.severity)
            return (
              <div
                key={`${l.rank}-${l.title}`}
                className="flex items-center gap-4 bg-surface-container-low rounded-2xl border border-white/[0.06] shadow-card px-4 py-3.5"
              >
                <span
                  className={`flex items-center justify-center w-8 h-8 rounded-xl font-mono font-bold text-sm flex-shrink-0 ${sev.bg} ${sev.text}`}
                >
                  {l.rank}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-on-surface truncate">{l.title}</p>
                  {l.block && (
                    <p className="text-[10px] font-mono text-on-surface-variant mt-0.5">{blockLabel(l.block)}</p>
                  )}
                </div>
                <Pill className={`${sev.text} ${sev.border} ${sev.bg} flex-shrink-0`}>{sev.label}</Pill>
              </div>
            )
          })}
        </div>
      ) : (
        <EmptyState icon="check_circle" text="Критичных ограничений роста не выявлено." />
      )}
    </Section>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function PointBView({
  pointB,
  loading = false,
  error = null,
  reason = null,
  onRecalculate,
}: PointBViewProps) {
  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorPanel error={error} onRecalculate={onRecalculate} />
  if (reason === 'no_diagnostic' || pointB === null) return <NoDiagnostic />

  const insufficient = pointB.data_sufficiency.sufficient === false

  return (
    <div className="space-y-12">
      {/* Optional refresh control */}
      {onRecalculate && (
        <div className="flex justify-end -mb-6">
          <button
            onClick={onRecalculate}
            className="inline-flex items-center gap-1.5 text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] hover:border-primary/30 rounded-lg px-3 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label="Пересчитать Точку Б"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden>
              refresh
            </span>
            Пересчитать
          </button>
        </div>
      )}

      {insufficient && (
        <InsufficientPanel
          missing={pointB.data_sufficiency.missing}
          confidence={pointB.data_sufficiency.confidence}
        />
      )}

      <Hero pointB={pointB} />
      <Comparison pointB={pointB} />
      <GapAnalysis gap={pointB.gap} />
      <RealismDetail pointB={pointB} />
      <Trajectory pointB={pointB} />
      <Scenarios scenarios={pointB.scenarios} />
      <Levers levers={pointB.levers} />

      <Section eyebrow="План действий" title="Горизонты планирования" icon="route">
        <HorizonPlans horizons={pointB.horizons} />
      </Section>

      <Top5Limits limits={pointB.top5_limits} />

      <Section eyebrow="AI" title="AI-стратегия" icon="smart_toy">
        <AiStrategy status={pointB.ai_status} strategy={pointB.ai_strategy} />
      </Section>
    </div>
  )
}
