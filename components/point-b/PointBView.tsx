'use client'

import { useState, useEffect, useMemo, useRef, useId } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { getClientLocale, type Locale } from '@/lib/i18n/locale'
import type { PointBV2, GapEntry, Scenario, Lever, GrowthDecomposition, GrowthStep } from '@/lib/point-b/engine'
import { buildTrajectory, computeGap } from '@/lib/point-b/engine'
import useMetricDrillDown from '@/components/dashboard/useMetricDrillDown'
import {
  Section,
  Card,
  Pill,
  EmptyState,
  Expandable,
  Chevron,
  ProgressBar,
  FormulaLine,
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
import { GoalForm, GoalsQuickInput, type GoalPatch } from './GoalEditor'
import dynamic from 'next/dynamic'
import { HorizonPlans } from './HorizonPlans'
import { ActionPlanBoard } from '@/components/action-plan/ActionPlanBoard'
import { AiStrategy } from './AiStrategy'

// recharts lives inside TrajectoryChart — load it lazily so it stays out of the
// large Point B page's first-load JS.
const TrajectoryChart = dynamic(() => import('./TrajectoryChart').then((m) => m.TrajectoryChart), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse bg-surface-container-low rounded-xl" />,
})

/**
 * Where the "go fix your data" links point. PointBView renders inside three
 * different shells (/point-b, /client/point-b, экспертная вкладка) and the
 * canonical route differs — so the shell tells it, instead of hardcoding
 * /client/point-a and dropping the user out of the sidebar.
 */
export interface PointBRoutes {
  pointA?: string
  survey?: string
  gri?: string
}

const DEFAULT_ROUTES: Required<PointBRoutes> = {
  pointA: '/point-a',
  survey: '/client/onboarding',
  gri: '/gri?tab=result',
}

export interface PointBViewProps {
  pointB: PointBV2 | null
  loading?: boolean
  error?: string | null
  reason?: string | null
  onRecalculate?: () => void
  /** Kick off (or retry) the async AI strategy generation + polling. */
  onGenerate?: () => void
  /** Live AI generation status, driven by the container's poller. */
  aiStatus?: PointBV2['ai_status']
  /** Error from the last generate attempt (kickoff rejected / poll timed out). */
  aiError?: string | null
  /** Save current annual revenue (when missing) directly from this page. */
  onSaveCurrentRevenue?: (year: number) => Promise<void>
  /**
   * Save the revenue goals (PATCH /api/v1/companies/targets). When absent the
   * goal cards stay read-only — that's what keeps the эксперт's view safe: the
   * targets route writes to the SESSION user's company, so an expert editing a
   * client's card would overwrite his own goals.
   */
  onSaveGoals?: (patch: GoalPatch) => Promise<void>
  /** Whose Action Plan to load (omit = current user; staff passes the client id). */
  actionPlanUserId?: string
  /** Latest approved expert correction of this plan (shown to the client). */
  expertNote?: { expert_notes: string; author_name?: string | null; created_at?: string } | null
  /** Shell-specific hrefs; defaults keep the user inside the dashboard shell. */
  routes?: PointBRoutes
}

// ─── Localized AI-section copy (portal locale; ru is the default surface) ─────
// Only the AI-strategy section + its generate/processing/failed button states
// follow the portal locale in this phase; the rest of the page stays Russian.
const AI_T: Record<Locale, {
  generateAria: string
  updateAria: string
  generating: string
  update: string
  generate: string
  eyebrow: string
  sectionTitle: string
  processingTitle: string
  processingSub: string
  failedTitle: string
  failedSub: string
  retry: string
}> = {
  ru: {
    generateAria: 'Сформировать план',
    updateAria: 'Обновить план',
    generating: 'Формируем план…',
    update: 'Обновить план',
    generate: 'Сформировать план',
    eyebrow: 'AI',
    sectionTitle: 'AI-стратегия',
    processingTitle: 'AI формирует стратегию…',
    processingSub: 'Claude строит мост между Точкой А и Точкой Б — это займёт до 2 минут.',
    failedTitle: 'Не удалось сгенерировать AI-стратегию',
    failedSub: 'Попробуйте сформировать план ещё раз.',
    retry: 'Повторить',
  },
  en: {
    generateAria: 'Generate plan',
    updateAria: 'Update plan',
    generating: 'Generating plan…',
    update: 'Update plan',
    generate: 'Generate plan',
    eyebrow: 'AI',
    sectionTitle: 'AI strategy',
    processingTitle: 'AI is building the strategy…',
    processingSub: 'Claude is bridging Point A and Point B — this takes up to 2 minutes.',
    failedTitle: 'Could not generate the AI strategy',
    failedSub: 'Try generating the plan again.',
    retry: 'Retry',
  },
}

// ─── Small shared bits ────────────────────────────────────────────────────────

/** Ghost link used inside empty states / раскрытия. */
function InlineLink({ href, icon, children }: { href: string; icon?: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:text-primary/80 border border-primary/20 hover:border-primary/40 rounded-lg px-3 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      {icon && (
        <span className="material-symbols-outlined text-sm" aria-hidden>
          {icon}
        </span>
      )}
      {children}
    </Link>
  )
}

/** Label + value line inside a раскрытие. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.04] py-1.5 last:border-0">
      <span className="text-xs text-on-surface-variant">{label}</span>
      <span className="text-xs font-mono text-on-surface text-right break-words">{value}</span>
    </div>
  )
}

// ─── State: loading skeleton ──────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div
      className="space-y-10 animate-pulse"
      role="status"
      aria-busy="true"
      aria-label="Загрузка Точки Б"
    >
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
          type="button"
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

function NoDiagnostic({ pointAHref }: { pointAHref: string }) {
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
        href={pointAHref}
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

function RevenueQuickInput({
  initial,
  onSave,
  onDone,
}: {
  initial?: number | null
  onSave: (year: number) => Promise<void>
  onDone?: () => void
}) {
  const uid = useId()
  const [val, setVal] = useState(initial != null ? String(Math.round(initial)) : '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const n = Number(val.replace(/\s/g, '').replace(/,/g, '.').replace(/[^\d.]/g, ''))
    if (!Number.isFinite(n) || n <= 0) {
      setErr('Введите положительное число')
      return
    }
    setErr(null)
    setSaving(true)
    try {
      await onSave(n)
      onDone?.()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl bg-surface-container/60 border border-primary/20 p-3.5">
      <label htmlFor={`${uid}-rev`} className="block text-[10px] font-mono text-primary/80 uppercase tracking-widest mb-2">
        Текущая годовая выручка, ₸
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`${uid}-rev`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          aria-invalid={!!err || undefined}
          aria-describedby={err ? `${uid}-err` : undefined}
          placeholder="120000000"
          className="flex-1 min-w-[180px] bg-surface-container-high border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-mono text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50"
        />
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary text-sm px-4 py-2 rounded-lg transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className={`material-symbols-outlined text-base ${saving ? 'animate-spin' : ''}`} aria-hidden>
            {saving ? 'progress_activity' : 'save'}
          </span>
          {saving ? 'Сохранение…' : 'Сохранить и пересчитать'}
        </button>
      </div>
      {err && (
        <p id={`${uid}-err`} role="alert" className="text-xs text-error mt-2">
          {err}
        </p>
      )}
    </form>
  )
}

const InsufficientPanel = ({
  missing,
  have,
  confidence,
  goals,
  onSaveCurrentRevenue,
  onSaveGoals,
  surveyHref,
  panelRef,
  hintId,
}: {
  missing: string[]
  have: string[]
  confidence: number
  goals: PointBV2['goals']
  onSaveCurrentRevenue?: (year: number) => Promise<void>
  onSaveGoals?: (patch: GoalPatch) => Promise<void>
  surveyHref: string
  panelRef?: React.Ref<HTMLDivElement>
  hintId?: string
}) => {
  // Раньше здесь был один регексп /выруч/i — он матчил и «Текущая выручка», и
  // «Целевая выручка», поэтому пользователю без целей показывали форму текущей
  // выручки, которая ничего не чинила. Теперь проверки разделены.
  const needsCurrent = missing.some((m) => /текущая выруч/i.test(m))
  const needsGoals = missing.some((m) => /целевая выруч/i.test(m))

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.05] p-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
    >
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-2xl text-amber-400 flex-shrink-0" aria-hidden>
          warning
        </span>
        <div className="space-y-3 flex-1">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">
              Недостаточно данных для точного плана
            </h2>
            <p id={hintId} className="text-sm text-on-surface-variant mt-1">
              Уверенность расчёта: <span className="font-mono text-amber-400">{Math.round(confidence)}%</span>.
              Часть показателей ниже отмечена как «{DASH}» — мы не подставляем выдуманные цифры.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            {have.length > 0 && (
              <div>
                <p className="text-[10px] font-mono text-primary/80 uppercase tracking-widest mb-2">
                  Что уже есть
                </p>
                <ul className="space-y-1.5">
                  {have.map((h, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-on-surface-variant">
                      <span className="material-symbols-outlined text-primary/70 text-base mt-0.5 flex-shrink-0" aria-hidden>
                        check
                      </span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {needsCurrent && onSaveCurrentRevenue && <RevenueQuickInput onSave={onSaveCurrentRevenue} />}

          {needsGoals && onSaveGoals && (
            <GoalsQuickInput
              initial12m={goals.goal_12m_revenue_year}
              initial3y={goals.goal_3y_revenue_year}
              onSave={onSaveGoals}
            />
          )}

          <div className="rounded-xl bg-surface-container/60 border border-white/[0.06] p-3.5">
            <p className="text-xs text-on-surface-variant">
              Как добавить: откройте{' '}
              <Link href={surveyHref} className="text-primary hover:underline font-medium">
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

/**
 * Карточка цели. Раньше это была `<Card hover>` — подсвечивалась под курсором и
 * ничего не делала. Теперь это раскрытие: точная сумма, разрыв с текущей
 * выручкой и (если экран умеет сохранять) форма редактирования цели.
 */
function HeroGoalCard({
  label,
  horizon,
  horizonKey,
  year,
  month,
  gap,
  onSaveGoals,
  surveyHref,
}: {
  label: string
  horizon: string
  horizonKey: '12m' | '3y'
  year: number | null
  month: number | null
  gap?: GapEntry
  onSaveGoals?: (patch: GoalPatch) => Promise<void>
  surveyHref: string
}) {
  const [editing, setEditing] = useState(false)
  const months = horizonKey === '12m' ? 12 : 36

  return (
    <Card hover className="!p-0 overflow-hidden">
      <Expandable
        ariaLabel={`${label}: ${year != null ? formatMoneyFull(year) : 'цель не задана'}. Раскрыть разбор цели`}
        triggerClassName="!rounded-none p-5"
        panelClassName="px-5 pb-5 space-y-4"
        summary={(open) => (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest">{label}</p>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-on-surface-variant">{horizon}</span>
                <Chevron open={open} className="text-on-surface-variant" />
              </div>
            </div>
            {year != null ? (
              <>
                <p className="text-2xl font-mono font-bold text-primary leading-tight">{formatMoney(year)}</p>
                <p className="text-xs font-mono text-on-surface-variant mt-1.5">{formatMoney(month)} / мес</p>
              </>
            ) : (
              <>
                <p className="text-2xl font-mono font-bold text-on-surface-variant/50 leading-tight">{DASH}</p>
                <p className="text-xs text-amber-400 mt-1.5">
                  Цель не задана{onSaveGoals ? ' — нажмите, чтобы указать' : ''}
                </p>
              </>
            )}
          </>
        )}
      >
        <div className="pt-4 border-t border-white/[0.06] space-y-4">
          {year != null && (
            <div>
              <DetailRow label="Точная сумма (год)" value={formatMoneyFull(year)} />
              <DetailRow label="В месяц" value={formatMoneyFull(month)} />
              {gap?.data_complete ? (
                <>
                  <DetailRow label="Текущая выручка (год)" value={formatMoneyFull(gap.current_revenue)} />
                  <DetailRow label="Разрыв" value={formatMoneyFull(gap.gap_absolute)} />
                  <DetailRow label="Во сколько раз вырасти" value={formatMultiplier(gap.multiplier)} />
                  <DetailRow label="Требуемый рост в месяц" value={formatPercent(gap.required_mom_growth)} />
                </>
              ) : (
                <DetailRow
                  label="Разрыв с текущей выручкой"
                  value="не рассчитан — нет текущей выручки"
                />
              )}
            </div>
          )}

          <p className="text-xs text-on-surface-variant leading-relaxed">
            Цель берётся из настроек цели Точки А (companies.target_revenue), а если там пусто — из
            анкеты. Горизонт — {months} мес. Это ваша заявленная цель, портал её не придумывает.
          </p>

          {onSaveGoals ? (
            editing ? (
              <GoalForm
                horizon={horizonKey}
                initialYear={year}
                onSave={async (patch) => {
                  await onSaveGoals(patch)
                  setEditing(false)
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:text-primary/80 border border-primary/20 hover:border-primary/40 rounded-lg px-3 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden>
                  edit
                </span>
                {year != null ? 'Изменить цель' : 'Указать цель'}
              </button>
            )
          ) : (
            <InlineLink href={surveyHref} icon="edit_note">
              Изменить цель в анкете
            </InlineLink>
          )}
        </div>
      </Expandable>
    </Card>
  )
}

function CurrentRevenueCard({
  goals,
  onOpenDrillDown,
  onSaveCurrentRevenue,
}: {
  goals: PointBV2['goals']
  onOpenDrillDown?: () => void
  onSaveCurrentRevenue?: (year: number) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const value = goals.current_revenue_year

  return (
    <Card className="!p-0 overflow-hidden">
      <Expandable
        ariaLabel={`Сейчас, выручка: ${value != null ? formatMoneyFull(value) : 'нет данных'}. Раскрыть разбор`}
        triggerClassName="!rounded-none p-5"
        panelClassName="px-5 pb-5"
        summary={(open) => (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
                Сейчас (выручка)
              </p>
              <Chevron open={open} className="text-on-surface-variant" />
            </div>
            <p className="text-2xl font-mono font-bold text-on-surface leading-tight">
              {formatMoney(value)}
            </p>
            <p className="text-xs font-mono text-on-surface-variant mt-1.5">
              {formatMoney(goals.current_revenue_month)} / мес
            </p>
          </>
        )}
      >
        <div className="pt-4 border-t border-white/[0.06] space-y-3">
          {value != null ? (
            <div>
              <DetailRow label="Точная сумма (год)" value={formatMoneyFull(value)} />
              <DetailRow label="В месяц" value={formatMoneyFull(goals.current_revenue_month)} />
            </div>
          ) : (
            <p className="text-xs text-amber-400">
              Текущая выручка не найдена ни в анкете, ни в метриках — без неё разрыв и траектория не
              считаются.
            </p>
          )}
          <p className="text-xs text-on-surface-variant leading-relaxed">
            Источник: годовая выручка из анкеты (блок «Финансы»), а если её там нет — метрика
            «Выручка» из слоя метрик. Месячное значение — это годовое ÷ 12, а не отдельный замер.
          </p>
          <div className="flex flex-wrap gap-2">
            {onOpenDrillDown && (
              <button
                type="button"
                onClick={onOpenDrillDown}
                className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:text-primary/80 border border-primary/20 hover:border-primary/40 rounded-lg px-3 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden>
                  query_stats
                </span>
                Разбор метрики
              </button>
            )}
            {onSaveCurrentRevenue && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] hover:border-primary/30 rounded-lg px-3 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden>
                  edit
                </span>
                Изменить
              </button>
            )}
          </div>
          {onSaveCurrentRevenue && editing && (
            <RevenueQuickInput
              initial={value}
              onSave={onSaveCurrentRevenue}
              onDone={() => setEditing(false)}
            />
          )}
        </div>
      </Expandable>
    </Card>
  )
}

function Hero({
  pointB,
  onSaveGoals,
  onSaveCurrentRevenue,
  onOpenRevenueDrillDown,
  surveyHref,
}: {
  pointB: PointBV2
  onSaveGoals?: (patch: GoalPatch) => Promise<void>
  onSaveCurrentRevenue?: (year: number) => Promise<void>
  onOpenRevenueDrillDown?: () => void
  surveyHref: string
}) {
  const r = realismStyle(pointB.realism.level)
  const { goals, realism } = pointB
  const gap12 = pointB.gap.find((g) => g.horizon === '12m')
  const gap3y = pointB.gap.find((g) => g.horizon === '3y')

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
        {goals.goal_3y_text && goals.goal_3y_text !== goals.goal_12m_text && (
          <p className="text-sm text-on-surface-variant italic max-w-2xl">
            Через 3 года: «{goals.goal_3y_text}»
          </p>
        )}
      </div>

      <div data-tour="pb-goals" className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CurrentRevenueCard
          goals={goals}
          onOpenDrillDown={onOpenRevenueDrillDown}
          onSaveCurrentRevenue={onSaveCurrentRevenue}
        />

        <HeroGoalCard
          label="Цель · 12 месяцев"
          horizon="12 мес"
          horizonKey="12m"
          year={goals.goal_12m_revenue_year}
          month={goals.goal_12m_revenue_month}
          gap={gap12}
          onSaveGoals={onSaveGoals}
          surveyHref={surveyHref}
        />
        <HeroGoalCard
          label="Цель · 3 года"
          horizon="3 года"
          horizonKey="3y"
          year={goals.goal_3y_revenue_year}
          month={goals.goal_3y_revenue_month}
          gap={gap3y}
          onSaveGoals={onSaveGoals}
          surveyHref={surveyHref}
        />
      </div>

      {/* Realism badge — теперь раскрывается (раньше «Оценка 62/100» ни к чему не вела) */}
      <div data-tour="pb-realism" className={`rounded-2xl border ${r.border} ${r.bg} overflow-hidden`}>
        <Expandable
          ariaLabel="Раскрыть, как посчитана реалистичность цели"
          triggerClassName="!rounded-none px-4 py-3"
          panelClassName="px-4 pb-4"
          summary={(open) => (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`material-symbols-outlined text-xl ${r.text}`} aria-hidden>
                  {r.icon}
                </span>
                <div className="text-left">
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
                    Реалистичность цели
                  </p>
                  <p className={`text-sm font-bold ${r.text}`}>{r.label}</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
                    Оценка
                  </p>
                  <p className={`text-lg font-mono font-bold ${r.text}`}>
                    {realism.level === 'unknown' ? DASH : `${realism.score}/100`}
                  </p>
                </div>
                <Chevron open={open} className="text-on-surface-variant" />
              </div>
              {/* One-line "почему" — never show a bare verdict without the reason (DG-3) */}
              {realism.headline && (
                <p className="mt-2 pt-2 border-t border-white/[0.06] text-xs text-on-surface-variant leading-relaxed text-left">
                  {realism.headline}
                </p>
              )}
            </>
          )}
        >
          <div className="pt-3 border-t border-white/[0.06] space-y-3">
            {realism.level === 'unknown' ? (
              <p className="text-xs text-on-surface-variant">
                Оценка не считается: нужны текущая выручка и цель на 3 года.
              </p>
            ) : (
              <>
                <FormulaLine
                  title="Как получена оценка"
                  formula="уровень по требуемому CAGR на 3 года: ≤20% реалистично · ≤50% амбициозно · ≤100% агрессивно · >100% нереалистично"
                  substitution={
                    gap3y?.required_cagr != null
                      ? `требуемый CAGR = ${formatPercent(gap3y.required_cagr)} → «${r.label}»`
                      : undefined
                  }
                  result={`${realism.score}/100${
                    realism.weak_blocks.length ? `  (−5 за каждый слабый блок, их ${realism.weak_blocks.length})` : ''
                  }`}
                />
                {realism.rationale.length > 0 && (
                  <ul className="space-y-1.5">
                    {realism.rationale.slice(0, 3).map((t, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-on-surface">
                        <span className="material-symbols-outlined text-primary/70 text-sm mt-0.5 flex-shrink-0" aria-hidden>
                          lightbulb
                        </span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <a
              href="#pb-realism-detail"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:text-primary/80 border border-primary/20 hover:border-primary/40 rounded-lg px-3 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className="material-symbols-outlined text-sm" aria-hidden>
                south
              </span>
              Полный разбор реалистичности
            </a>
          </div>
        </Expandable>
      </div>
    </motion.section>
  )
}

// ─── A→B comparison ───────────────────────────────────────────────────────────

/**
 * Раньше здесь стояло `current={DASH}` — подпись «текущее», а под ней всегда
 * прочерк. Текущий балл GRI/Health в PointBV2 не приходит, поэтому вместо
 * фальшивого сравнения даём честную ссылку туда, где балл реально есть.
 */
function ComparisonRow({
  label,
  target,
  currentHref,
}: {
  label: string
  target: string
  currentHref: string
}) {
  return (
    <Card>
      <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-3">{label}</p>
      <div className="flex flex-wrap items-baseline gap-3">
        <Link
          href={currentHref}
          className="text-xs font-mono text-on-surface-variant hover:text-primary underline decoration-dotted underline-offset-4 focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
          aria-label={`Текущее значение «${label}» смотреть в Точке А`}
        >
          текущее — в Точке А
        </Link>
        <span className="material-symbols-outlined text-primary/60 text-base" aria-hidden>
          arrow_forward
        </span>
        <span className="text-2xl font-mono font-bold text-primary">{target}</span>
      </div>
    </Card>
  )
}

function BlockCompareCard({
  blockKey,
  block,
  griHref,
}: {
  blockKey: string
  block: PointBV2['target_blocks'][string]
  griHref: string
}) {
  const sev = severityStyle(block.priority)
  const pct = Math.round((block.current / Math.max(block.target, 1)) * 100)

  return (
    <Card className="!p-0 overflow-hidden">
      <Expandable
        ariaLabel={`Блок ${blockLabel(blockKey)}: ${block.current} из ${block.target}. Раскрыть разбор`}
        triggerClassName="!rounded-none p-5"
        panelClassName="px-5 pb-5"
        summary={(open) => (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-on-surface">{blockLabel(blockKey)}</p>
              <div className="flex items-center gap-2">
                <Pill className={`${sev.text} ${sev.border} ${sev.bg}`}>{sev.label}</Pill>
                <span className="text-[10px] font-mono text-on-surface-variant">{block.effort}</span>
                <Chevron open={open} className="text-on-surface-variant" />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs font-mono text-on-surface-variant w-10 text-right">{block.current}</span>
              <ProgressBar
                value={block.current}
                max={block.target}
                label={`${blockLabel(blockKey)}: текущий балл ${block.current} из целевого ${block.target}`}
                className="flex-1"
              />
              <span className="text-xs font-mono text-primary w-10">{block.target}</span>
              <span className="text-xs font-mono text-primary/80 w-12 text-right">+{block.gap}</span>
            </div>
          </>
        )}
      >
        <div className="pt-4 border-t border-white/[0.06] space-y-3">
          <div>
            <DetailRow label="Текущий балл (Точка А)" value={`${block.current}/100`} />
            <DetailRow label="Целевой балл" value={`${block.target}/100`} />
            <DetailRow label="Разрыв" value={`+${block.gap} балла`} />
            <DetailRow label="Приоритет" value={`${sev.label} (разрыв ${block.gap})`} />
            <DetailRow label="Оценка срока" value={block.effort} />
            <DetailRow label="Заполнено к цели" value={`${Math.max(0, Math.min(100, pct))}%`} />
          </div>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            Целевой балл — это текущий плюс реалистичный прирост для вашей стадии бизнеса (чем ниже
            балл и моложе компания, тем больше шаг). Приоритет и срок выводятся из размера разрыва:
            ≥30 — критично / 6–12 месяцев, ≥20 — высокий / 3–6 месяцев, ≥10 — средний / 1–3 месяца.
          </p>
          <InlineLink href={griHref} icon="radar">
            Разбор блока в GRI
          </InlineLink>
        </div>
      </Expandable>
    </Card>
  )
}

function Comparison({ pointB, routes }: { pointB: PointBV2; routes: Required<PointBRoutes> }) {
  const blocks = Object.entries(pointB.target_blocks)
  return (
    <Section eyebrow="A → B" title="Сравнение текущего и целевого состояния" icon="compare_arrows">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ComparisonRow
          label="Общий балл (GRI)"
          target={formatScore(pointB.target_overall_score)}
          currentHref={routes.pointA}
        />
        <ComparisonRow
          label="Health Index"
          target={formatScore(pointB.target_health_index)}
          currentHref={routes.pointA}
        />
      </div>

      {blocks.length > 0 && (
        <div className="space-y-3">
          {blocks.map(([key, b]) => (
            <BlockCompareCard key={key} blockKey={key} block={b} griHref={routes.gri} />
          ))}
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

/** Одна строка GAP — теперь раскрывается формулой с подставленными числами. */
function GapMetric({
  label,
  value,
  formula,
  substitution,
}: {
  label: string
  value: string
  formula: string
  substitution: string
}) {
  return (
    <Expandable
      ariaLabel={`${label}: ${value}. Показать формулу`}
      className="border-b border-white/[0.04] last:border-0"
      triggerClassName="!rounded-none py-2"
      panelClassName="pb-3"
      summary={(open) => (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-on-surface-variant flex items-center gap-1">
            {label}
            <Chevron open={open} className="!text-sm text-on-surface-variant/60" />
          </span>
          <span className="text-sm font-mono font-bold text-on-surface">{value}</span>
        </div>
      )}
    >
      <FormulaLine formula={formula} substitution={substitution} result={value} />
    </Expandable>
  )
}

function GapCard({ g, onFixGoal }: { g: GapEntry; onFixGoal?: () => void }) {
  const meta = GAP_META[g.horizon]
  const cur = g.current_revenue
  const tgt = g.target_revenue
  const years = g.months / 12
  const quarters = g.months / 3
  const curS = formatMoneyFull(cur)
  const tgtS = formatMoneyFull(tgt)
  const multS = formatMultiplier(g.multiplier)

  return (
    <Card>
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest">{meta.sub}</p>
          <h3 className="font-headline text-base font-bold text-on-surface">{meta.title}</h3>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Цель</p>
          <p className="text-sm font-mono font-bold text-primary" title={tgtS}>
            {formatMoney(tgt)}
          </p>
        </div>
      </div>

      {!g.data_complete ? (
        <div className="rounded-xl bg-amber-400/[0.06] border border-amber-400/20 px-3 py-3 space-y-2.5">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-base text-amber-400 flex-shrink-0" aria-hidden>
              info
            </span>
            <span className="text-xs text-on-surface-variant">
              Разрыв не рассчитан: {cur == null && tgt == null
                ? 'нет ни текущей выручки, ни цели на этом горизонте'
                : cur == null
                  ? 'нет текущей выручки'
                  : 'на этом горизонте не задана цель'}
              .
            </span>
          </div>
          {onFixGoal && (
            <button
              type="button"
              onClick={onFixGoal}
              className="inline-flex items-center gap-1.5 text-xs font-mono text-amber-400 hover:text-amber-300 border border-amber-400/30 rounded-lg px-3 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-amber-400/40"
            >
              <span className="material-symbols-outlined text-sm" aria-hidden>
                edit
              </span>
              Что нужно заполнить
            </button>
          )}
        </div>
      ) : (
        <div>
          <GapMetric
            label="Абсолютный разрыв"
            value={formatMoney(g.gap_absolute)}
            formula="цель − текущая выручка"
            substitution={`${tgtS} − ${curS}`}
          />
          <GapMetric
            label="Относительный прирост"
            value={formatPercent(g.gap_percent)}
            formula="(цель − текущая) ÷ текущая × 100%"
            substitution={`(${tgtS} − ${curS}) ÷ ${curS} × 100%`}
          />
          <GapMetric
            label="Мультипликатор"
            value={formatMultiplier(g.multiplier)}
            formula="цель ÷ текущая выручка"
            substitution={`${tgtS} ÷ ${curS}`}
          />
          <GapMetric
            label="Требуемый CAGR"
            value={formatPercent(g.required_cagr)}
            formula="(мультипликатор ^ (1 ÷ число лет) − 1) × 100%"
            substitution={`(${multS} ^ (1 ÷ ${years.toLocaleString('ru-RU')}) − 1) × 100%`}
          />
          <GapMetric
            label="Рост в месяц (MoM)"
            value={formatPercent(g.required_mom_growth)}
            formula="(мультипликатор ^ (1 ÷ число месяцев) − 1) × 100%"
            substitution={`(${multS} ^ (1 ÷ ${g.months}) − 1) × 100%`}
          />
          <GapMetric
            label="Рост в квартал (QoQ)"
            value={formatPercent(g.required_qoq_growth)}
            formula="(мультипликатор ^ (1 ÷ число кварталов) − 1) × 100%"
            substitution={`(${multS} ^ (1 ÷ ${quarters}) − 1) × 100%`}
          />
        </div>
      )}
    </Card>
  )
}

function GapAnalysis({ gap, onFixGoal }: { gap: GapEntry[]; onFixGoal?: () => void }) {
  return (
    <Section
      eyebrow="GAP-анализ"
      title="Разрыв между текущим и целевым"
      icon="trending_up"
      description="Что нужно, чтобы дойти от текущей выручки до цели на каждом горизонте. Нажмите на строку — покажем формулу с вашими числами."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {gap.map((g) => (
          <GapCard key={g.horizon} g={g} onFixGoal={onFixGoal} />
        ))}
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

function RealismDetail({ pointB, routes }: { pointB: PointBV2; routes: Required<PointBRoutes> }) {
  const r = realismStyle(pointB.realism.level)
  const { realism, goals } = pointB
  return (
    <div id="pb-realism-detail" className="scroll-mt-24">
      <Section eyebrow="Реалистичность" title="Оценка достижимости цели" icon="balance">
        <Card>
          <div className="flex flex-wrap items-center gap-4 mb-5 pb-5 border-b border-white/[0.06]">
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
            {goals.growth_blockers.length > 0 && (
              <ReasonList
                icon="block"
                title="Что вы сами назвали блокерами роста (анкета)"
                items={goals.growth_blockers}
                accent="text-amber-400/80"
              />
            )}
            {goals.main_pain && (
              <div>
                <p className="text-[10px] font-mono text-error/80 uppercase tracking-widest mb-2">
                  Главная боль (анкета)
                </p>
                <p className="text-sm text-on-surface">{goals.main_pain}</p>
              </div>
            )}
            {realism.weak_blocks.length > 0 && (
              <div>
                <p className="text-[10px] font-mono text-amber-400/80 uppercase tracking-widest mb-2">
                  Слабые блоки
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {realism.weak_blocks.map((b) => (
                    <Link
                      key={b}
                      href={routes.pointA}
                      aria-label={`Блок «${blockLabel(b)}» — открыть разбор в Точке А`}
                      className="text-xs font-mono bg-amber-400/[0.08] text-amber-400 border border-amber-400/20 hover:bg-amber-400/[0.14] hover:border-amber-400/40 px-2.5 py-1 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                    >
                      {blockLabel(b)}
                      <span className="material-symbols-outlined text-[12px] align-middle ml-1" aria-hidden>
                        north_east
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      </Section>
    </div>
  )
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

const SCENARIO_ICON: Record<Scenario['key'], string> = {
  cautious: 'shield',
  base: 'flag',
  aggressive: 'bolt',
}

const SCENARIO_HOW: Record<Scenario['key'], string> = {
  cautious:
    'Осторожный — это часть пути от текущей выручки до заявленной цели: движок берёт 60% разрыва. Не «другая цель», а проверка, что будет при более спокойном темпе.',
  base: 'Базовый — ровно та цель, которую вы заявили. Все остальные цифры на экране считаются от неё.',
  aggressive:
    'Агрессивный — заявленная цель плюс запас: движок берёт 130% разрыва. Нужен, чтобы увидеть цену «сверхплана».',
}

function ScenarioCard({
  s,
  base,
  currentRevenue,
  selected,
  onSelect,
}: {
  s: Scenario
  base: Scenario | undefined
  currentRevenue: number | null
  selected: boolean
  onSelect: () => void
}) {
  const conf = CONFIDENCE_LABEL[s.confidence] ?? CONFIDENCE_LABEL.low
  const [showDetail, setShowDetail] = useState(false)

  // Всё считаем из уже пришедших чисел — тем же чистым computeGap, что и движок.
  const gap12 = useMemo(
    () => computeGap(currentRevenue, s.target_revenue_12m, 12),
    [currentRevenue, s.target_revenue_12m],
  )
  const shareOfGoal =
    base?.target_revenue_12m != null && base.target_revenue_12m > 0 && s.target_revenue_12m != null
      ? (s.target_revenue_12m / base.target_revenue_12m) * 100
      : null

  return (
    <div
      className={`bg-surface-container-low rounded-2xl border shadow-card transition-colors ${
        selected ? 'border-primary/40 ring-1 ring-primary/20' : 'border-white/[0.06] hover:border-primary/20'
      }`}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        aria-label={`Сценарий «${s.label}»: выручка за 12 месяцев ${formatMoneyFull(s.target_revenue_12m)}. Показать на графике траектории`}
        className="w-full text-left p-5 pb-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span
              className={`material-symbols-outlined text-lg ${selected ? 'text-primary' : 'text-on-surface-variant'}`}
              aria-hidden
            >
              {SCENARIO_ICON[s.key]}
            </span>
            <p className={`text-sm font-bold ${selected ? 'text-primary' : 'text-on-surface'}`}>{s.label}</p>
          </div>
          <span
            className={`material-symbols-outlined text-lg ${selected ? 'text-primary' : 'text-on-surface-variant/40'}`}
            aria-hidden
          >
            {selected ? 'radio_button_checked' : 'radio_button_unchecked'}
          </span>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">
              Выручка · 12 мес
            </p>
            <p className="text-lg font-mono font-bold text-on-surface" title={formatMoneyFull(s.target_revenue_12m)}>
              {formatMoney(s.target_revenue_12m)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">
              Выручка · 3 года
            </p>
            <p className="text-lg font-mono font-bold text-on-surface" title={formatMoneyFull(s.target_revenue_3y)}>
              {formatMoney(s.target_revenue_3y)}
            </p>
          </div>
        </div>
      </button>

      <div className="px-5 pb-5">
        <div className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 mb-3 ${conf.bg}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${conf.text.replace('text-', 'bg-')}`} />
          <span className={`text-[10px] font-mono uppercase tracking-widest ${conf.text}`}>{conf.label}</span>
        </div>

        <Expandable
          open={showDetail}
          onOpenChange={setShowDetail}
          ariaLabel={`Что означает сценарий «${s.label}»`}
          triggerClassName="!rounded-lg"
          panelClassName="pt-3 space-y-3"
          summary={(open) => (
            <span className="inline-flex items-center gap-1 text-xs font-mono text-on-surface-variant hover:text-primary">
              Что это значит
              <Chevron open={open} className="!text-sm" />
            </span>
          )}
        >
          <p className="text-xs text-on-surface-variant leading-relaxed">{SCENARIO_HOW[s.key]}</p>

          <div>
            <DetailRow label="Выручка за 12 мес" value={formatMoneyFull(s.target_revenue_12m)} />
            <DetailRow label="Выручка на 3-й год" value={formatMoneyFull(s.target_revenue_3y)} />
            {shareOfGoal != null && (
              <DetailRow
                label="Доля от заявленной цели"
                value={`${shareOfGoal.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}%`}
              />
            )}
            {gap12.data_complete ? (
              <>
                <DetailRow label="Мультипликатор к текущей" value={formatMultiplier(gap12.multiplier)} />
                <DetailRow label="Нужен рост в месяц" value={formatPercent(gap12.required_mom_growth)} />
              </>
            ) : (
              <DetailRow label="Мультипликатор к текущей" value="не рассчитан — нет текущей выручки или цели" />
            )}
          </div>

          {s.assumptions.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-1.5">
                Допущения сценария
              </p>
              <ul className="space-y-1.5">
                {s.assumptions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-on-surface-variant">
                    <span className="material-symbols-outlined text-primary/40 text-sm mt-0.5 flex-shrink-0" aria-hidden>
                      chevron_right
                    </span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-on-surface-variant/70 leading-relaxed">
            «{conf.label}» — это уверенность в данных, а не вероятность успеха: она высокая только
            когда известны и текущая выручка, и цель.
          </p>
        </Expandable>
      </div>
    </div>
  )
}

function Scenarios({
  scenarios,
  currentRevenue,
  selectedKey,
  onSelect,
}: {
  scenarios: Scenario[]
  currentRevenue: number | null
  selectedKey: Scenario['key']
  onSelect: (k: Scenario['key']) => void
}) {
  const base = scenarios.find((s) => s.key === 'base')
  return (
    <Section
      eyebrow="Сценарии"
      title="Три сценария роста"
      icon="alt_route"
      description="Выберите сценарий — график траектории ниже перестроится под него."
    >
      <div role="radiogroup" aria-label="Сценарий роста" className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {scenarios.map((s) => (
          <ScenarioCard
            key={s.key}
            s={s}
            base={base}
            currentRevenue={currentRevenue}
            selected={selectedKey === s.key}
            onSelect={() => onSelect(s.key)}
          />
        ))}
      </div>
    </Section>
  )
}

// ─── Trajectory ───────────────────────────────────────────────────────────────

function Trajectory({
  pointB,
  scenario,
  surveyHref,
}: {
  pointB: PointBV2
  scenario: Scenario | undefined
  surveyHref: string
}) {
  const current = pointB.goals.current_revenue_year
  const isBase = scenario == null || scenario.key === 'base'

  // Базовый сценарий = ровно то, что посчитал движок. Остальные пересчитываем
  // той же чистой функцией buildTrajectory, никаких своих формул.
  const monthly = useMemo(() => {
    if (isBase) return pointB.trajectory.monthly_12m
    return buildTrajectory(current, scenario?.target_revenue_12m ?? null, 12)
  }, [isBase, pointB.trajectory.monthly_12m, current, scenario?.target_revenue_12m])

  const quarterly = useMemo(() => {
    if (isBase) return pointB.trajectory.quarterly_3y
    return buildTrajectory(current, scenario?.target_revenue_3y ?? null, 36)
      .filter((p) => p.month % 3 === 0)
      .map((p) => ({ month: p.month / 3, target_revenue: p.target_revenue }))
  }, [isBase, pointB.trajectory.quarterly_3y, current, scenario?.target_revenue_3y])

  const emptyAction = <InlineLink href={surveyHref} icon="edit_note">Заполнить анкету</InlineLink>

  return (
    <Section
      eyebrow="Траектория"
      title="Финансовая траектория"
      icon="show_chart"
      description="Помесячная динамика к цели на 12 месяцев и поквартальная — на 3 года. Равномерный темп роста от текущей выручки к цели выбранного сценария."
    >
      <p className="text-xs font-mono text-on-surface-variant" aria-live="polite">
        Сценарий: <span className="text-primary">{scenario?.label ?? 'Базовый'}</span>
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-4">12 месяцев · по месяцам</p>
          {monthly.length ? (
            <TrajectoryChart points={monthly} unitLabel="Месяц" emptyText="" />
          ) : (
            <EmptyState
              icon="show_chart"
              text="Недостаточно данных для построения траектории на 12 месяцев."
              hint="Нужны текущая выручка и цель на 12 месяцев."
              action={emptyAction}
            />
          )}
        </Card>
        <Card>
          <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-4">3 года · по кварталам</p>
          {quarterly.length ? (
            <TrajectoryChart points={quarterly} unitLabel="Квартал" emptyText="" />
          ) : (
            <EmptyState
              icon="show_chart"
              text="Недостаточно данных для построения траектории на 3 года."
              hint="Нужны текущая выручка и цель на 3 года."
              action={emptyAction}
            />
          )}
        </Card>
      </div>
    </Section>
  )
}

// ─── Levers ───────────────────────────────────────────────────────────────────

/** Как движок получает целевое значение рычага — честно, без придумывания. */
const LEVER_HOW: Record<string, string> = {
  leads:
    'Текущее значение лидов в анкете не собирается, поэтому цифр здесь нет. Рычаг остаётся в списке как обязательная часть формулы выручки.',
  conversion:
    'Конверсия из лида в сделку в анкете не собирается — значений нет. Подключите CRM или добавьте показатель в метрики.',
  avg_check:
    'Текущее — средний чек из анкеты. Цель — ваш собственный целевой средний чек оттуда же. Портал ничего не досчитывает.',
  repeat:
    'Доля повторных продаж и удержание в анкете не собираются — значений нет.',
  cac:
    'Текущее — CAC из анкеты. Цель — ориентир движка: текущий CAC минус 20%. Это не ваш план, а точка отсчёта.',
  margin:
    'Текущее — маржинальность из анкеты. Цель — ориентир движка: текущая маржа плюс 8 п.п., но не выше 60%.',
}

function LeverCard({ lever, surveyHref, griHref }: { lever: Lever; surveyHref: string; griHref: string }) {
  const diff = DIFFICULTY_LABEL[lever.difficulty] ?? DIFFICULTY_LABEL.medium
  const how = LEVER_HOW[lever.key]

  if (!lever.data_available) {
    return (
      <Card className="opacity-90">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-on-surface">{lever.label}</p>
          <span className="text-[10px] font-mono text-on-surface-variant bg-white/[0.04] px-2 py-0.5 rounded">
            {blockLabel(lever.linked_block)}
          </span>
        </div>
        <Link
          href={surveyHref}
          aria-label={`Добавить данные для рычага «${lever.label}» в анкете`}
          className="flex items-center gap-2 rounded-xl bg-white/[0.03] hover:bg-primary/[0.06] border border-dashed border-white/[0.08] hover:border-primary/30 px-3 py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className="material-symbols-outlined text-base text-on-surface-variant/60" aria-hidden>
            add_circle
          </span>
          <span className="text-xs text-on-surface-variant">Нет данных — добавить в анкете</span>
        </Link>
        {how && <p className="text-[11px] text-on-surface-variant/70 mt-2.5 leading-relaxed">{how}</p>}
      </Card>
    )
  }

  return (
    <Card hover className="!p-0 overflow-hidden">
      <Expandable
        ariaLabel={`Рычаг «${lever.label}»: ${formatNum(lever.current, lever.unit)} → ${formatNum(lever.target, lever.unit)}. Раскрыть разбор`}
        triggerClassName="!rounded-none p-5"
        panelClassName="px-5 pb-5"
        summary={(open) => (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-on-surface">{lever.label}</p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-on-surface-variant bg-white/[0.04] px-2 py-0.5 rounded">
                  {blockLabel(lever.linked_block)}
                </span>
                <Chevron open={open} className="text-on-surface-variant" />
              </div>
            </div>

            <div className="flex items-baseline gap-2.5 mb-3">
              <span className="text-base font-mono text-on-surface-variant">
                {formatNum(lever.current, lever.unit)}
              </span>
              <span className="material-symbols-outlined text-sm text-primary/60" aria-hidden>
                arrow_forward
              </span>
              <span className="text-lg font-mono font-bold text-primary">
                {formatNum(lever.target, lever.unit)}
              </span>
            </div>

            <p className="text-xs text-on-surface-variant mb-3 text-left">{lever.expected_effect}</p>

            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className={diff.text}>{diff.label}</span>
              <span className="text-on-surface-variant">Приоритет {lever.priority}</span>
            </div>
          </>
        )}
      >
        <div className="pt-4 border-t border-white/[0.06] space-y-3">
          <div>
            <DetailRow label="Текущее" value={formatNum(lever.current, lever.unit)} />
            <DetailRow label="Целевое" value={formatNum(lever.target, lever.unit)} />
            <DetailRow label="Блок" value={blockLabel(lever.linked_block)} />
            <DetailRow label="Сложность" value={diff.label} />
            <DetailRow label="Приоритет" value={`${lever.priority} из 6`} />
          </div>
          {how && <p className="text-xs text-on-surface-variant leading-relaxed">{how}</p>}
          <div className="flex flex-wrap gap-2">
            <InlineLink href={surveyHref} icon="edit_note">
              Обновить в анкете
            </InlineLink>
            <InlineLink href={griHref} icon="radar">
              Блок «{blockLabel(lever.linked_block)}» в GRI
            </InlineLink>
          </div>
        </div>
      </Expandable>
    </Card>
  )
}

function Levers({ levers, surveyHref, griHref }: { levers: Lever[]; surveyHref: string; griHref: string }) {
  const sorted = [...levers].sort((a, b) => a.priority - b.priority)
  return (
    <Section
      eyebrow="Рычаги роста"
      title="Точки приложения усилий"
      icon="tune"
      description="Конкретные метрики, влияющие на выручку. Нажмите на рычаг — покажем, откуда взято текущее и целевое значение."
    >
      {sorted.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((l) => (
            <LeverCard key={l.key} lever={l} surveyHref={surveyHref} griHref={griHref} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon="tune"
          text="Рычаги роста пока не определены."
          hint="Они строятся из показателей анкеты: средний чек, CAC, маржинальность."
          action={
            <InlineLink href={surveyHref} icon="edit_note">
              Заполнить анкету
            </InlineLink>
          }
        />
      )}
    </Section>
  )
}

// ─── TOP-5 limits ─────────────────────────────────────────────────────────────

function LimitRow({
  limit,
  total,
  griHref,
  pointAHref,
}: {
  limit: PointBV2['top5_limits'][number]
  total: number
  griHref: string
  pointAHref: string
}) {
  const sev = severityStyle(limit.severity)
  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.06] shadow-card overflow-hidden">
      <Expandable
        ariaLabel={`Ограничение №${limit.rank}: ${limit.title}. Раскрыть объяснение`}
        triggerClassName="!rounded-none px-4 py-3.5"
        panelClassName="px-4 pb-4"
        summary={(open) => (
          <div className="flex items-center gap-4">
            <span
              className={`flex items-center justify-center w-8 h-8 rounded-xl font-mono font-bold text-sm flex-shrink-0 ${sev.bg} ${sev.text}`}
            >
              {limit.rank}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-on-surface truncate">{limit.title}</p>
              {limit.block && (
                <p className="text-[10px] font-mono text-on-surface-variant mt-0.5">{blockLabel(limit.block)}</p>
              )}
            </div>
            <Pill className={`${sev.text} ${sev.border} ${sev.bg} flex-shrink-0`}>{sev.label}</Pill>
            <Chevron open={open} className="text-on-surface-variant flex-shrink-0" />
          </div>
        )}
      >
        <div className="pt-3 border-t border-white/[0.06] space-y-3">
          <div>
            <DetailRow label="Место в списке" value={`${limit.rank} из ${total}`} />
            <DetailRow label="Критичность" value={sev.label} />
            {limit.block && <DetailRow label="Блок" value={blockLabel(limit.block)} />}
          </div>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            Список берётся из ТОП-5 ограничений вашей GRI-диагностики. Если GRI ещё не пройден,
            движок подставляет самые слабые блоки Точки А — тогда формулировка выглядит как «Слабый
            блок: …». Порядок — это порядок работы: №1 тормозит рост сильнее всего.
          </p>
          <div className="flex flex-wrap gap-2">
            <InlineLink href={griHref} icon="radar">
              Разбор в GRI
            </InlineLink>
            <InlineLink href={pointAHref} icon="my_location">
              Блок в Точке А
            </InlineLink>
          </div>
        </div>
      </Expandable>
    </div>
  )
}

function Top5Limits({
  limits,
  griHref,
  pointAHref,
}: {
  limits: PointBV2['top5_limits']
  griHref: string
  pointAHref: string
}) {
  return (
    <Section
      eyebrow="Ограничения"
      title="ТОП-5 ограничений роста"
      icon="block"
      description="Что мешает дойти до цели. Нажмите на строку — объясним, откуда она взялась."
    >
      {limits.length ? (
        <div className="space-y-2.5">
          {limits.map((l) => (
            <LimitRow
              key={`${l.rank}-${l.title}`}
              limit={l}
              total={limits.length}
              griHref={griHref}
              pointAHref={pointAHref}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon="check_circle"
          text="Критичных ограничений роста не выявлено."
          hint="Список строится из GRI-диагностики. Если вы её не проходили — проверьте."
          action={
            <InlineLink href={griHref} icon="radar">
              Открыть GRI
            </InlineLink>
          }
        />
      )}
    </Section>
  )
}

// ─── How to achieve the goal (growth decomposition) ───────────────────────────

const STEP_HOW: Record<string, string> = {
  leads: 'Больше заявок при той же конверсии — прямой множитель выручки.',
  conversion: 'Та же воронка, больше закрытых сделок — множитель без роста бюджета на привлечение.',
  avg_check: 'Больше денег с той же сделки — множитель без новых клиентов.',
  repeat: 'Каждый клиент покупает чаще — множитель без нового трафика.',
}

function StepCard({ s, uplift }: { s: GrowthStep; uplift: number | null }) {
  return (
    <div className="rounded-xl bg-surface-container-low border border-white/[0.06] overflow-hidden">
      <Expandable
        ariaLabel={`Шаг «${s.label}». Раскрыть разбор`}
        triggerClassName="!rounded-none p-4"
        panelClassName="px-4 pb-4"
        summary={(open) => (
          <>
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <p className="text-sm font-semibold text-on-surface">{s.label}</p>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {s.uplift_pct != null && (
                  <span className="text-xs font-mono font-bold text-primary">+{formatPercent(s.uplift_pct)}</span>
                )}
                <Chevron open={open} className="text-on-surface-variant" />
              </div>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed text-left">{s.note}</p>
            {s.current != null && s.target != null && (
              <p className="text-xs font-mono text-on-surface-variant mt-2 text-left">
                {formatNum(s.current, s.unit)}
                <span className="text-primary/60 mx-1.5">→</span>
                <span className="text-primary font-bold">{formatNum(s.target, s.unit)}</span>
              </p>
            )}
          </>
        )}
      >
        <div className="pt-3 border-t border-white/[0.06] space-y-2.5">
          {s.current != null && <DetailRow label="Текущее" value={formatNum(s.current, s.unit)} />}
          {s.target != null && <DetailRow label="Целевое" value={formatNum(s.target, s.unit)} />}
          {s.current == null && s.target == null && (
            <p className="text-xs text-amber-400">
              Текущего значения по этому рычагу в анкете нет — показан только требуемый прирост.
            </p>
          )}
          <p className="text-xs text-on-surface-variant leading-relaxed">
            {STEP_HOW[s.key] ?? 'Один из четырёх множителей выручки.'}
            {uplift != null && ` Требуемые +${uplift}% — это ${' '}равная доля общего роста, разложенная на четыре рычага.`}
          </p>
        </div>
      </Expandable>
    </div>
  )
}

function HowToAchieve({
  d,
  onFixGoal,
  hasGoal,
}: {
  d: GrowthDecomposition
  onFixGoal?: () => void
  hasGoal: boolean
}) {
  return (
    <Section eyebrow="Как достичь" title="Как достичь цель за 12 месяцев" icon="trending_up">
      <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-5 space-y-4">
        <p className="text-sm text-on-surface leading-relaxed">{d.summary}</p>

        {d.required_multiplier != null && (
          <FormulaLine
            title="Откуда берётся прирост на каждый рычаг"
            formula="Выручка ≈ Лиды × Конверсия × Средний чек × Повторные  ⇒  прирост на рычаг = мультипликатор ^ (1 ÷ 4) − 1"
            substitution={`${formatMultiplier(d.required_multiplier)} ^ (1 ÷ 4) − 1`}
            result={
              d.required_uplift_per_lever_pct != null
                ? `+${formatPercent(d.required_uplift_per_lever_pct)} на каждый из четырёх рычагов`
                : undefined
            }
          />
        )}

        {d.steps.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {d.steps.map((s) => (
              <StepCard key={s.key} s={s} uplift={d.required_uplift_per_lever_pct} />
            ))}
          </div>
        ) : (
          onFixGoal && (
            <button
              type="button"
              onClick={onFixGoal}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary border border-primary/30 hover:bg-primary/10 rounded-xl px-4 py-2 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className="material-symbols-outlined text-base" aria-hidden>
                edit
              </span>
              {hasGoal ? 'Указать текущую выручку' : 'Указать цель на 12 месяцев'}
            </button>
          )
        )}
      </div>
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
  onGenerate,
  aiStatus,
  aiError = null,
  onSaveCurrentRevenue,
  onSaveGoals,
  actionPlanUserId,
  expertNote,
  routes,
}: PointBViewProps) {
  // Locale read after mount (cookie isn't available during SSR); default ru.
  // Only the AI-strategy section follows it in this phase.
  const [aiLocale, setAiLocale] = useState<Locale>('ru')
  useEffect(() => {
    setAiLocale(getClientLocale())
  }, [])
  const ai = AI_T[aiLocale]

  const r: Required<PointBRoutes> = { ...DEFAULT_ROUTES, ...(routes ?? {}) }

  // Selected growth scenario — drives the trajectory charts below.
  const [scenarioKey, setScenarioKey] = useState<Scenario['key']>('base')

  // «Чего не хватает» — цель для скролла с CTA и из пустых GAP-карточек.
  const missingRef = useRef<HTMLDivElement>(null)
  const focusMissing = () => {
    missingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    missingRef.current?.focus({ preventScroll: true })
  }

  // Разбор метрики выручки переиспользует общий модал drill-down. Включаем его
  // только когда экран показывает СВОИ данные: у эксперта actionPlanUserId —
  // чужой id, а модал всегда грузит метрику текущей сессии.
  const selfView = actionPlanUserId == null
  const drill = useMetricDrillDown()

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorPanel error={error} onRecalculate={onRecalculate} />
  if (reason === 'no_diagnostic' || pointB === null) return <NoDiagnostic pointAHref={r.pointA} />

  const insufficient = pointB.data_sufficiency.sufficient === false
  // Live status preferred over the snapshot baked into pointB by the GET route.
  const liveAiStatus = aiStatus ?? pointB.ai_status
  const generating = liveAiStatus === 'processing'
  const hasPlan = liveAiStatus === 'completed' && pointB.ai_strategy != null
  const selectedScenario = pointB.scenarios.find((s) => s.key === scenarioKey)
  const hasGoal =
    pointB.goals.goal_12m_revenue_year != null || pointB.goals.goal_3y_revenue_year != null

  const generatedAt = (() => {
    const d = new Date(pointB.generated_at)
    return Number.isNaN(d.getTime())
      ? null
      : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  })()

  const openRevenueDrillDown =
    selfView && pointB.goals.current_revenue_year != null
      ? () =>
          drill.open({
            metricId: 'biz.finansy.vyruchka_god',
            metricLabel: 'Выручка (год)',
            unit: '₸',
            liveValue: { value: pointB.goals.current_revenue_year },
          })
      : undefined

  return (
    <div className="space-y-12">
      {/* Plan controls: primary generate CTA + subtle recalculate. */}
      <div className="flex flex-wrap justify-end items-center gap-2 -mb-6">
        {generatedAt && (
          <span className="text-[10px] font-mono text-on-surface-variant/70 mr-auto">
            Рассчитано в {generatedAt}
          </span>
        )}
        {onGenerate && (
          <button
            type="button"
            onClick={insufficient ? focusMissing : onGenerate}
            disabled={generating}
            aria-describedby={insufficient ? 'pb-missing-hint' : undefined}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-on-primary bg-gradient-to-r from-primary to-primary-fixed-dim hover:opacity-90 rounded-xl px-4 py-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label={
              insufficient
                ? 'Показать, каких данных не хватает для плана'
                : hasPlan
                  ? ai.updateAria
                  : ai.generateAria
            }
          >
            <span
              className={`material-symbols-outlined text-base ${generating ? 'animate-spin' : ''}`}
              aria-hidden
            >
              {generating ? 'progress_activity' : insufficient ? 'help' : 'auto_awesome'}
            </span>
            {generating
              ? ai.generating
              : insufficient
                ? 'Чего не хватает для плана'
                : hasPlan
                  ? ai.update
                  : ai.generate}
          </button>
        )}
        {onRecalculate && (
          <button
            type="button"
            onClick={onRecalculate}
            className="inline-flex items-center gap-1.5 text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] hover:border-primary/30 rounded-lg px-3 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label="Пересчитать Точку Б"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden>
              refresh
            </span>
            Пересчитать
          </button>
        )}
      </div>

      {insufficient && (
        <InsufficientPanel
          panelRef={missingRef}
          hintId="pb-missing-hint"
          missing={pointB.data_sufficiency.missing}
          have={pointB.data_sufficiency.have}
          confidence={pointB.data_sufficiency.confidence}
          goals={pointB.goals}
          onSaveCurrentRevenue={onSaveCurrentRevenue}
          onSaveGoals={onSaveGoals}
          surveyHref={r.survey}
        />
      )}

      <Hero
        pointB={pointB}
        onSaveGoals={onSaveGoals}
        onSaveCurrentRevenue={onSaveCurrentRevenue}
        onOpenRevenueDrillDown={openRevenueDrillDown}
        surveyHref={r.survey}
      />

      {expertNote?.expert_notes && (
        <div className="rounded-2xl border border-secondary/30 bg-secondary/[0.06] p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-secondary text-lg" aria-hidden>verified</span>
            <p className="text-[10px] font-mono text-secondary uppercase tracking-widest">
              Экспертная корректировка{expertNote.author_name ? ` · ${expertNote.author_name}` : ''}
            </p>
          </div>
          <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">{expertNote.expert_notes}</p>
          {expertNote.created_at && (
            <p className="text-[10px] font-mono text-on-surface-variant/70 mt-2">
              {new Date(expertNote.created_at).toLocaleDateString('ru-RU')}
            </p>
          )}
        </div>
      )}

      <Comparison pointB={pointB} routes={r} />
      <GapAnalysis gap={pointB.gap} onFixGoal={insufficient ? focusMissing : undefined} />
      <HowToAchieve
        d={pointB.growth_decomposition}
        onFixGoal={insufficient ? focusMissing : undefined}
        hasGoal={hasGoal}
      />
      <RealismDetail pointB={pointB} routes={r} />
      <Scenarios
        scenarios={pointB.scenarios}
        currentRevenue={pointB.goals.current_revenue_year}
        selectedKey={scenarioKey}
        onSelect={setScenarioKey}
      />
      <Trajectory pointB={pointB} scenario={selectedScenario} surveyHref={r.survey} />
      <Levers levers={pointB.levers} surveyHref={r.survey} griHref={r.gri} />

      <Section eyebrow="План действий" title="Горизонты планирования" icon="route">
        <HorizonPlans horizons={pointB.horizons} surveyHref={r.survey} />
      </Section>

      <Section eyebrow="Карта роста" title="План действий (90 дней)" icon="checklist">
        <ActionPlanBoard userId={actionPlanUserId} />
      </Section>

      <Top5Limits limits={pointB.top5_limits} griHref={r.gri} pointAHref={r.pointA} />

      <Section eyebrow={ai.eyebrow} title={ai.sectionTitle} icon="smart_toy">
        {generating ? (
          <div className="rounded-2xl border border-violet-500/15 bg-violet-500/[0.05] p-6" role="status" aria-live="polite">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-violet-500/20 flex items-center justify-center animate-pulse">
                <span className="material-symbols-outlined text-sm text-violet-400" aria-hidden>
                  smart_toy
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-violet-300">{ai.processingTitle}</p>
                <p className="text-xs text-on-surface-variant">
                  {ai.processingSub}
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2" aria-hidden>
              <div className="h-3 bg-violet-500/10 rounded-full animate-pulse" />
              <div className="h-3 bg-violet-500/10 rounded-full animate-pulse w-3/4" />
              <div className="h-3 bg-violet-500/10 rounded-full animate-pulse w-1/2" />
            </div>
          </div>
        ) : liveAiStatus === 'failed' || aiError ? (
          <div className="rounded-2xl border border-error/20 bg-error/[0.04] p-6 text-center" role="alert">
            <span className="material-symbols-outlined text-3xl text-error/60 mb-2 block" aria-hidden>
              error
            </span>
            <p className="text-sm font-medium text-on-surface mb-1">
              {ai.failedTitle}
            </p>
            <p className="text-xs text-on-surface-variant mb-4">{aiError || ai.failedSub}</p>
            {onGenerate && (
              <button
                type="button"
                onClick={insufficient ? focusMissing : onGenerate}
                className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:text-primary/80 border border-primary/20 rounded-lg px-3 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden>
                  refresh
                </span>
                {insufficient ? 'Чего не хватает' : ai.retry}
              </button>
            )}
          </div>
        ) : (
          // AiStrategy renders the plan (or its own honest «нет плана» panel), but
          // it takes no callbacks — the CTA lives here, next to it, so the empty
          // state is not a dead end. Only shown while there is nothing to read.
          <>
            <AiStrategy status={liveAiStatus} strategy={pointB.ai_strategy} />
            {!hasPlan && onGenerate && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={insufficient ? focusMissing : onGenerate}
                  aria-describedby={insufficient ? 'pb-missing-hint' : undefined}
                  aria-label={insufficient ? 'Показать, каких данных не хватает для плана' : ai.generateAria}
                  className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:text-primary/80 border border-primary/20 rounded-lg px-3 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <span className="material-symbols-outlined text-sm" aria-hidden>
                    {insufficient ? 'help' : 'auto_awesome'}
                  </span>
                  {insufficient ? 'Чего не хватает для плана' : ai.generate}
                </button>
              </div>
            )}
          </>
        )}
      </Section>

      {drill.modal}
    </div>
  )
}
