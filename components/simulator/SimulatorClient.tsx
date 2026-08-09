'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'
// Value import, not type-only: the engine is a pure dependency-free function, so
// it runs in the browser and every keystroke / slider drag recomputes instantly.
// POST /api/v1/simulator is now used only for an explicit «Сохранить» (it writes
// a row and burns the 20-per-user quota).
import {
  runSimulation,
  type SimInput,
  type SimResult,
  type ScenarioProjection,
  type MonthlyPoint,
} from '@/lib/simulator/core'

type SimTypeUI = 'revenue_growth' | 'cost_reduction'
type Horizon = 3 | 6 | 12
type ScenarioKey = 'optimistic' | 'realistic' | 'pessimistic'
type ChartMetric = 'revenue' | 'profit'

interface SavedSimulation {
  id: string
  sim_type: string
  title: string | null
  status: string
  result: SimResult | null
  updated_at: string
}

/**
 * Display labels for every sim_type the backend can store. `anti_crisis` is kept
 * here so legacy rows render with a proper name, but it is deliberately NOT
 * offered in the type switcher: the engine handles it exactly like
 * `revenue_growth` (lib/simulator/core.ts:118), so a third button would promise
 * a different model that does not exist.
 */
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

const SCENARIO_ORDER: ScenarioKey[] = ['optimistic', 'realistic', 'pessimistic']

const DISCLAIMER = 'Это сценарная оценка на ваших данных, а не прогноз-обещание.'

// Mirrors MAX_PER_USER in app/api/v1/simulator/route.ts:19.
const MAX_SAVED = 20

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

/** Exact number with thin separators — used when the formula must be checkable. */
function formatExact(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU')} ₸`
}

function formatPct(n: number, digits = 1): string {
  const sign = n > 0 ? '+' : ''
  return `${sign}${(n * 100).toFixed(digits).replace('.', ',')}%`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** «12 500» / «12,5» → number; empty/garbage → NaN. */
function parseNum(s: string): number {
  const cleaned = s.replace(/[\s ]/g, '').replace(',', '.')
  if (!cleaned) return NaN
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : NaN
}

function midOf(range: [number, number]): number {
  return (range[0] + range[1]) / 2
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

// ── Everything below is READ BACK from the engine's own output ───────────────
// Nothing here re-implements the model: the growth rate, the uncertainty band and
// the fixed costs actually used are all derived from the numbers on screen, so an
// explanation can never drift away from the figure it explains.

/** Monthly growth the engine actually applied, derived from its own series. */
function appliedGrowth(sc: ScenarioProjection): number | null {
  const pts = sc.monthly
  if (pts.length < 2) return null
  const first = midOf(pts[0].revenueRange)
  const last = midOf(pts[pts.length - 1].revenueRange)
  if (first <= 0 || last <= 0) return null
  const g = Math.pow(last / first, 1 / (pts.length - 1)) - 1
  return Number.isFinite(g) ? g : null
}

/** Half-width of the uncertainty band: lo = c(1−b), hi = c(1+b) ⇒ b = (hi−lo)/(hi+lo). */
function appliedBand(range: [number, number]): number | null {
  const sum = range[0] + range[1]
  if (sum <= 0) return null
  const b = (range[1] - range[0]) / sum
  return Number.isFinite(b) ? b : null
}

/** Fixed costs inside the profit formula: profit = revenue×margin/100 − fixed. */
function derivedFixedCosts(p: MonthlyPoint, marginPct: number): number {
  return (p.revenueRange[0] * marginPct) / 100 - p.cashRange[0]
}

/**
 * Margin and fixed costs a SAVED run was built on, solved from its own series.
 *
 * GET /api/v1/simulator returns `result` but not `inputs`, so a stored projection
 * carries no record of the margin behind it. Reading the margin off the form on
 * screen would print today's numbers under yesterday's chart — a fabricated
 * explanation. Two months of the same scenario are enough to recover it:
 *   profit = revenue×m − F  ⇒  m = Δprofit/Δrevenue,  F = revenue×m − profit.
 * All three scenarios share m and F (lib/simulator/core.ts:105,132-134), so a
 * flat-revenue scenario (cost_reduction realistic, growth 0) is skipped in favour
 * of a sibling. Values are approximate: the stored series is rounded to whole ₸.
 */
function solveMarginAndFixed(result: SimResult): { marginPct: number; fixedCosts: number } | null {
  for (const key of SCENARIO_ORDER) {
    const pts = result.scenarios[key].monthly
    if (pts.length < 2) continue
    const rFirst = midOf(pts[0].revenueRange)
    const rLast = midOf(pts[pts.length - 1].revenueRange)
    if (Math.abs(rLast - rFirst) < 1) continue // flat revenue — m is not separable here
    const pFirst = midOf(pts[0].cashRange)
    const pLast = midOf(pts[pts.length - 1].cashRange)
    const m = (pLast - pFirst) / (rLast - rFirst)
    if (!Number.isFinite(m) || m < -0.001 || m > 1.001) continue
    const clamped = clamp(m, 0, 1)
    return { marginPct: Math.round(clamped * 10000) / 100, fixedCosts: rFirst * clamped - pFirst }
  }
  return null
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
 * Slider + exact number box over one string field. Both controls write the same
 * state, so dragging and typing are interchangeable and the result recomputes on
 * every step.
 */
function SliderField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  hint,
  error,
  disabled,
  disabledHint,
  derived,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  min: number
  max: number
  step: number
  unit: string
  hint?: string
  error?: string
  disabled?: boolean
  disabledHint?: string
  /** Value is computed from other fields — show it as a readout, not a text box. */
  derived?: boolean
}) {
  const parsed = parseNum(value)
  const sliderValue = Number.isFinite(parsed) ? clamp(parsed, min, max) : min
  const hintId = `${id}-hint`
  const shownHint = disabled ? disabledHint : error ?? hint

  return (
    <div>
      <div className="flex items-end justify-between gap-3 mb-2">
        <label htmlFor={id} className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider">
          {label}
        </label>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {derived ? (
            // A derived figure must not look typeable: it is recomputed from the
            // other fields on every render, so an <input> here would silently
            // discard whatever the user entered. Hidden from assistive tech —
            // it only mirrors the slider, whose aria-valuetext already says it
            // (and <output> would turn this into a live region firing on every step).
            <span
              aria-hidden="true"
              className={cn(
                'w-16 rounded-lg px-2 py-1 text-right font-mono text-sm tabular-nums',
                'border border-transparent bg-surface-container/50',
                disabled ? 'text-on-surface-variant/50' : 'text-on-surface-variant',
              )}
            >
              {value}
            </span>
          ) : (
            <input
              id={`${id}-exact`}
              type="text"
              inputMode="decimal"
              aria-label={`${label} — точное значение`}
              aria-invalid={error ? true : undefined}
              aria-describedby={shownHint ? hintId : undefined}
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              className={cn(
                'w-16 bg-surface-container border rounded-lg px-2 py-1 text-right font-mono text-sm text-on-surface',
                'focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                error ? 'border-error/50' : 'border-outline-variant/30',
              )}
            />
          )}
          <span className="text-xs text-on-surface-variant">{unit}</span>
        </div>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        disabled={disabled}
        aria-describedby={shownHint ? hintId : undefined}
        aria-valuetext={`${sliderValue} ${unit}`}
        onChange={(e) => onChange(e.target.value)}
        className="w-full accent-primary cursor-pointer rounded disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      />
      {shownHint && (
        <p id={hintId} className={cn('text-xs mt-1.5', error && !disabled ? 'text-error' : 'text-on-surface-variant')}>
          {shownHint}
        </p>
      )}
    </div>
  )
}

interface Blocker {
  fieldId: string
  message: string
}

interface FormValues {
  simType: SimTypeUI
  revenue: string
  margin: string
  horizon: Horizon
  target: string
  fixedCosts: string
  costCut: string
}

interface Validated {
  input: SimInput | null
  blockers: Blocker[]
  fieldErrors: Record<string, string>
  marginPct: number
  fixedCostsRaw: number
  costCutPct: number
}

/**
 * Turns the raw form into a SimInput. A scenario is produced only when every
 * lever it depends on is actually present — an empty «снижение затрат» used to
 * yield three cards built on «затраты снижены на 0%», which looks like a
 * calculation but is none.
 */
function validate(f: FormValues): Validated {
  const blockers: Blocker[] = []
  const fieldErrors: Record<string, string> = {}

  const revenue = parseNum(f.revenue)
  const revenueOk = Number.isFinite(revenue) && revenue > 0
  if (!revenueOk) {
    blockers.push({ fieldId: 'sim-revenue', message: 'Текущая выручка, ₸/мес — от неё считается вся траектория.' })
    if (f.revenue.trim() !== '') fieldErrors['sim-revenue'] = 'Нужно положительное число.'
  }

  let marginPct = 0
  if (f.margin.trim() !== '') {
    const m = parseNum(f.margin)
    if (!Number.isFinite(m) || m < 0 || m > 100) {
      fieldErrors['sim-margin'] = 'Маржа — число от 0 до 100.'
      blockers.push({ fieldId: 'sim-margin', message: 'Маржа, % — значение вне диапазона 0–100.' })
    } else {
      marginPct = m
    }
  }

  let targetValue: number | null = null
  if (f.simType === 'revenue_growth' && f.target.trim() !== '') {
    const t = parseNum(f.target)
    if (!Number.isFinite(t) || t <= 0) {
      fieldErrors['sim-target'] = 'Нужно положительное число или пустое поле.'
      blockers.push({ fieldId: 'sim-target', message: 'Цель, ₸/мес — введено не число.' })
    } else {
      targetValue = t
    }
  }

  let fixedCostsRaw = 0
  let costCutPct = 0
  if (f.simType === 'cost_reduction') {
    const fx = parseNum(f.fixedCosts)
    if (!Number.isFinite(fx) || fx <= 0) {
      blockers.push({ fieldId: 'sim-fixed', message: 'Фикс. затраты, ₸/мес — без них снижать нечего.' })
      if (f.fixedCosts.trim() !== '') fieldErrors['sim-fixed'] = 'Нужно положительное число.'
    } else {
      fixedCostsRaw = fx
    }
    const cut = parseNum(f.costCut)
    if (!Number.isFinite(cut) || cut <= 0) {
      blockers.push({ fieldId: 'sim-cut', message: 'Снижение затрат, % — при 0% сценарий ничем не отличается от текущего.' })
      if (f.costCut.trim() !== '') fieldErrors['sim-cut'] = 'Нужно число больше 0.'
    } else if (cut > 100) {
      fieldErrors['sim-cut'] = 'Не больше 100%.'
      blockers.push({ fieldId: 'sim-cut', message: 'Снижение затрат, % — больше 100% не бывает.' })
    } else {
      costCutPct = cut
    }
  } else {
    const fx = parseNum(f.fixedCosts)
    if (f.fixedCosts.trim() !== '') {
      if (!Number.isFinite(fx) || fx < 0) {
        fieldErrors['sim-fixed'] = 'Нужно неотрицательное число.'
        blockers.push({ fieldId: 'sim-fixed', message: 'Фикс. затраты, ₸/мес — введено не число.' })
      } else {
        fixedCostsRaw = fx
      }
    }
  }

  if (blockers.length > 0) {
    return { input: null, blockers, fieldErrors, marginPct, fixedCostsRaw, costCutPct }
  }

  const input: SimInput = {
    simType: f.simType,
    currentRevenueMonthly: revenue,
    marginPct,
    horizonMonths: f.horizon,
    targetRevenueMonthly: targetValue,
    monthlyCostsFixed: fixedCostsRaw,
    costCutPct: f.simType === 'cost_reduction' ? costCutPct : undefined,
  }
  return { input, blockers, fieldErrors, marginPct, fixedCostsRaw, costCutPct }
}

const MISSING_FIELD_MAP: Array<{ match: RegExp; fieldId: string }> = [
  { match: /маржа/i, fieldId: 'sim-margin' },
  { match: /выручк/i, fieldId: 'sim-revenue' },
]

function focusField(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  ;(el as HTMLElement).focus({ preventScroll: true })
}

/**
 * SimulatorClient — «что если» сценарии на цифрах пользователя.
 *
 * The deterministic engine runs locally on every change, so sliders, text fields
 * and segmented controls move the numbers immediately; each figure opens into the
 * formula that produced it, with the growth rate, the ±band and the fixed costs
 * read back from the engine output rather than restated. The server round-trip is
 * reserved for «Сохранить сценарий». A projection is never shown as a fact.
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

  // ── Provenance of the prefilled numbers (never silently «ours») ──
  const [prefill, setPrefill] = useState<{ revenueMonthly: number | null; goalMonthly: number | null; loading: boolean }>(
    { revenueMonthly: null, goalMonthly: null, loading: true },
  )
  const [revenueFromData, setRevenueFromData] = useState(false)
  const [targetFromData, setTargetFromData] = useState(false)

  // ── Result presentation ──
  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey>('realistic')
  const [chartMetricOverride, setChartMetricOverride] = useState<ChartMetric | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [explainOpen, setExplainOpen] = useState(false)
  const [confidenceOpen, setConfidenceOpen] = useState(false)

  // ── Saving ──
  const [saveTitle, setSaveTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState<string | null>(null)

  // ── Saved simulations ──
  const [saved, setSaved] = useState<SavedSimulation[]>([])
  const [savedLoading, setSavedLoading] = useState(true)
  const [savedError, setSavedError] = useState<string | null>(null)
  const [openedSaved, setOpenedSaved] = useState<SavedSimulation | null>(null)

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

  // Pull the owner's REAL revenue / 12-month goal from Point B. Nothing is
  // invented: when the answer is empty the form stays empty and says why.
  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const res = await fetch('/api/v1/diagnostics/point-b', { credentials: 'same-origin' })
        const data = await res.json()
        if (!alive) return
        const goals = data?.ok && data.data ? data.data.goals : null
        const rev = typeof goals?.current_revenue_month === 'number' && goals.current_revenue_month > 0
          ? goals.current_revenue_month
          : null
        const goal = typeof goals?.goal_12m_revenue_month === 'number' && goals.goal_12m_revenue_month > 0
          ? goals.goal_12m_revenue_month
          : null
        setPrefill({ revenueMonthly: rev, goalMonthly: goal, loading: false })
        // Autofill only what the user has not touched.
        if (rev !== null) {
          setRevenue((prev) => {
            if (prev.trim() !== '') return prev
            setRevenueFromData(true)
            return Math.round(rev).toLocaleString('ru-RU')
          })
        }
        if (goal !== null) {
          setTarget((prev) => {
            if (prev.trim() !== '') return prev
            setTargetFromData(true)
            return Math.round(goal).toLocaleString('ru-RU')
          })
        }
      } catch {
        if (alive) setPrefill({ revenueMonthly: null, goalMonthly: null, loading: false })
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [])

  const applyMyNumbers = useCallback(() => {
    if (prefill.revenueMonthly !== null) {
      setRevenue(Math.round(prefill.revenueMonthly).toLocaleString('ru-RU'))
      setRevenueFromData(true)
    }
    if (prefill.goalMonthly !== null) {
      setTarget(Math.round(prefill.goalMonthly).toLocaleString('ru-RU'))
      setTargetFromData(true)
    }
    setOpenedSaved(null)
  }, [prefill])

  const onRevenueChange = useCallback((v: string) => {
    setRevenue(v)
    setRevenueFromData(false)
  }, [])

  const onTargetChange = useCallback((v: string) => {
    setTarget(v)
    setTargetFromData(false)
  }, [])

  // ── Live recalculation: pure, synchronous, no network, no debounce ──
  const form = useMemo<FormValues>(
    () => ({ simType, revenue, margin, horizon, target, fixedCosts, costCut }),
    [simType, revenue, margin, horizon, target, fixedCosts, costCut],
  )
  const validated = useMemo(() => validate(form), [form])
  const liveResult = useMemo(
    () => (validated.input ? runSimulation(validated.input) : null),
    [validated.input],
  )

  const shownResult: SimResult | null = openedSaved?.result ?? liveResult
  const isSnapshot = openedSaved !== null && openedSaved.result !== null

  // Everything that describes the result must follow the RESULT, not the form.
  // While a saved run is open the form still shows today's inputs, and they have
  // nothing to do with the chart on screen.
  const shownSimType: string = isSnapshot && openedSaved ? openedSaved.sim_type : simType
  const isCostReduction = shownSimType === 'cost_reduction'

  // Margin / fixed costs behind the shown figures: known exactly for the live
  // calculation, reconstructed from the series for a saved run (see solveMarginAndFixed).
  const snapshotParams = useMemo(
    () => (isSnapshot && openedSaved?.result ? solveMarginAndFixed(openedSaved.result) : null),
    [isSnapshot, openedSaved],
  )
  const shownMarginPct: number | null = isSnapshot ? snapshotParams?.marginPct ?? null : validated.marginPct

  const chartMetric: ChartMetric = chartMetricOverride ?? (isCostReduction ? 'profit' : 'revenue')

  const scenario: ScenarioProjection | null = shownResult ? shownResult.scenarios[selectedScenario] : null
  const points = scenario?.monthly ?? []
  const effectiveMonth = selectedMonth !== null && selectedMonth >= 1 && selectedMonth <= points.length
    ? selectedMonth
    : points.length
  const activePoint: MonthlyPoint | null = points.length > 0 ? points[effectiveMonth - 1] : null

  const realisticGrowth = shownResult ? appliedGrowth(shownResult.scenarios.realistic) : null
  const scenarioGrowth = scenario ? appliedGrowth(scenario) : null

  // Screen-reader announcement of the recalculated headline figures. Debounced:
  // recalculation is per-keystroke and per-slider-step, and an undebounced live
  // region would read out every intermediate value while the user is still typing.
  const liveSummary = shownResult
    ? `${scenario?.label ?? 'Реалистичный'} сценарий, ${points.length} мес: выручка ${formatRange(shownResult.scenarios[selectedScenario].outcome.revenueEnd)}, прибыль ${formatRange(shownResult.scenarios[selectedScenario].outcome.profitEnd)}.`
    : 'Расчёт не выполнен: не хватает исходных данных.'
  const [announced, setAnnounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(liveSummary), 600)
    return () => clearTimeout(t)
  }, [liveSummary])

  const autoTitle = `${SIM_TYPE_LABEL[simType]} · ${horizon} мес`

  // A save message describes the inputs it was sent with — drop it once they move.
  useEffect(() => {
    setSaveOk(null)
    setSaveError(null)
  }, [form])

  const saveScenario = useCallback(async () => {
    if (saving || !validated.input) return
    setSaveError(null)
    setSaveOk(null)
    setSaving(true)
    try {
      const res = await fetch('/api/v1/simulator', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: validated.input, title: saveTitle.trim() || autoTitle }),
      })
      const data = await res.json()
      if (data?.ok) {
        setSaveOk('Сценарий сохранён.')
        setSaveTitle('')
        void loadSaved()
      } else if (res.status === 409) {
        setSaveError(
          `${data?.error ?? `Достигнут лимит сохранённых симуляций (${MAX_SAVED}).`} Удаление сохранённых прогонов пока не реализовано — расчёты выше продолжают работать без сохранения.`,
        )
      } else {
        setSaveError(data?.error ?? 'Не получилось сохранить. Попробуйте ещё раз.')
      }
    } catch {
      setSaveError('Сеть недоступна. Попробуйте ещё раз.')
    } finally {
      setSaving(false)
    }
  }, [saving, validated.input, saveTitle, autoTitle, loadSaved])

  // ── Chart geometry (shared zero baseline so negative profit reads correctly) ──
  const barValues = points.map((p) => (chartMetric === 'revenue' ? midOf(p.revenueRange) : midOf(p.cashRange)))
  const maxV = barValues.length > 0 ? Math.max(0, ...barValues) : 0
  const minV = barValues.length > 0 ? Math.min(0, ...barValues) : 0
  const span = Math.max(1, maxV - minV)
  const zeroPct = ((0 - minV) / span) * 100

  // ── «Как посчитано»: every row is read back from the shown numbers ──
  const breakdown = useMemo(() => {
    if (!scenario || !activePoint) return []
    const rows: Array<{ term: string; value: string; note?: string }> = []
    const band = appliedBand(activePoint.revenueRange)
    const central = midOf(activePoint.revenueRange)
    const g = appliedGrowth(scenario)
    const base = points.length > 0 && g !== null ? midOf(points[0].revenueRange) / (1 + g) : null

    if (base !== null) {
      rows.push({ term: 'База — текущая выручка', value: formatExact(base) })
    }
    if (g !== null) {
      const ratio =
        realisticGrowth !== null && Math.abs(realisticGrowth) > 1e-9 ? g / realisticGrowth : null
      rows.push({
        term: 'Темп этого сценария',
        value: `${formatPct(g)}/мес`,
        note: ratio !== null && Math.abs(ratio - 1) > 1e-6
          ? `×${ratio.toFixed(2).replace('.', ',')} к реалистичному темпу (${formatPct(realisticGrowth ?? 0)}/мес)`
          : undefined,
      })
    }
    if (base !== null && g !== null) {
      rows.push({
        term: `Выручка на месяц ${effectiveMonth}`,
        value: `${formatExact(base)} × (1 ${g < 0 ? '−' : '+'} ${Math.abs(g).toFixed(4).replace('.', ',')})^${effectiveMonth} = ${formatExact(central)}`,
      })
    }
    if (band !== null) {
      rows.push({
        term: 'Полоса неопределённости',
        value: `±${(band * 100).toFixed(0)}% → ${formatExact(activePoint.revenueRange[0])} – ${formatExact(activePoint.revenueRange[1])}`,
      })
    }

    // Reconstructed values are marked «≈»: the stored series is rounded to whole
    // ₸, so solving back for margin/costs lands a few tenges off the original.
    const approx = isSnapshot ? '≈ ' : ''
    if (shownMarginPct === null) {
      // Saved run whose parameters cannot be recovered — say so instead of
      // borrowing the numbers currently typed into the form.
      rows.push({
        term: 'Маржа и затраты',
        value: 'не восстанавливаются',
        note: 'сохранён только результат прогона, его исходные параметры список не возвращает — прибыль ниже показана как есть',
      })
      rows.push({
        term: `Прибыль на месяц ${effectiveMonth}`,
        value: `${formatExact(activePoint.cashRange[0])} – ${formatExact(activePoint.cashRange[1])}`,
      })
      return rows
    }

    const effFixed = derivedFixedCosts(activePoint, shownMarginPct)
    rows.push({
      term: 'Маржа',
      value: shownMarginPct > 0 ? `${approx}${shownMarginPct}%` : 'не указана',
      note: shownMarginPct > 0
        ? isSnapshot
          ? 'восстановлена из сохранённого расчёта'
          : undefined
        : 'без маржи прибыль равна минус фикс. затратам — это не оценка прибыли',
    })
    rows.push({
      term: 'Фикс. затраты в расчёте',
      value: `${approx}${formatExact(effFixed)}`,
      note:
        !isSnapshot && simType === 'cost_reduction' && validated.costCutPct > 0
          ? `после снижения на ${validated.costCutPct}%; до снижения — ${formatExact(validated.fixedCostsRaw)}`
          : undefined,
    })
    rows.push({
      term: `Прибыль на месяц ${effectiveMonth}`,
      value: `выручка × ${shownMarginPct}% − ${approx}${formatExact(effFixed)} = ${formatExact(activePoint.cashRange[0])} – ${formatExact(activePoint.cashRange[1])}`,
    })
    return rows
  }, [scenario, activePoint, points, effectiveMonth, realisticGrowth, validated, simType, isSnapshot, shownMarginPct])

  // The engine prints «выручка принята неизменной» for cost_reduction, yet builds
  // the optimistic/pessimistic cards with a ±1%/мес revenue drift. Surface the
  // rate it really used instead of leaving the contradiction on screen.
  const costDriftNote =
    isCostReduction && scenarioGrowth !== null && Math.abs(scenarioGrowth) > 1e-6
      ? `В допущениях сказано «выручка принята неизменной», но в этом сценарии движок применил дрейф выручки ${formatPct(scenarioGrowth)}/мес. Это допущение движка, а не эффект снижения затрат.`
      : null

  // No target → the «realistic» path rides a default model rate, not the client's data.
  const modelRateWarning =
    !isSnapshot && validated.input?.simType === 'revenue_growth' && validated.input.targetRevenueMonthly == null

  const scenarioCards = shownResult
    ? SCENARIO_ORDER.map((key) => ({ key, sc: shownResult.scenarios[key] }))
    : []

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Что если</p>
        <h1 className="font-headline text-2xl md:text-3xl font-bold text-on-surface">Симулятор</h1>
        <p className="text-sm text-on-surface-variant mt-1 max-w-2xl">
          Сценарии на ваших цифрах: рост выручки или снижение затрат. Всё считается прямо на экране — двигайте ползунки
          и меняйте поля, числа пересчитываются сразу.
        </p>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announced}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(320px,400px),1fr] items-start">
        {/* ── Form card ── */}
        <Card variant="default" padding="md" className="border border-white/[0.04] shadow-card rounded-2xl">
          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div>
              <p className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                Тип сценария
              </p>
              <Segmented<SimTypeUI>
                ariaLabel="Тип сценария"
                value={simType}
                onChange={(v) => {
                  setSimType(v)
                  setChartMetricOverride(null)
                  setSelectedMonth(null)
                  setOpenedSaved(null)
                }}
                options={[
                  { value: 'revenue_growth', label: 'Рост выручки' },
                  { value: 'cost_reduction', label: 'Снижение затрат' },
                ]}
              />
            </div>

            <div>
              <Input
                id="sim-revenue"
                label="Текущая выручка, ₸/мес"
                inputMode="decimal"
                placeholder="Например, 5 000 000"
                value={revenue}
                onChange={(e) => onRevenueChange(e.target.value)}
                leftIcon="payments"
                error={validated.fieldErrors['sim-revenue']}
                aria-invalid={validated.fieldErrors['sim-revenue'] ? true : undefined}
                aria-describedby="sim-revenue-source"
              />
              <p id="sim-revenue-source" className="mt-1.5">
                {revenueFromData ? (
                  <Badge variant="primary">из ваших данных · Точка Б</Badge>
                ) : prefill.loading ? (
                  <span className="text-xs text-on-surface-variant/60">Проверяем ваши данные…</span>
                ) : prefill.revenueMonthly !== null ? (
                  <button
                    type="button"
                    onClick={applyMyNumbers}
                    className="text-xs text-primary underline underline-offset-2 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                  >
                    Подставить мои цифры ({formatMoney(prefill.revenueMonthly)}/мес)
                  </button>
                ) : (
                  <span className="text-xs text-on-surface-variant">
                    Вашей выручки в системе нет —{' '}
                    <Link
                      href="/point-b"
                      className="text-primary underline underline-offset-2 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                    >
                      заполните Точку Б
                    </Link>{' '}
                    или введите вручную.
                  </span>
                )}
              </p>
            </div>

            <SliderField
              id="sim-margin"
              label="Маржа, %"
              value={margin}
              onChange={setMargin}
              min={0}
              max={100}
              step={1}
              unit="%"
              hint="Без маржи прибыль не оценивается"
              error={validated.fieldErrors['sim-margin']}
            />

            <div>
              <p className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                Горизонт
              </p>
              <Segmented<Horizon>
                ariaLabel="Горизонт моделирования"
                value={horizon}
                onChange={(v) => {
                  setHorizon(v)
                  setSelectedMonth(null)
                  setOpenedSaved(null)
                }}
                options={[
                  { value: 3, label: '3 мес' },
                  { value: 6, label: '6 мес' },
                  { value: 12, label: '12 мес' },
                ]}
              />
            </div>

            {simType === 'revenue_growth' ? (
              <>
                <div>
                  <Input
                    id="sim-target"
                    label="Цель, ₸/мес (необязательно)"
                    inputMode="decimal"
                    placeholder="Например, 8 000 000"
                    value={target}
                    onChange={(e) => onTargetChange(e.target.value)}
                    leftIcon="flag"
                    error={validated.fieldErrors['sim-target']}
                    aria-invalid={validated.fieldErrors['sim-target'] ? true : undefined}
                    hint={targetFromData ? undefined : 'Без цели движок берёт модельный темп, не ваш'}
                    aria-describedby="sim-target-source"
                  />
                  {targetFromData && (
                    <p id="sim-target-source" className="mt-1.5">
                      <Badge variant="primary">цель из вашей Точки Б</Badge>
                    </p>
                  )}
                </div>

                <SliderField
                  id="sim-target-mult"
                  label="Цель, × к текущей выручке"
                  value={
                    (() => {
                      const rev = parseNum(revenue)
                      const tgt = parseNum(target)
                      if (!Number.isFinite(rev) || rev <= 0 || !Number.isFinite(tgt) || tgt <= 0) return '1'
                      return (tgt / rev).toFixed(2)
                    })()
                  }
                  onChange={(v) => {
                    const rev = parseNum(revenue)
                    const k = parseNum(v)
                    if (!Number.isFinite(rev) || rev <= 0 || !Number.isFinite(k)) return
                    onTargetChange(Math.round(rev * k).toLocaleString('ru-RU'))
                  }}
                  min={0.5}
                  max={3}
                  step={0.05}
                  unit="×"
                  derived
                  disabled={!(parseNum(revenue) > 0)}
                  disabledHint="Укажите текущую выручку — множитель считается от неё"
                  hint="Быстрый способ поставить цель: множитель к сегодняшней выручке"
                />
              </>
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
                  error={validated.fieldErrors['sim-fixed']}
                  aria-invalid={validated.fieldErrors['sim-fixed'] ? true : undefined}
                  hint="Обязательно: без них снижать нечего"
                />
                <SliderField
                  id="sim-cut"
                  label="Снижение затрат, %"
                  value={costCut}
                  onChange={setCostCut}
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  hint="Сколько процентов фикс. затрат вы убираете"
                  error={validated.fieldErrors['sim-cut']}
                />
              </>
            )}

            <div className="pt-1 border-t border-white/[0.04]">
              <p className="text-[11px] text-on-surface-variant/70 leading-relaxed pt-3">
                Расчёт идёт в браузере и ничего не сохраняет. Кнопка ниже записывает сценарий в вашу историю.
              </p>
            </div>

            <Input
              id="sim-title"
              label="Название сценария"
              placeholder={autoTitle}
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              leftIcon="label"
            />

            <Button
              type="button"
              variant="primary"
              className="w-full"
              loading={saving}
              leftIcon="bookmark_add"
              disabled={!validated.input}
              onClick={() => void saveScenario()}
            >
              Сохранить сценарий
            </Button>

            {saveError && (
              <p className="text-xs text-error" role="alert">
                {saveError}
              </p>
            )}
            {saveOk && (
              <p className="text-xs text-primary" role="status">
                {saveOk}
              </p>
            )}
          </form>
        </Card>

        {/* ── Result area ── */}
        <div className="space-y-4 min-w-0">
          {!shownResult && (
            <Card variant="default" padding="lg" className="border border-amber-500/15 rounded-2xl">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-amber-400/80">edit_note</span>
                <div className="min-w-0">
                  <p className="text-sm text-on-surface font-medium">Чтобы посчитать, не хватает данных</p>
                  <p className="text-xs text-on-surface-variant mt-1">
                    Ничего не выдумываем — заполните поля, и три сценария появятся сами, без нажатия кнопок.
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {validated.blockers.map((b) => (
                      <li key={b.fieldId + b.message}>
                        <button
                          type="button"
                          onClick={() => focusField(b.fieldId)}
                          className="flex items-start gap-2 text-left text-xs text-on-surface-variant hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded px-1 -mx-1 py-0.5"
                        >
                          <span className="material-symbols-outlined text-[14px] text-amber-400/80 mt-0.5">arrow_forward</span>
                          <span>
                            {b.message} <span className="text-primary underline underline-offset-2">перейти к полю</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          )}

          <AnimatePresence initial={false}>
            {shownResult && (
              <motion.div
                key="sim-result"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-4"
              >
                {isSnapshot && openedSaved && (
                  <Card variant="default" padding="sm" className="rounded-2xl border border-primary/25 bg-primary/[0.04]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-on-surface-variant">
                        Показан сохранённый расчёт «{openedSaved.title || SIM_TYPE_LABEL[openedSaved.sim_type] || openedSaved.sim_type}»
                        от {formatDate(openedSaved.updated_at)}. Исходные параметры того прогона список не отдаёт — форма слева
                        показывает текущие, они на этот расчёт не влияют.
                      </p>
                      <Button variant="secondary" size="sm" leftIcon="undo" onClick={() => setOpenedSaved(null)}>
                        К текущему расчёту
                      </Button>
                    </div>
                  </Card>
                )}

                {/* Confidence — now openable, and honestly labelled */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    aria-expanded={confidenceOpen}
                    aria-controls="sim-confidence-why"
                    onClick={() => setConfidenceOpen((v) => !v)}
                    className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <Badge variant={CONFIDENCE_META[shownResult.confidence].variant} dot>
                      Уверенность: {CONFIDENCE_META[shownResult.confidence].label}
                      <span className="material-symbols-outlined text-[14px] ml-0.5">
                        {confidenceOpen ? 'expand_less' : 'expand_more'}
                      </span>
                    </Badge>
                  </button>
                  <p className="text-[11px] text-on-surface-variant/80">{DISCLAIMER}</p>
                </div>

                {confidenceOpen && (
                  <Card id="sim-confidence-why" variant="default" padding="md" className="rounded-2xl border border-white/[0.04]">
                    <p className="text-xs text-on-surface font-medium">Что означает этот уровень</p>
                    <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">
                      Это полнота исходных данных, а не вероятность сценария. Модель не «уверена» в прогнозе — она лишь
                      отмечает, сколько ваших цифр удалось использовать.
                    </p>
                    {/* Checklist below reads the CURRENT form, so it is shown only
                        for the live calculation — a saved run's inputs are not
                        returned by the API and must not be faked from the form. */}
                    {isSnapshot ? (
                      <p className="text-xs text-on-surface-variant/70 mt-3 leading-relaxed">
                        Уровень относится к сохранённому прогону. Из каких именно полей он сложился, сказать нельзя:
                        сохранён только результат.
                      </p>
                    ) : (
                      <ul className="mt-3 space-y-1.5 text-xs text-on-surface-variant">
                        <li className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[14px] text-primary/70">
                            {validated.marginPct > 0 ? 'check_circle' : 'radio_button_unchecked'}
                          </span>
                          Маржа: {validated.marginPct > 0 ? `${validated.marginPct}%` : 'не указана'}
                        </li>
                        {simType === 'revenue_growth' ? (
                          <li className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[14px] text-primary/70">
                              {validated.input?.targetRevenueMonthly ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                            Цель по выручке:{' '}
                            {validated.input?.targetRevenueMonthly
                              ? formatMoney(validated.input.targetRevenueMonthly) + '/мес'
                              : 'не задана — темп берётся модельный'}
                          </li>
                        ) : (
                          <li className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[14px] text-primary/70">
                              {validated.fixedCostsRaw > 0 ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                            Фикс. затраты: {validated.fixedCostsRaw > 0 ? formatMoney(validated.fixedCostsRaw) + '/мес' : 'не указаны'}
                          </li>
                        )}
                      </ul>
                    )}
                  </Card>
                )}

                {modelRateWarning && (
                  <Card variant="default" padding="sm" className="rounded-2xl border border-amber-500/20">
                    <div className="flex items-start gap-2.5">
                      <span className="material-symbols-outlined text-[18px] text-amber-400/80 mt-0.5">warning</span>
                      <p className="text-xs text-on-surface-variant leading-relaxed">
                        Цель не задана — темп роста взят модельный, он не из ваших данных.{' '}
                        <button
                          type="button"
                          onClick={() => focusField('sim-target')}
                          className="text-primary underline underline-offset-2 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                        >
                          Задайте цель
                        </button>
                        , чтобы сценарий считался на вашей цифре.
                      </p>
                    </div>
                  </Card>
                )}

                {/* Three scenario cards — selectable, each shows the rate it was built on */}
                <div className="grid gap-3 sm:grid-cols-3">
                  {scenarioCards.map(({ key, sc }) => {
                    const g = appliedGrowth(sc)
                    const active = key === selectedScenario
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setSelectedScenario(key)
                          setExplainOpen(true)
                        }}
                        className={cn(
                          'text-left rounded-2xl border shadow-card p-4 transition-all bg-surface-container',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                          active
                            ? 'border-primary/40 bg-primary/[0.06]'
                            : 'border-white/[0.04] hover:border-primary/20',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <p
                            className={cn(
                              'text-[10px] font-mono uppercase tracking-[0.15em]',
                              active ? 'text-primary/90' : 'text-on-surface-variant/70',
                            )}
                          >
                            {sc.label}
                          </p>
                          {g !== null && (
                            <span className="text-[10px] font-mono text-on-surface-variant/70">{formatPct(g)}/мес</span>
                          )}
                        </div>
                        <div className="space-y-2.5">
                          <div>
                            <p className="text-[10px] text-on-surface-variant uppercase tracking-wider">Выручка в конце</p>
                            <p className="font-mono text-sm text-on-surface mt-0.5">{formatRange(sc.outcome.revenueEnd)}</p>
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
                        <p className="text-[10px] text-primary/70 mt-3">
                          {active ? 'Показан на графике · разбор ниже' : 'Показать на графике'}
                        </p>
                      </button>
                    )
                  })}
                </div>

                {/* Month-by-month chart for the SELECTED scenario */}
                {points.length > 0 && (
                  <Card variant="default" padding="md" className="rounded-2xl border border-white/[0.04] shadow-card">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <p className="text-[10px] font-mono text-on-surface-variant/70 uppercase tracking-[0.15em]">
                        {chartMetric === 'revenue' ? 'Выручка' : 'Прибыль'} по месяцам · {scenario?.label.toLowerCase()}
                      </p>
                      <div className="w-48">
                        <Segmented<ChartMetric>
                          ariaLabel="Что показывать на графике"
                          value={chartMetric}
                          onChange={(v) => setChartMetricOverride(v)}
                          options={[
                            { value: 'revenue', label: 'Выручка' },
                            { value: 'profit', label: 'Прибыль' },
                          ]}
                        />
                      </div>
                    </div>

                    {isCostReduction && chartMetric === 'revenue' && (
                      <p className="text-[11px] text-on-surface-variant/70 mb-3">
                        В сценарии снижения затрат рычаг — прибыль; выручка здесь почти не меняется.
                      </p>
                    )}

                    <p className="text-[10px] font-mono text-on-surface-variant/60 mb-2">
                      Шкала: {formatMoney(minV)} … {formatMoney(maxV)}
                    </p>

                    <div className="relative flex items-end gap-1.5 h-36">
                      {minV < 0 && (
                        <div
                          aria-hidden="true"
                          className="absolute left-0 right-0 border-t border-dashed border-white/15"
                          style={{ bottom: `${zeroPct}%` }}
                        />
                      )}
                      {points.map((p, i) => {
                        const v = barValues[i]
                        const bottom = ((Math.min(v, 0) - minV) / span) * 100
                        const h = Math.max(2, (Math.abs(v) / span) * 100)
                        const active = p.month === effectiveMonth
                        return (
                          <div key={p.month} className="flex-1 flex flex-col items-stretch gap-1 min-w-0 h-full">
                            <button
                              type="button"
                              aria-pressed={active}
                              aria-label={`Месяц ${p.month}: выручка ${formatRange(p.revenueRange)}, прибыль ${formatRange(p.cashRange)}`}
                              onClick={() => {
                                setSelectedMonth(p.month)
                                setExplainOpen(true)
                              }}
                              className="relative flex-1 w-full rounded-t-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 group"
                            >
                              <span
                                className={cn(
                                  'absolute left-0 right-0 rounded-t-md transition-colors',
                                  active
                                    ? 'bg-primary/70'
                                    : v < 0
                                      ? 'bg-error/40 group-hover:bg-error/60'
                                      : 'bg-primary/25 group-hover:bg-primary/45',
                                )}
                                style={{ bottom: `${bottom}%`, height: `${h}%` }}
                              />
                            </button>
                            <span
                              className={cn(
                                'text-[9px] font-mono text-center',
                                active ? 'text-primary' : 'text-on-surface-variant/60',
                              )}
                            >
                              М{p.month}
                            </span>
                          </div>
                        )
                      })}
                    </div>

                    {/* Screen-reader equivalent: the chart's data, not just its caption */}
                    <table className="sr-only">
                      <caption>
                        Помесячная проекция, сценарий «{scenario?.label}», горизонт {points.length} мес.
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Месяц</th>
                          <th scope="col">Выручка</th>
                          <th scope="col">Прибыль</th>
                        </tr>
                      </thead>
                      <tbody>
                        {points.map((p) => (
                          <tr key={p.month}>
                            <th scope="row">{p.month}</th>
                            <td>{formatRange(p.revenueRange)}</td>
                            <td>{formatRange(p.cashRange)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {activePoint && (
                      <div className="mt-4 pt-4 border-t border-white/[0.04] grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-[10px] text-on-surface-variant uppercase tracking-wider">
                            Месяц {effectiveMonth} · выручка
                          </p>
                          <p className="font-mono text-sm text-on-surface mt-0.5">{formatRange(activePoint.revenueRange)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-on-surface-variant uppercase tracking-wider">
                            Месяц {effectiveMonth} · прибыль
                          </p>
                          <p className="font-mono text-sm text-on-surface mt-0.5">{formatRange(activePoint.cashRange)}</p>
                        </div>
                      </div>
                    )}
                  </Card>
                )}

                {/* «Как посчитано» — the drill-down for the numbers above */}
                {breakdown.length > 0 && (
                  <Card variant="default" padding="md" className="rounded-2xl border border-white/[0.04] shadow-card">
                    <button
                      type="button"
                      aria-expanded={explainOpen}
                      aria-controls="sim-breakdown"
                      onClick={() => setExplainOpen((v) => !v)}
                      className="w-full flex items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg"
                    >
                      <span className="text-sm text-on-surface font-medium">
                        Как посчитано · {scenario?.label.toLowerCase()}, месяц {effectiveMonth}
                      </span>
                      <span className="material-symbols-outlined text-on-surface-variant">
                        {explainOpen ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>

                    {explainOpen && (
                      <div id="sim-breakdown" className="mt-4 space-y-3">
                        {costDriftNote && (
                          <p className="text-xs text-amber-400/90 leading-relaxed bg-amber-500/[0.06] border border-amber-500/15 rounded-xl p-3">
                            {costDriftNote}
                          </p>
                        )}
                        <dl className="space-y-2.5">
                          {breakdown.map((row) => (
                            <div key={row.term} className="grid gap-0.5 sm:grid-cols-[minmax(140px,180px),1fr] sm:gap-3">
                              <dt className="text-[11px] text-on-surface-variant uppercase tracking-wider">{row.term}</dt>
                              <dd className="min-w-0">
                                <p className="font-mono text-xs text-on-surface break-words">{row.value}</p>
                                {row.note && <p className="text-[11px] text-on-surface-variant/70 mt-0.5">{row.note}</p>}
                              </dd>
                            </div>
                          ))}
                        </dl>
                        <p className="text-[11px] text-on-surface-variant/70 leading-relaxed pt-1">
                          Выберите другой столбик на графике или другой сценарий — разбор пересчитается на него.
                        </p>
                      </div>
                    )}
                  </Card>
                )}

                {/* Assumptions + missing data */}
                <div className="grid gap-3 md:grid-cols-2">
                  {shownResult.assumptions.length > 0 && (
                    <Card variant="default" padding="md" className="rounded-2xl border border-white/[0.04]">
                      <p className="text-[10px] font-mono text-on-surface-variant/70 uppercase tracking-[0.15em] mb-3">
                        Допущения
                      </p>
                      <ul className="space-y-2">
                        {shownResult.assumptions.map((a, i) => (
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

                  {shownResult.missingData.length > 0 && (
                    <Card variant="default" padding="md" className="rounded-2xl border border-amber-500/15">
                      <p className="text-[10px] font-mono text-amber-400/80 uppercase tracking-[0.15em] mb-3">
                        Не хватает данных
                      </p>
                      <ul className="space-y-2">
                        {shownResult.missingData.map((m, i) => {
                          const target = MISSING_FIELD_MAP.find((x) => x.match.test(m))
                          return (
                            <li key={i}>
                              {target && !isSnapshot ? (
                                <button
                                  type="button"
                                  onClick={() => focusField(target.fieldId)}
                                  className="flex items-start gap-2 text-left text-xs text-on-surface-variant hover:text-on-surface leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded px-1 -mx-1 py-0.5"
                                >
                                  <span className="material-symbols-outlined text-[14px] text-amber-400/80 mt-0.5">help</span>
                                  <span>
                                    {m} <span className="text-primary underline underline-offset-2">заполнить</span>
                                  </span>
                                </button>
                              ) : (
                                <span className="flex items-start gap-2 text-xs text-on-surface-variant leading-relaxed">
                                  <span className="material-symbols-outlined text-[14px] text-amber-400/80 mt-0.5">help</span>
                                  {m}
                                </span>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </Card>
                  )}
                </div>

                {/* Where to go with this */}
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href="/point-b"
                    className="inline-flex items-center gap-2 rounded-lg border border-primary/20 text-primary px-3 py-1.5 text-xs font-semibold hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className="material-symbols-outlined text-[1.1em]">flag</span>
                    Сверить с Точкой Б
                  </Link>
                  <Link
                    href="/gri"
                    className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/30 text-on-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className="material-symbols-outlined text-[1.1em]">psychology</span>
                    Разобрать в ГРИ
                  </Link>
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
            <span
              className={cn(
                'text-[10px] font-mono uppercase tracking-wider',
                saved.length >= MAX_SAVED ? 'text-error' : 'text-on-surface-variant/60',
              )}
            >
              {saved.length} из {MAX_SAVED}
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
          <div className="py-2">
            <p className="text-xs text-on-surface-variant">
              Пока нет сохранённых симуляций. Расчёт на экране работает и без сохранения — сохраняйте то, к чему хотите
              вернуться.
            </p>
            <Button
              variant="secondary"
              size="sm"
              leftIcon="edit"
              className="mt-3"
              onClick={() => focusField('sim-revenue')}
            >
              Заполнить форму
            </Button>
          </div>
        ) : (
          <>
            {saved.length >= MAX_SAVED && (
              <p className="text-xs text-error mb-3" role="status">
                Лимит сохранений исчерпан. Удаление сохранённых прогонов пока не реализовано — расчёты на экране
                продолжают работать, но новые записи не сохранятся.
              </p>
            )}
            <ul className="divide-y divide-white/[0.04]">
              {saved.map((s) => {
                const opened = openedSaved?.id === s.id
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-pressed={opened}
                      disabled={!s.result}
                      onClick={() => {
                        setOpenedSaved(s)
                        setSelectedScenario('realistic')
                        setSelectedMonth(null)
                        // Drop the chart override: the saved run may be a different
                        // sim_type, which has a different sensible default metric.
                        setChartMetricOverride(null)
                        setExplainOpen(false)
                        document.getElementById('sim-confidence-why')?.scrollIntoView({ block: 'center' })
                      }}
                      className={cn(
                        'w-full flex items-center gap-3 py-3 px-2 -mx-2 rounded-xl text-left transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                        'disabled:opacity-60 disabled:cursor-not-allowed',
                        opened ? 'bg-primary/[0.06]' : 'hover:bg-white/[0.02]',
                      )}
                    >
                      <span className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-[18px] text-primary">
                          {SIM_TYPE_ICON[s.sim_type] ?? 'query_stats'}
                        </span>
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-on-surface truncate">
                          {s.title || SIM_TYPE_LABEL[s.sim_type] || s.sim_type}
                        </span>
                        <span className="block text-[11px] text-on-surface-variant mt-0.5">
                          {SIM_TYPE_LABEL[s.sim_type] ?? s.sim_type} · {formatDate(s.updated_at)} ·{' '}
                          {s.result ? (opened ? 'открыт' : 'открыть расчёт') : 'расчёт не сохранился'}
                        </span>
                      </span>
                      {s.result?.confidence && CONFIDENCE_META[s.result.confidence] && (
                        <Badge variant={CONFIDENCE_META[s.result.confidence].variant}>
                          <span className="sr-only">Уверенность: </span>
                          {CONFIDENCE_META[s.result.confidence].label}
                        </Badge>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}
