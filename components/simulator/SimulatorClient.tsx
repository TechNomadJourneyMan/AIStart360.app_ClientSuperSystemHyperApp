'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'
// Type-only import — erased at build, no lib logic is bundled into the client.
import type { SimResult } from '@/lib/simulator/core'

type SimTypeUI = 'revenue_growth' | 'cost_reduction'
type Horizon = 3 | 6 | 12

interface SavedSimulation {
  id: string
  sim_type: string
  title: string | null
  status: string
  result: SimResult | null
  updated_at: string
}

const SIM_TYPE_LABEL: Record<string, string> = {
  revenue_growth: 'Рост выручки',
  cost_reduction: 'Снижение затрат',
  anti_crisis: 'Антикризис',
}

const SIM_TYPE_ICON: Record<string, string> = {
  revenue_growth: 'trending_up',
  cost_reduction: 'content_cut',
  anti_crisis: 'emergency_home',
}

const CONFIDENCE_META: Record<SimResult['confidence'], { label: string; variant: 'success' | 'warning' | 'error' }> = {
  high: { label: 'высокая', variant: 'success' },
  medium: { label: 'средняя', variant: 'warning' },
  low: { label: 'низкая', variant: 'error' },
}

const DISCLAIMER = 'Это сценарная оценка на ваших данных, а не прогноз-обещание.'

// ── Money formatting: «12,5 млн ₸» ───────────────────────────────────────────
function moneyParts(n: number): { value: string; unit: string } {
  const abs = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  const fmt = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
  if (abs >= 1e9) return { value: sign + fmt(abs / 1e9), unit: 'млрд ₸' }
  if (abs >= 1e6) return { value: sign + fmt(abs / 1e6), unit: 'млн ₸' }
  if (abs >= 1e3) return { value: sign + fmt(abs / 1e3), unit: 'тыс ₸' }
  return { value: sign + Math.round(abs).toLocaleString('ru-RU'), unit: '₸' }
}

function formatMoney(n: number): string {
  const p = moneyParts(n)
  return `${p.value} ${p.unit}`
}

function formatRange(range: [number, number]): string {
  const [lo, hi] = range
  const a = moneyParts(lo)
  const b = moneyParts(hi)
  return a.unit === b.unit ? `${a.value}–${b.value} ${b.unit}` : `${formatMoney(lo)} – ${formatMoney(hi)}`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** «12 500» / «12,5» → number; empty/garbage → NaN. */
function parseNum(s: string): number {
  const cleaned = s.replace(/[\s ]/g, '').replace(',', '.')
  if (!cleaned) return NaN
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : NaN
}

// ── Small segmented control ──────────────────────────────────────────────────
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex gap-1 rounded-xl bg-surface-container p-1 border border-white/[0.04]">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            o.value === value
              ? 'bg-primary/15 text-primary border border-primary/20'
              : 'text-on-surface-variant hover:text-on-surface border border-transparent',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * SimulatorClient — «что если» сценарии на цифрах пользователя.
 *
 * Form → POST /api/v1/simulator (deterministic engine on the server) → three
 * scenario cards + CSS-bar projection of the realistic path + assumptions /
 * missing-data / confidence. Below — the saved simulations from GET. A
 * projection is never shown as a fact: the disclaimer is always rendered.
 */
export default function SimulatorClient() {
  // ── Form state ──
  const [simType, setSimType] = useState<SimTypeUI>('revenue_growth')
  const [revenue, setRevenue] = useState('')
  const [margin, setMargin] = useState('')
  const [horizon, setHorizon] = useState<Horizon>(6)
  const [target, setTarget] = useState('')
  const [fixedCosts, setFixedCosts] = useState('')
  const [costCut, setCostCut] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  // ── Run state ──
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<SimResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  // ── Saved simulations ──
  const [saved, setSaved] = useState<SavedSimulation[]>([])
  const [savedLoading, setSavedLoading] = useState(true)
  const [savedError, setSavedError] = useState<string | null>(null)

  const loadSaved = useCallback(async () => {
    setSavedLoading(true)
    setSavedError(null)
    try {
      const res = await fetch('/api/v1/simulator', { credentials: 'same-origin' })
      const data = await res.json()
      if (data?.ok && Array.isArray(data.simulations)) {
        setSaved(data.simulations as SavedSimulation[])
      } else {
        setSavedError(data?.error ?? 'Не удалось загрузить сохранённые симуляции.')
      }
    } catch {
      setSavedError('Сеть недоступна. Попробуйте обновить страницу.')
    } finally {
      setSavedLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSaved()
  }, [loadSaved])

  const runSimulation = useCallback(async () => {
    if (submitting) return
    setFormError(null)
    setRunError(null)

    const currentRevenueMonthly = parseNum(revenue)
    const marginPct = margin.trim() === '' ? 0 : parseNum(margin)
    if (!Number.isFinite(currentRevenueMonthly) || currentRevenueMonthly <= 0) {
      setFormError('Укажите текущую выручку — без неё сценарий не посчитать.')
      return
    }
    if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct > 100) {
      setFormError('Маржа должна быть числом от 0 до 100.')
      return
    }

    const targetN = parseNum(target)
    const fixedN = parseNum(fixedCosts)
    const cutN = parseNum(costCut)
    if (simType === 'cost_reduction' && Number.isFinite(cutN) && (cutN < 0 || cutN > 100)) {
      setFormError('Снижение затрат должно быть от 0 до 100%.')
      return
    }

    const input = {
      simType,
      currentRevenueMonthly,
      marginPct,
      horizonMonths: horizon,
      targetRevenueMonthly:
        simType === 'revenue_growth' && Number.isFinite(targetN) && targetN > 0 ? targetN : null,
      monthlyCostsFixed: Number.isFinite(fixedN) && fixedN >= 0 ? fixedN : undefined,
      costCutPct:
        simType === 'cost_reduction' && Number.isFinite(cutN) ? Math.min(100, Math.max(0, cutN)) : undefined,
    }
    const title = `${SIM_TYPE_LABEL[simType]} · ${horizon} мес`

    setSubmitting(true)
    try {
      const res = await fetch('/api/v1/simulator', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, title }),
      })
      const data = await res.json()
      if (data?.ok && data.result) {
        setResult(data.result as SimResult)
        void loadSaved()
      } else {
        setRunError(data?.error ?? 'Не получилось смоделировать. Попробуйте ещё раз.')
      }
    } catch {
      setRunError('Сеть недоступна. Попробуйте ещё раз.')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, revenue, margin, target, fixedCosts, costCut, simType, horizon, loadSaved])

  // Bars for the realistic scenario: height ∝ midpoint of revenueRange.
  const realistic = result?.scenarios?.realistic
  const mids = realistic?.monthly?.map((p) => (p.revenueRange[0] + p.revenueRange[1]) / 2) ?? []
  const maxMid = Math.max(1, ...mids)

  const scenarioEntries = result
    ? ([
        ['optimistic', result.scenarios.optimistic],
        ['realistic', result.scenarios.realistic],
        ['pessimistic', result.scenarios.pessimistic],
      ] as const)
    : []

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Что если</p>
        <h1 className="font-headline text-2xl md:text-3xl font-bold text-on-surface">Симулятор</h1>
        <p className="text-sm text-on-surface-variant mt-1 max-w-2xl">
          Сценарии на ваших цифрах: рост выручки или снижение затрат — три траектории с допущениями и уровнем уверенности.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(320px,380px),1fr] items-start">
        {/* ── Form card ── */}
        <Card variant="default" padding="md" className="border border-white/[0.04] shadow-card rounded-2xl">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void runSimulation()
            }}
          >
            <div>
              <p className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                Тип сценария
              </p>
              <Segmented<SimTypeUI>
                ariaLabel="Тип сценария"
                value={simType}
                onChange={setSimType}
                options={[
                  { value: 'revenue_growth', label: 'Рост выручки' },
                  { value: 'cost_reduction', label: 'Снижение затрат' },
                ]}
              />
            </div>

            <Input
              id="sim-revenue"
              label="Текущая выручка, ₸/мес"
              inputMode="decimal"
              placeholder="Например, 5 000 000"
              value={revenue}
              onChange={(e) => setRevenue(e.target.value)}
              leftIcon="payments"
            />

            <Input
              id="sim-margin"
              label="Маржа, %"
              inputMode="decimal"
              placeholder="Например, 30"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
              leftIcon="percent"
              hint="Без маржи прибыль не оценивается"
            />

            <div>
              <p className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                Горизонт
              </p>
              <Segmented<Horizon>
                ariaLabel="Горизонт моделирования"
                value={horizon}
                onChange={setHorizon}
                options={[
                  { value: 3, label: '3 мес' },
                  { value: 6, label: '6 мес' },
                  { value: 12, label: '12 мес' },
                ]}
              />
            </div>

            {simType === 'revenue_growth' ? (
              <Input
                id="sim-target"
                label="Цель, ₸/мес (необязательно)"
                inputMode="decimal"
                placeholder="Например, 8 000 000"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                leftIcon="flag"
                hint="Без цели возьмём модельный темп роста"
              />
            ) : (
              <>
                <Input
                  id="sim-fixed"
                  label="Фикс. затраты, ₸/мес"
                  inputMode="decimal"
                  placeholder="Например, 1 500 000"
                  value={fixedCosts}
                  onChange={(e) => setFixedCosts(e.target.value)}
                  leftIcon="receipt_long"
                />
                <Input
                  id="sim-cut"
                  label="Снижение затрат, %"
                  inputMode="decimal"
                  placeholder="Например, 15"
                  value={costCut}
                  onChange={(e) => setCostCut(e.target.value)}
                  leftIcon="content_cut"
                />
              </>
            )}

            {formError && (
              <p className="text-xs text-error" role="alert">
                {formError}
              </p>
            )}

            <Button type="submit" variant="primary" className="w-full" loading={submitting} leftIcon="query_stats">
              Смоделировать
            </Button>
          </form>
        </Card>

        {/* ── Result area ── */}
        <div className="space-y-4 min-w-0">
          {runError && (
            <Card variant="default" padding="md" className="border border-error/20 rounded-2xl">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-error">error</span>
                <div>
                  <p className="text-sm text-on-surface font-medium">Не удалось смоделировать</p>
                  <p className="text-xs text-on-surface-variant mt-1" role="alert">
                    {runError}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {!result && !runError && (
            <Card variant="default" padding="lg" className="border border-white/[0.04] rounded-2xl">
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <span className="material-symbols-outlined text-primary">query_stats</span>
                </div>
                <p className="text-sm text-on-surface font-medium">Пока нечего показать</p>
                <p className="text-xs text-on-surface-variant mt-1">
                  Заполните форму слева и нажмите «Смоделировать» — покажем три сценария.
                </p>
              </div>
            </Card>
          )}

          <AnimatePresence initial={false}>
            {result && (
              <motion.div
                key="sim-result"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-4"
              >
                {/* Confidence + mandatory disclaimer */}
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant={CONFIDENCE_META[result.confidence].variant} dot>
                    Уверенность: {CONFIDENCE_META[result.confidence].label}
                  </Badge>
                  <p className="text-[11px] text-on-surface-variant/80">{DISCLAIMER}</p>
                </div>

                {/* Three scenario cards */}
                <div className="grid gap-3 sm:grid-cols-3">
                  {scenarioEntries.map(([key, sc]) => (
                    <Card
                      key={key}
                      variant="default"
                      padding="sm"
                      className={cn(
                        'rounded-2xl border shadow-card',
                        key === 'realistic' ? 'border-primary/30 bg-primary/[0.04]' : 'border-white/[0.04]',
                      )}
                    >
                      <p
                        className={cn(
                          'text-[10px] font-mono uppercase tracking-[0.15em] mb-3',
                          key === 'realistic' ? 'text-primary/80' : 'text-on-surface-variant/70',
                        )}
                      >
                        {sc.label}
                      </p>
                      <div className="space-y-2.5">
                        <div>
                          <p className="text-[10px] text-on-surface-variant uppercase tracking-wider">
                            Выручка в конце
                          </p>
                          <p className="font-mono text-sm text-on-surface mt-0.5">
                            {formatRange(sc.outcome.revenueEnd)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-on-surface-variant uppercase tracking-wider">Прибыль</p>
                          <p
                            className={cn(
                              'font-mono text-sm mt-0.5',
                              sc.outcome.profitEnd[0] >= 0
                                ? 'text-primary'
                                : sc.outcome.profitEnd[1] < 0
                                  ? 'text-error'
                                  : 'text-on-surface',
                            )}
                          >
                            {formatRange(sc.outcome.profitEnd)}
                          </p>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>

                {/* Month-by-month bars — realistic scenario */}
                {realistic && realistic.monthly.length > 0 && (
                  <Card variant="default" padding="md" className="rounded-2xl border border-white/[0.04] shadow-card">
                    <p className="text-[10px] font-mono text-on-surface-variant/70 uppercase tracking-[0.15em] mb-4">
                      Выручка по месяцам · реалистичный сценарий
                    </p>
                    <div className="flex items-end gap-1.5 h-36" role="img" aria-label="Помесячная проекция выручки, реалистичный сценарий">
                      {realistic.monthly.map((p, i) => {
                        const mid = (p.revenueRange[0] + p.revenueRange[1]) / 2
                        const h = Math.max(4, Math.round((mid / maxMid) * 100))
                        return (
                          <div key={p.month} className="flex-1 flex flex-col items-center gap-1 min-w-0 h-full justify-end">
                            <div
                              className={cn(
                                'w-full rounded-t-md transition-colors',
                                i === realistic.monthly.length - 1 ? 'bg-primary/60' : 'bg-primary/25 hover:bg-primary/40',
                              )}
                              style={{ height: `${h}%` }}
                              title={`Месяц ${p.month}: ${formatRange(p.revenueRange)}`}
                            />
                            <span className="text-[9px] font-mono text-on-surface-variant/60">М{p.month}</span>
                          </div>
                        )
                      })}
                    </div>
                  </Card>
                )}

                {/* Assumptions + missing data */}
                <div className="grid gap-3 md:grid-cols-2">
                  {result.assumptions.length > 0 && (
                    <Card variant="default" padding="md" className="rounded-2xl border border-white/[0.04]">
                      <p className="text-[10px] font-mono text-on-surface-variant/70 uppercase tracking-[0.15em] mb-3">
                        Допущения
                      </p>
                      <ul className="space-y-2">
                        {result.assumptions.map((a, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-on-surface-variant leading-relaxed">
                            <span className="material-symbols-outlined text-[14px] text-primary/70 mt-0.5">
                              subdirectory_arrow_right
                            </span>
                            {a}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  )}

                  {result.missingData.length > 0 && (
                    <Card variant="default" padding="md" className="rounded-2xl border border-amber-500/15">
                      <p className="text-[10px] font-mono text-amber-400/80 uppercase tracking-[0.15em] mb-3">
                        Не хватает данных
                      </p>
                      <ul className="space-y-2">
                        {result.missingData.map((m, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-on-surface-variant leading-relaxed">
                            <span className="material-symbols-outlined text-[14px] text-amber-400/80 mt-0.5">
                              help
                            </span>
                            {m}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  )}
                </div>

                <p className="text-[11px] text-on-surface-variant/70 leading-relaxed">{DISCLAIMER}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Saved simulations ── */}
      <Card variant="default" padding="md" className="rounded-2xl border border-white/[0.04] shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-headline text-lg font-bold text-on-surface">Сохранённые симуляции</h2>
          {!savedLoading && !savedError && (
            <span className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider">
              {saved.length} шт.
            </span>
          )}
        </div>

        {savedLoading ? (
          <div className="space-y-2">
            <Skeleton variant="line" className="h-12 w-full rounded-xl" />
            <Skeleton variant="line" className="h-12 w-full rounded-xl" />
            <Skeleton variant="line" className="h-12 w-full rounded-xl" />
          </div>
        ) : savedError ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-error" role="alert">
              {savedError}
            </p>
            <Button variant="secondary" size="sm" leftIcon="refresh" onClick={() => void loadSaved()}>
              Повторить
            </Button>
          </div>
        ) : saved.length === 0 ? (
          <p className="text-xs text-on-surface-variant py-2">
            Пока нет сохранённых симуляций — запустите первую выше.
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {saved.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-[18px] text-primary">
                    {SIM_TYPE_ICON[s.sim_type] ?? 'query_stats'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-on-surface truncate">
                    {s.title || SIM_TYPE_LABEL[s.sim_type] || s.sim_type}
                  </p>
                  <p className="text-[11px] text-on-surface-variant mt-0.5">
                    {SIM_TYPE_LABEL[s.sim_type] ?? s.sim_type} · {formatDate(s.updated_at)}
                  </p>
                </div>
                {s.result?.confidence && CONFIDENCE_META[s.result.confidence] && (
                  <Badge variant={CONFIDENCE_META[s.result.confidence].variant}>
                    {CONFIDENCE_META[s.result.confidence].label}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
