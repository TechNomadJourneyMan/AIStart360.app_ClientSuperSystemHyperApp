'use client'

/**
 * «Точка А» on the dashboard (plan 2026-10-22, W1): the important Point A v4
 * data where the owner lands — score with confidence and completeness, the
 * key metrics, «Требует внимания» (top 3 with actions), risks / quick wins /
 * strengths and ONE goals block (revenue in 12 months and in 3 years),
 * editable in place. A goal saved here goes through /api/v1/goals, which
 * mirrors it into the questionnaire (lib/goals/survey-sync.ts) — the survey,
 * the dashboard, Point A and Point B show the same goals.
 *
 * Replaces the v1 <ExecutiveOverview/> on the dashboard («Оценка по пяти
 * блокам», «Ключевые риски 0» while Point A v4 had risks).
 *
 *   <PointADashboardSummary/>      — container (usePointAState + goal saving)
 *   <PointADashboardSummaryView/>  — stateless-ish view (only the goal editor
 *                                    keeps local input state), rendered in tests.
 */
import Link from 'next/link'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { usePointAState, POINT_A_STATE_KEY } from '@/hooks/usePointAState'
import { GOALS_QUERY_KEY } from '@/hooks/useGoals'
import { ScoreGauge } from '@/components/point-a/ExecutiveOverview'
import { formatRelativeRuLong } from '@/components/point-a/executive-overview-model'
import { KeyMetricTile } from '@/components/point-a-v4/KeyMetricsStrip'
import { BTN_GHOST, BTN_PRIMARY, CARD, CHIP, ConfidenceBar, Icon, SectionTitle, fmtValue } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import {
  POINT_A_HREF,
  POINT_B_HREF,
  buildDashboardSummary,
  parseGoalAmount,
  revenueGoalDraft,
  type DashboardSummaryModel,
  type RevenueGoalRow,
  type RevenuePeriod,
} from './point-a-summary-model'

export type SaveRevenueGoal = (period: RevenuePeriod, annual: number) => Promise<void>

const STATUS_TONE: Record<string, string> = {
  achieved: 'bg-primary/10 text-primary',
  on_track: 'bg-primary/10 text-primary',
  at_risk: 'bg-amber-300/10 text-amber-200',
  behind: 'bg-red-300/10 text-red-200',
  overdue: 'bg-red-300/10 text-red-200',
}

// ─── Goals ──────────────────────────────────────────────────────────────────

function GoalRowView({ row, canEdit, onSave }: { row: RevenueGoalRow; canEdit: boolean; onSave?: SaveRevenueGoal }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const parsed = parseGoalAmount(draft)
  const inputId = `dash-goal-${row.period}`

  const open = () => {
    setDraft(row.target ? String(row.target) : '')
    setEditing(true)
  }
  const save = async () => {
    if (!onSave || parsed === null) return
    setSaving(true)
    try {
      await onSave(row.period, parsed)
      setEditing(false)
    } catch {
      // onSave already told the user; the input stays open for another try
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="rounded-xl border border-white/[0.06] p-3" data-goal-period={row.period}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-on-surface">{row.title}</p>
        {row.statusText && <span className={cn(CHIP, STATUS_TONE[row.status ?? ''] ?? 'bg-white/[0.04] text-on-surface-variant')}>{row.statusText}</span>}
      </div>

      {editing ? (
        <div className="mt-2">
          <label htmlFor={inputId} className="block text-[11px] text-on-surface-variant mb-1">Цель — выручка за год, ₸</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={inputId}
              inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false) }}
              placeholder="например, 780 млн"
              className="w-full rounded-xl border border-white/10 bg-surface-container-low px-3 py-2 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary/50"
            />
            <div className="flex gap-2">
              <button type="button" className={BTN_PRIMARY} onClick={() => void save()} disabled={saving || parsed === null} aria-busy={saving}>
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </button>
              <button type="button" className={BTN_GHOST} onClick={() => setEditing(false)} disabled={saving}>Отмена</button>
            </div>
          </div>
          <p className="mt-1 text-[11px] font-mono text-on-surface-variant" aria-live="polite">
            {parsed !== null ? `= ${fmtValue(parsed, '₸')} в год · ${fmtValue(Math.round(parsed / 12), '₸')} в месяц` : 'Введите сумму за год'}
          </p>
          <p className="mt-1 text-[11px] text-on-surface-variant">Цель обновится и в анкете (шаг 1), в Точке А и в Точке Б.</p>
        </div>
      ) : row.target === null ? (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-on-surface-variant">Цель не задана</p>
          {canEdit && <button type="button" className={cn(BTN_GHOST, 'py-1.5')} onClick={open}><Icon name="add" className="text-[16px]" />Задать цель</button>}
        </div>
      ) : (
        <>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
            <p className="flex flex-wrap items-center gap-x-1.5 font-mono text-sm text-on-surface">
              <span className="whitespace-nowrap" title="Текущая выручка за год">{fmtValue(row.current, '₸')}</span>
              <Icon name="arrow_forward" className="text-[14px] text-on-surface-variant" />
              <span className="whitespace-nowrap font-bold">{fmtValue(row.target, '₸')}</span>
              <span className="text-[11px] text-on-surface-variant">/ год · {fmtValue(row.targetMonthly, '₸')} / мес</span>
            </p>
            {canEdit && (
              <button type="button" className={cn(BTN_GHOST, 'py-1.5')} onClick={open} aria-label={`Изменить цель «${row.title}»`}>
                <Icon name="edit" className="text-[16px]" />Изменить
              </button>
            )}
          </div>
          {row.reachedPct !== null && (
            <div className="mt-2">
              <div className="flex justify-between text-[10px] font-mono text-on-surface-variant">
                <span>сейчас {row.reachedPct}% цели{row.currentPeriod ? ` · факт ${row.currentPeriod}` : ''}</span>
                {row.deadline && <span suppressHydrationWarning>до {new Date(row.deadline).toLocaleDateString('ru-RU')}</span>}
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={row.reachedPct} aria-valuemin={0} aria-valuemax={100} aria-label={`${row.title}: достигнуто`}>
                <div className="h-full rounded-full bg-primary" style={{ width: `${row.reachedPct}%` }} />
              </div>
            </div>
          )}
          {row.realismText && <p className="mt-1.5 text-xs text-on-surface-variant">{row.realismText}</p>}
        </>
      )}
    </li>
  )
}

export function DashboardGoals({ model, onSaveGoal }: { model: Pick<DashboardSummaryModel, 'goals' | 'otherGoals' | 'canManage'>; onSaveGoal?: SaveRevenueGoal }) {
  return (
    <section className={CARD} aria-labelledby="dash-goals" id="dashboard-goals">
      <SectionTitle icon="flag" aside={<Link href={POINT_B_HREF} className="text-[11px] font-mono text-primary/80 hover:text-primary">План в Точке Б →</Link>}>
        <span id="dash-goals">Мои цели</span>
      </SectionTitle>
      <ul className="space-y-2">
        <GoalRowView row={model.goals['12m']} canEdit={model.canManage && !!onSaveGoal} onSave={onSaveGoal} />
        <GoalRowView row={model.goals['3y']} canEdit={model.canManage && !!onSaveGoal} onSave={onSaveGoal} />
      </ul>
      {model.otherGoals > 0 && (
        <p className="mt-2 text-[11px] text-on-surface-variant">
          Ещё целей: {model.otherGoals} — <Link href={`${POINT_A_HREF}#pa-goals`} className="text-primary/80 hover:text-primary">в Точке А</Link>
        </p>
      )}
    </section>
  )
}

// ─── The block ──────────────────────────────────────────────────────────────

function FindingList({ title, icon, tone, items, empty }: { title: string; icon: string; tone: string; items: Array<{ block: string; text: string }>; empty: string }) {
  return (
    <div>
      <p className="text-[11px] font-mono uppercase tracking-wider text-on-surface-variant mb-2">{title}</p>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((i, k) => (
            <li key={k} className="flex gap-2 text-sm text-on-surface">
              <Icon name={icon} className={`text-[16px] mt-0.5 ${tone}`} />
              <span><span className="text-on-surface-variant">{i.block}:</span> {i.text}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-on-surface-variant">{empty}</p>}
    </div>
  )
}

export function PointADashboardSummaryView({ model, onSaveGoal }: { model: DashboardSummaryModel; onSaveGoal?: SaveRevenueGoal }) {
  return (
    <div className="space-y-4" data-testid="dashboard-point-a">
      {/* Score, confidence, completeness + the way into Point A / Point B */}
      <section className={cn(CARD, 'relative overflow-clip')} aria-labelledby="dash-pa-title">
        <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:gap-5">
          <div className="self-center md:self-auto"><ScoreGauge score={model.score} size={120} /></div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.2em] text-primary/70">Точка А · главное</p>
              <h2 id="dash-pa-title" className="font-headline text-xl font-bold text-on-surface">Состояние бизнеса</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {model.stage && <span className={cn(CHIP, 'bg-primary/10 text-primary')}>{model.stage}</span>}
              {model.coveragePct !== null && <span className={cn(CHIP, 'bg-white/[0.04] text-on-surface-variant')}>Полнота данных {model.coveragePct}%</span>}
              {model.recalculating && (
                <span className={cn(CHIP, 'bg-primary/10 text-primary')} aria-live="polite"><Icon name="progress_activity" className="text-[12px] animate-spin" />Пересчитывается…</span>
              )}
            </div>
            <div className="max-w-sm"><ConfidenceBar value={model.confidencePct === null ? null : model.confidencePct / 100} /></div>
            {model.headline && <p className="text-sm leading-relaxed text-on-surface">{model.headline}</p>}
            {model.updatedAt && <p className="text-[11px] text-on-surface-variant" suppressHydrationWarning>Обновлено {formatRelativeRuLong(model.updatedAt)}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2 md:flex md:min-w-[11rem] md:flex-col md:items-stretch">
            <Link href={POINT_A_HREF} className={BTN_PRIMARY}><Icon name="my_location" className="text-[16px]" />Открыть Точку А</Link>
            <Link href={POINT_B_HREF} className={BTN_GHOST}><Icon name="flag_circle" className="text-[16px]" />Открыть Точку Б</Link>
          </div>
        </div>
        {!model.hasSnapshot && (
          <p className="relative mt-3 text-sm text-on-surface-variant">
            Точка А ещё не рассчитана: заполните анкету или загрузите отчётность — она посчитается автоматически.
          </p>
        )}
      </section>

      {model.keyMetrics.length > 0 && (
        <section className={CARD} aria-labelledby="dash-pa-key">
          <SectionTitle icon="monitoring" aside={<Link href={POINT_A_HREF} className="text-[11px] font-mono text-primary/80 hover:text-primary">Все метрики →</Link>}>
            <span id="dash-pa-key">Главные метрики</span>
          </SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {model.keyMetrics.map(({ metric, goal }) => <KeyMetricTile key={metric.id} m={metric} goal={goal} />)}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="dash-pa-attention">
          <SectionTitle icon="priority_high"><span id="dash-pa-attention">Требует внимания</span></SectionTitle>
          {model.attention.length ? (
            <ul className="space-y-2">
              {model.attention.map((a, i) => (
                <li key={i} className={cn('flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3', a.kind === 'discrepancy' ? 'border-amber-300/15 bg-amber-300/[0.04]' : 'border-white/[0.06]')}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-on-surface">{a.title}</p>
                    <p className="text-xs text-on-surface-variant">{a.detail}</p>
                  </div>
                  <Link href={a.action.href} className={cn(BTN_GHOST, 'py-1.5')}>{a.action.label}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-on-surface-variant">Сейчас ничего не требует вашего внимания.</p>
          )}
          {model.attentionTotal > model.attention.length && (
            <p className="mt-2 text-[11px] text-on-surface-variant">
              И ещё {model.attentionTotal - model.attention.length} — <Link href={`${POINT_A_HREF}#pa-attention`} className="text-primary/80 hover:text-primary">в Точке А</Link>
            </p>
          )}
        </section>

        <DashboardGoals model={model} onSaveGoal={onSaveGoal} />
      </div>

      {model.hasSnapshot && (
        <section className={CARD} aria-labelledby="dash-pa-findings">
          <SectionTitle icon="insights"><span id="dash-pa-findings">Риски, быстрые шаги, сильные стороны</span></SectionTitle>
          <div className="grid gap-4 md:grid-cols-3">
            <FindingList title="Риски" icon="warning" tone="text-amber-300" items={model.risks} empty="Критичных рисков по оценённым блокам нет" />
            <FindingList title="Быстрые шаги" icon="bolt" tone="text-primary" items={model.quickWins} empty="Сначала добавьте данные по блокам без оценки" />
            <FindingList title="Сильные стороны" icon="star" tone="text-emerald-300" items={model.strengths} empty="Пока нет блоков с уверенной высокой оценкой" />
          </div>
        </section>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Загрузка Точки А">
      <div className={cn(CARD, 'h-40 animate-pulse')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={cn(CARD, 'h-44 animate-pulse')} />
        <div className={cn(CARD, 'h-44 animate-pulse')} />
      </div>
    </div>
  )
}

/** Save a revenue goal through the goals API; refreshes the goals and the Point A state. */
export function useSaveRevenueGoal(): SaveRevenueGoal {
  const qc = useQueryClient()
  return async (period, annual) => {
    const res = await fetch('/api/v1/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(revenueGoalDraft(period, annual)),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body?.ok) {
      toast.error('Не удалось сохранить цель', { description: body?.error ?? undefined })
      throw new Error(body?.error ?? 'goal not saved')
    }
    toast.success('Цель сохранена', { description: 'Обновлена в анкете, Точке А и Точке Б' })
    await Promise.all([
      qc.invalidateQueries({ queryKey: GOALS_QUERY_KEY }),
      qc.invalidateQueries({ queryKey: POINT_A_STATE_KEY }),
    ])
  }
}

export default function PointADashboardSummary({ className }: { className?: string }) {
  const { data, isLoading, error, refetch, noCompany } = usePointAState()
  const saveGoal = useSaveRevenueGoal()

  if (isLoading) return <div className={className}><Skeleton /></div>
  if (noCompany) {
    return (
      <section className={cn(CARD, className)}>
        <h2 className="font-headline text-lg font-bold text-on-surface">Точка А</h2>
        <p className="mt-2 text-sm text-on-surface-variant">Заполните анкету — Точка А построится автоматически по вашим ответам, документам и метрикам.</p>
        <Link href="/client/onboarding" className={cn(BTN_PRIMARY, 'mt-3')}><Icon name="edit_note" className="text-[16px]" />Заполнить анкету</Link>
      </section>
    )
  }
  if (error || !data) {
    return (
      <section className={cn(CARD, className)} role="alert">
        <p className="text-sm text-on-surface">Не удалось загрузить Точку А.</p>
        <button type="button" className={cn(BTN_PRIMARY, 'mt-3')} onClick={() => void refetch()}>Повторить</button>
      </section>
    )
  }
  return <div className={className}><PointADashboardSummaryView model={buildDashboardSummary(data)} onSaveGoal={saveGoal} /></div>
}
