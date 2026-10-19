/**
 * components/point-b/whatIfModel.ts — display and input logic of the «Что если» tab (plan Ф4 Task 4,
 * spec §10), free of React and of the DOM so it can be unit-tested. The expert's read-only panel
 * (User 360) reuses the parsing and the wording of this file.
 *
 * Contract it speaks (plan Ф4 «Контракты», Task 3):
 *   POST /api/v1/point-b/whatif { changes } → { ok, data: WhatIfResult }
 *   GET  /api/v1/point-b/whatif/saved → { ok, data: Array<{ id, name, note, changes, summary, modelVersion, proposedAt, createdAt }> }
 *   `summary` is written by the server: `{ level, delta }` (the key deltas of WhatIfResult['delta']); the parser also
 *   accepts the deltas placed at the top level of `summary`.
 *
 * The UI imports only TYPES and `WHATIF_LABELS` of the engine file — never the engine. Units: `budgetPct`, `pct`,
 * `cutPct` are percent numbers (10 = +10 %), `pp` is percentage points, `efficiency`, `demandElasticity` and
 * `revenueEffectPct` are fractions 0..1.
 *
 * No invented numbers: every figure comes from the result; a missing one is «—» with the reason, never 0.
 */
import { WHATIF_LABELS, type WhatIfChange, type WhatIfKind, type WhatIfMetrics, type WhatIfResult } from '@/lib/point-b/model/whatif'
import type { DataLevel } from '@/lib/point-b/model/types'
import { DASH, fmtMoney, fmtAxis, linePath, type Tone } from './overviewModel'
import { niceAxis } from './cashChartModel'

export const WHATIF_DISCLAIMER = 'Расчёт на ваших данных. Это не рекомендация и не меняет план'
export const NAME_MAX = 80
export const NOTE_MAX = 500
export const MAX_SAVED = 20
/** Pause after the last edit before the request is sent. */
export const DEBOUNCE_MS = 400

export const WHATIF_KINDS: readonly WhatIfKind[] = ['marketing', 'hire', 'avg_check', 'conversion', 'revenue_shock', 'fixed_costs']

export function isWhatIfKind(v: unknown): v is WhatIfKind {
  return typeof v === 'string' && (WHATIF_KINDS as readonly string[]).includes(v)
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const num = (v: unknown): number | null => (finite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [])

// ── Calculators (ranges mirror the contract of the plan) ────────────────

export interface ParamDef {
  /** The field of {@link WhatIfChange}. */
  key: string
  label: string
  /** Shown after the value: «%», «п.п.», «чел.», «мес.», «₸» or '' for a bare coefficient. */
  unit: string
  min: number
  max: number
  step: number
  default: number
  integer?: boolean
  /** A secondary parameter: an explicit assumption of the calculator, shown smaller. */
  advanced?: boolean
  hint?: string
}

export interface CalculatorDef {
  kind: WhatIfKind
  title: string
  /** One sentence: what the calculator moves. */
  blurb: string
  /** The default assumption in words (also repeated in the result's «Допущения»). */
  assumption: string
  params: ParamDef[]
}

export const CALCULATORS: Record<WhatIfKind, CalculatorDef> = {
  marketing: {
    kind: 'marketing',
    title: WHATIF_LABELS.marketing,
    blurb: 'Что будет, если изменить бюджет на привлечение клиентов.',
    assumption: 'Затраты растут пропорционально бюджету, а заявки — с учётом эффективности вложений.',
    params: [
      { key: 'budgetPct', label: 'Изменение бюджета', unit: '%', min: -50, max: 100, step: 5, default: 20 },
      { key: 'efficiency', label: 'Эффективность вложений', unit: '', min: 0.3, max: 1, step: 0.05, default: 0.7, advanced: true, hint: 'Допущение: какая доля прироста бюджета превращается в прирост заявок.' },
    ],
  },
  hire: {
    kind: 'hire',
    title: WHATIF_LABELS.hire,
    blurb: 'Что будет с деньгами, если нанять сотрудников.',
    assumption: 'Стоимость сотрудника — средний фонд оплаты труда на человека. Выручку найм сам по себе не увеличивает.',
    params: [
      { key: 'count', label: 'Сколько человек', unit: 'чел.', min: 1, max: 20, step: 1, default: 2, integer: true },
      { key: 'startMonth', label: 'С какого месяца', unit: 'мес.', min: 1, max: 60, step: 1, default: 1, integer: true },
      { key: 'revenueEffectPct', label: 'Выручка от сотрудника', unit: '', min: 0, max: 1, step: 0.05, default: 0, advanced: true, hint: 'Допущение: доля средней выручки на сотрудника, которую приносит новый. 0 — найм выручку не растит.' },
    ],
  },
  avg_check: {
    kind: 'avg_check',
    title: WHATIF_LABELS.avg_check,
    blurb: 'Что будет, если поднять или снизить средний чек.',
    assumption: 'Рост чека частично снижает конверсию: насколько — задаёт эластичность спроса.',
    params: [
      { key: 'pct', label: 'Изменение чека', unit: '%', min: -30, max: 50, step: 1, default: 10 },
      { key: 'demandElasticity', label: 'Эластичность спроса', unit: '', min: 0, max: 1, step: 0.05, default: 0.3, advanced: true, hint: 'Допущение: на сколько процентов падает конверсия при росте чека на 1 %.' },
    ],
  },
  conversion: {
    kind: 'conversion',
    title: WHATIF_LABELS.conversion,
    blurb: 'Что будет, если доля заявок, дошедших до оплаты, изменится.',
    assumption: 'Изменение вводится постепенно в течение срока выхода на целевой уровень.',
    params: [
      { key: 'pp', label: 'Изменение конверсии', unit: 'п.п.', min: -10, max: 20, step: 0.5, default: 2 },
    ],
  },
  revenue_shock: {
    kind: 'revenue_shock',
    title: WHATIF_LABELS.revenue_shock,
    blurb: 'Стресс-тест: что будет с деньгами, если выручка просядет.',
    assumption: 'Затраты не меняются, себестоимость остаётся пропорциональной выручке.',
    params: [
      { key: 'pct', label: 'Падение выручки', unit: '%', min: -60, max: 0, step: 5, default: -20 },
      { key: 'startMonth', label: 'С какого месяца', unit: 'мес.', min: 1, max: 60, step: 1, default: 2, integer: true },
      { key: 'durationMonths', label: 'Сколько месяцев', unit: 'мес.', min: 1, max: 24, step: 1, default: 3, integer: true },
    ],
  },
  fixed_costs: {
    kind: 'fixed_costs',
    title: WHATIF_LABELS.fixed_costs,
    blurb: 'Что будет, если сократить постоянные расходы.',
    assumption: 'Экономия начинается с выбранного месяца; разовые затраты на сокращение учитываются в месяц начала.',
    params: [
      { key: 'cutPct', label: 'Сокращение расходов', unit: '%', min: 0, max: 50, step: 1, default: 10 },
      { key: 'startMonth', label: 'С какого месяца', unit: 'мес.', min: 1, max: 60, step: 1, default: 1, integer: true },
      { key: 'oneOffCost', label: 'Разовые затраты на сокращение', unit: '₸', min: 0, max: 1_000_000_000, step: 10_000, default: 0, advanced: true, hint: 'Допущение: сколько стоит само сокращение (выходные пособия, расторжение аренды).' },
    ],
  },
}

// ── The draft: what the owner has switched on and typed ─────────────────

export interface CardDraft { enabled: boolean; values: Record<string, string> }
export type Draft = Record<WhatIfKind, CardDraft>

export function numberText(n: number): string {
  return String(n).replace('.', ',')
}

function cardDefaults(kind: WhatIfKind): Record<string, string> {
  return Object.fromEntries(CALCULATORS[kind].params.map((p) => [p.key, numberText(p.default)]))
}

export function defaultCard(kind: WhatIfKind): CardDraft {
  return { enabled: false, values: cardDefaults(kind) }
}

export function defaultDraft(): Draft {
  return Object.fromEntries(WHATIF_KINDS.map((k) => [k, defaultCard(k)])) as Draft
}

/** «−5», «+1,5», « 2 000» → number; null when it is not a number. */
export function parseNumberText(text: string): number | null {
  const cleaned = text.replace(/[\s  ]/g, '').replace(/[−–—]/g, '-').replace(',', '.').replace(/^\+/, '')
  if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

const fmtBound = (n: number): string => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

export function validateParam(def: ParamDef, text: string): { ok: true; value: number } | { ok: false; error: string } {
  const n = parseNumberText(text)
  if (n === null) return { ok: false, error: 'Введите число' }
  if (def.integer && !Number.isInteger(n)) return { ok: false, error: 'Введите целое число' }
  if (n < def.min || n > def.max) {
    const unit = def.unit ? ` ${def.unit}` : ''
    return { ok: false, error: `Допустимо от ${fmtBound(def.min)} до ${fmtBound(def.max)}${unit}` }
  }
  return { ok: true, value: n }
}

export type CardErrors = Partial<Record<WhatIfKind, { params: Record<string, string>; general: string | null }>>

export interface BuiltChanges { changes: WhatIfChange[]; kinds: WhatIfKind[]; errors: CardErrors }

/**
 * The changes to send: the enabled calculators in the fixed order of {@link WHATIF_KINDS}, values validated.
 * A calculator the server reported as not applicable is left out. Errors are per calculator and parameter.
 */
export function buildChanges(draft: Draft, applicable?: Partial<Record<WhatIfKind, { ok: boolean }>> | null): BuiltChanges {
  const out: BuiltChanges = { changes: [], kinds: [], errors: {} }
  for (const kind of WHATIF_KINDS) {
    const card = draft[kind]
    if (!card.enabled || applicable?.[kind]?.ok === false) continue
    const values: Record<string, number> = {}
    const params: Record<string, string> = {}
    for (const def of CALCULATORS[kind].params) {
      const r = validateParam(def, card.values[def.key] ?? '')
      if (r.ok) values[def.key] = r.value
      else params[def.key] = r.error
    }
    if (Object.keys(params).length) {
      out.errors[kind] = { params, general: null }
      continue
    }
    out.changes.push({ kind, ...values } as WhatIfChange)
    out.kinds.push(kind)
  }
  return out
}

export const hasErrors = (e: CardErrors): boolean => Object.keys(e).length > 0

/** Changes (a saved scenario) → a draft with these calculators switched on, the others at defaults. */
export function draftFromChanges(changes: WhatIfChange[]): Draft {
  const draft = defaultDraft()
  for (const c of changes) {
    const card = draft[c.kind]
    if (!card) continue
    card.enabled = true
    for (const def of CALCULATORS[c.kind].params) {
      const v = (c as unknown as Record<string, unknown>)[def.key]
      if (finite(v)) card.values[def.key] = numberText(v)
    }
  }
  return draft
}

export function enabledKinds(draft: Draft): WhatIfKind[] {
  return WHATIF_KINDS.filter((k) => draft[k].enabled)
}

/**
 * `changes[1].pp` of a server 400 → the calculator and the parameter. The index is the position in the array
 * that was SENT (`kinds`). null = the field is not about a calculator.
 */
export function mapServerField(field: unknown, kinds: readonly WhatIfKind[]): { kind: WhatIfKind; param: string | null } | null {
  if (typeof field !== 'string') return null
  const m = /^changes\[(\d+)\](?:\.([A-Za-z]+))?$/.exec(field)
  if (!m) return null
  const kind = kinds[Number(m[1])]
  if (!kind) return null
  const param = m[2] && CALCULATORS[kind].params.some((p) => p.key === m[2]) ? m[2] : null
  return { kind, param }
}

// ── Wording of a change ─────────────────────────────────────────────────

/** «+10», «−20», «0» — a signed number with the typographic minus. */
export function fmtSigned(n: number, digits = 1): string {
  if (!finite(n)) return DASH
  const s = Math.abs(n).toLocaleString('ru-RU', { maximumFractionDigits: digits })
  if (n > 0) return `+${s}`
  if (n < 0 && s !== '0') return `−${s}`
  return s
}

/** One short phrase for a change; used in the saved list, in the expert's panel and in the proposal. */
export function describeChange(c: WhatIfChange): string {
  switch (c.kind) {
    case 'marketing': return `Маркетинг ${fmtSigned(c.budgetPct, 1)}%`
    case 'hire': return `Найм: ${c.count} чел. с месяца ${c.startMonth}`
    case 'avg_check': return `Средний чек ${fmtSigned(c.pct, 1)}%`
    case 'conversion': return `Конверсия ${fmtSigned(c.pp, 1)} п.п.`
    case 'revenue_shock': return `Падение выручки ${fmtSigned(c.pct, 1)}% на ${c.durationMonths} мес. с месяца ${c.startMonth}`
    case 'fixed_costs': return `Постоянные расходы −${c.cutPct.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}% с месяца ${c.startMonth}`
  }
}

export function describeChanges(changes: WhatIfChange[]): string {
  return changes.length ? changes.map(describeChange).join('; ') : 'Без изменений'
}

/** Slider text for screen readers: «+20 %», «2 чел.», «0,7». */
export function valueText(def: ParamDef, text: string): string {
  const n = parseNumberText(text)
  if (n === null) return 'не задано'
  const signed = def.unit === '%' || def.unit === 'п.п.'
  const body = signed ? fmtSigned(n, 2) : n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
  return def.unit ? `${body} ${def.unit}` : body
}

// ── Parsing the server ──────────────────────────────────────────────────

const METRIC_KEYS: ReadonlyArray<keyof WhatIfMetrics> = [
  'annualRunRateAtDeadline', 'revenueFirst12m', 'timeToGoalMonths', 'minCash', 'cashGapMonth', 'fundingNeed', 'ebitdaFirst12m',
]

function parseMetrics(v: unknown): WhatIfMetrics {
  const m = isObj(v) ? v : {}
  const mc = isObj(m.minCash) ? m.minCash : null
  const minValue = mc ? num(mc.value) : null
  const minMonth = mc ? num(mc.month) : null
  return {
    annualRunRateAtDeadline: num(m.annualRunRateAtDeadline),
    revenueFirst12m: num(m.revenueFirst12m),
    timeToGoalMonths: num(m.timeToGoalMonths),
    minCash: minValue !== null && minMonth !== null ? { value: minValue, month: minMonth } : null,
    cashGapMonth: num(m.cashGapMonth),
    fundingNeed: num(m.fundingNeed),
    ebitdaFirst12m: num(m.ebitdaFirst12m),
  }
}

function parseDelta(v: unknown): WhatIfResult['delta'] {
  const d = isObj(v) ? v : {}
  const out: WhatIfResult['delta'] = {}
  for (const k of METRIC_KEYS) if (k in d) out[k] = num(d[k])
  return out
}

function numArray(v: unknown): number[] {
  return Array.isArray(v) ? v.filter(finite) : []
}

/** Tolerant: a field the server did not send becomes an empty value, never a crash and never NaN. */
export function parseWhatIfResult(v: unknown): WhatIfResult | null {
  if (!isObj(v) || !isObj(v.baseline) || !isObj(v.changed)) return null
  const s = isObj(v.series) ? v.series : {}
  const months = numArray(s.months)
  const baseline = numArray(s.baseline)
  const changed = numArray(s.changed)
  const sameLength = months.length === baseline.length && months.length === changed.length
  const app = isObj(v.applicable) ? v.applicable : {}
  const applicable = Object.fromEntries(WHATIF_KINDS.map((k) => {
    const a = isObj(app[k]) ? (app[k] as Record<string, unknown>) : null
    return [k, { ok: a ? a.ok !== false : true, reason: a ? str(a.reason) : null }]
  })) as WhatIfResult['applicable']
  const contributions = (Array.isArray(v.contributions) ? v.contributions : []).filter(isObj)
    .filter((c) => isWhatIfKind(c.kind))
    .map((c) => ({ kind: c.kind as WhatIfKind, label: str(c.label) ?? WHATIF_LABELS[c.kind as WhatIfKind], delta: parseDelta(c.delta) }))
  return {
    modelVersion: str(v.modelVersion) ?? '',
    level: v.level === 1 || v.level === 2 ? v.level : 0,
    computedAt: str(v.computedAt) ?? '',
    baseline: parseMetrics(v.baseline),
    changed: parseMetrics(v.changed),
    delta: parseDelta(v.delta),
    contributions,
    interaction: parseDelta(v.interaction),
    series: sameLength ? { months, baseline, changed, target: num(s.target) } : { months: [], baseline: [], changed: [], target: num(s.target) },
    explanation: strArr(v.explanation),
    riskFlags: strArr(v.riskFlags),
    assumptions: strArr(v.assumptions),
    warnings: strArr(v.warnings),
    applicable,
  }
}

/** `{ ok, data: WhatIfResult }` of POST /whatif. */
export function parseWhatIfResponse(body: unknown): WhatIfResult | null {
  if (!isObj(body) || body.ok === false) return null
  return parseWhatIfResult(body.data)
}

const PARAM_KEYS: Record<WhatIfKind, string[]> = Object.fromEntries(
  WHATIF_KINDS.map((k) => [k, CALCULATORS[k].params.map((p) => p.key)]),
) as Record<WhatIfKind, string[]>

/** Changes as stored: unknown kinds and changes without a required number are dropped. */
export function parseChanges(v: unknown): WhatIfChange[] {
  const out: WhatIfChange[] = []
  for (const raw of Array.isArray(v) ? v : []) {
    if (!isObj(raw) || !isWhatIfKind(raw.kind)) continue
    const kind = raw.kind
    const copy: Record<string, unknown> = { kind }
    let complete = true
    for (const def of CALCULATORS[kind].params) {
      const n = num(raw[def.key])
      if (n !== null) copy[def.key] = n
      else if (!def.advanced) complete = false
    }
    if (complete && PARAM_KEYS[kind].length) out.push(copy as unknown as WhatIfChange)
  }
  return out
}

export interface SavedSummary { level: DataLevel | null; delta: WhatIfResult['delta'] }

export interface SavedWhatIf {
  id: string
  name: string
  note: string | null
  changes: WhatIfChange[]
  summary: SavedSummary
  modelVersion: string
  proposedAt: string | null
  createdAt: string | null
}

function parseSummary(v: unknown): SavedSummary {
  const s = isObj(v) ? v : {}
  return { level: s.level === 0 || s.level === 1 || s.level === 2 ? s.level : null, delta: parseDelta(isObj(s.delta) ? s.delta : s) }
}

export function parseSaved(v: unknown): SavedWhatIf | null {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id) return null
  return {
    id: v.id,
    name: str(v.name) ?? 'Без названия',
    note: str(v.note),
    changes: parseChanges(v.changes),
    summary: parseSummary(v.summary),
    modelVersion: str(v.modelVersion) ?? '',
    proposedAt: str(v.proposedAt),
    createdAt: str(v.createdAt),
  }
}

/** `{ ok, data: [...] }` of the saved list; null = unreadable. */
export function parseSavedList(body: unknown): SavedWhatIf[] | null {
  if (!isObj(body) || body.ok === false || !Array.isArray(body.data)) return null
  return body.data.map(parseSaved).filter((s): s is SavedWhatIf => !!s)
}

// ── The comparison «Сейчас → При изменении → Δ» ─────────────────────────

export interface CompareRow {
  id: keyof WhatIfMetrics
  label: string
  now: string
  changed: string
  delta: string
  tone: Tone
  /** A row that needs the finmodel (level 2). */
  money: boolean
  /** Why a value is missing, when it is. */
  note: string | null
}

const LABEL: Record<keyof WhatIfMetrics, string> = {
  annualRunRateAtDeadline: 'Выручка к сроку цели (в год)',
  revenueFirst12m: 'Выручка за 12 месяцев',
  timeToGoalMonths: 'Срок достижения цели',
  minCash: 'Минимальная касса',
  cashGapMonth: 'Кассовый разрыв',
  fundingNeed: 'Потребность в финансировании',
  ebitdaFirst12m: 'Операционная прибыль за 12 месяцев',
}

const ROW_ORDER: ReadonlyArray<keyof WhatIfMetrics> = [
  'annualRunRateAtDeadline', 'revenueFirst12m', 'timeToGoalMonths', 'minCash', 'cashGapMonth', 'fundingNeed', 'ebitdaFirst12m',
]
const MONEY_ROWS: ReadonlySet<keyof WhatIfMetrics> = new Set(['minCash', 'cashGapMonth', 'fundingNeed', 'ebitdaFirst12m'])

export const MONEY_LOCKED_TEXT = 'Откроется после заполнения финмодели'

const months = (n: number): string => `${Math.round(n)} мес.`
const moneyDelta = (d: number): string => (Math.abs(d) < 0.5 ? 'без изменений' : `${d > 0 ? '+' : ''}${fmtMoney(d)}`)
const toneOf = (d: number | null, higherIsBetter: boolean): Tone => (d === null || Math.abs(d) < 0.5 ? 'neutral' : (d > 0) === higherIsBetter ? 'good' : 'bad')

function pctOf(base: number | null, d: number | null): string {
  if (base === null || d === null || !(base > 0) || Math.abs(d) < 0.5) return ''
  return ` (${fmtSigned((d / base) * 100, 1)}%)`
}

function deltaOf(result: WhatIfResult, key: 'annualRunRateAtDeadline' | 'revenueFirst12m' | 'fundingNeed' | 'ebitdaFirst12m' | 'timeToGoalMonths'): number | null {
  const given = result.delta[key]
  if (finite(given)) return given
  const a = result.baseline[key]
  const b = result.changed[key]
  return a !== null && b !== null ? b - a : null
}

/** Rows of the comparison; `horizon` is the last month of the series (for «не достигается за N мес.»). */
export function compareRows(result: WhatIfResult): CompareRow[] {
  const { baseline: b, changed: c } = result
  const horizon = result.series.months.length ? Math.max(...result.series.months) : null
  const noGoal = result.series.target === null
  const rows: CompareRow[] = []

  for (const id of ROW_ORDER) {
    const money = MONEY_ROWS.has(id)
    const base = { id, label: LABEL[id], money, note: null as string | null }
    if (id === 'annualRunRateAtDeadline' || id === 'revenueFirst12m' || id === 'fundingNeed' || id === 'ebitdaFirst12m') {
      const d = deltaOf(result, id)
      const higherBetter = id !== 'fundingNeed'
      rows.push({
        ...base,
        now: fmtMoney(b[id]),
        changed: fmtMoney(c[id]),
        delta: d === null ? DASH : `${moneyDelta(d)}${id === 'annualRunRateAtDeadline' || id === 'revenueFirst12m' ? pctOf(b[id], d) : ''}`,
        tone: toneOf(d, higherBetter),
        note: b[id] === null || c[id] === null ? 'Не хватает данных для этого показателя' : null,
      })
    } else if (id === 'timeToGoalMonths') {
      const unreachable = noGoal ? DASH : `не достигается${horizon !== null ? ` за ${months(horizon)}` : ''}`
      const bt = b.timeToGoalMonths
      const ct = c.timeToGoalMonths
      let delta = DASH
      let tone: Tone = 'neutral'
      if (!noGoal) {
        if (bt !== null && ct !== null) {
          const d = ct - bt
          delta = Math.abs(d) < 0.5 ? 'без изменений' : `${fmtSigned(d, 0)} мес. (${d < 0 ? 'раньше' : 'позже'})`
          tone = toneOf(d, false)
        } else if (bt === null && ct !== null) { delta = 'цель становится достижимой'; tone = 'good' }
        else if (bt !== null && ct === null) { delta = 'цель перестаёт достигаться'; tone = 'bad' }
        else delta = 'без изменений'
      }
      rows.push({
        ...base,
        now: bt === null ? unreachable : months(bt),
        changed: ct === null ? unreachable : months(ct),
        delta,
        tone,
        note: noGoal ? 'Цель не задана' : null,
      })
    } else if (id === 'minCash') {
      const d = b.minCash && c.minCash ? c.minCash.value - b.minCash.value : null
      rows.push({
        ...base,
        now: b.minCash ? `${fmtMoney(b.minCash.value)}, месяц ${Math.round(b.minCash.month)}` : DASH,
        changed: c.minCash ? `${fmtMoney(c.minCash.value)}, месяц ${Math.round(c.minCash.month)}` : DASH,
        delta: d === null ? DASH : moneyDelta(d),
        tone: toneOf(d, true),
        note: !b.minCash || !c.minCash ? 'Не хватает данных финмодели' : null,
      })
    } else {
      const bg = b.cashGapMonth
      const cg = c.cashGapMonth
      const text = (m: number | null) => (m === null ? 'нет разрыва' : `в месяце ${Math.round(m)}`)
      let delta = 'без изменений'
      let tone: Tone = 'neutral'
      if (bg === null && cg !== null) { delta = `появляется в месяце ${Math.round(cg)}`; tone = 'bad' }
      else if (bg !== null && cg === null) { delta = 'исчезает'; tone = 'good' }
      else if (bg !== null && cg !== null && Math.round(cg) !== Math.round(bg)) {
        const d = cg - bg
        delta = `${fmtSigned(d, 0)} мес. (${d > 0 ? 'позже' : 'раньше'})`
        tone = d > 0 ? 'good' : 'bad'
      }
      rows.push({ ...base, now: text(bg), changed: text(cg), delta, tone })
    }
  }
  return rows
}

/** A short list of «what the change gives», for a contribution or the interaction. */
export function deltaLines(delta: WhatIfResult['delta'], level: DataLevel): string[] {
  const lines: string[] = []
  const rev = delta.annualRunRateAtDeadline
  if (finite(rev) && Math.abs(rev) >= 0.5) lines.push(`Выручка к сроку ${moneyDelta(rev)}`)
  const t = delta.timeToGoalMonths
  if (finite(t) && Math.abs(t) >= 0.5) lines.push(`Срок цели ${fmtSigned(t, 0)} мес.`)
  if (level >= 2) {
    const mc = delta.minCash
    if (finite(mc) && Math.abs(mc) >= 0.5) lines.push(`Минимальная касса ${moneyDelta(mc)}`)
    const fn = delta.fundingNeed
    if (finite(fn) && Math.abs(fn) >= 0.5) lines.push(`Потребность в финансировании ${moneyDelta(fn)}`)
    const eb = delta.ebitdaFirst12m
    if (finite(eb) && Math.abs(eb) >= 0.5) lines.push(`Операционная прибыль за 12 месяцев ${moneyDelta(eb)}`)
  }
  return lines
}

/** The result of a change as the expert reads it in the saved list. */
export function savedDeltaLines(s: SavedWhatIf): string[] {
  return deltaLines(s.summary.delta, s.summary.level ?? 1)
}

// ── Chart ───────────────────────────────────────────────────────────────

export interface WhatIfChartGeometry {
  width: number
  height: number
  plot: { left: number; right: number; top: number; bottom: number }
  baseLine: string
  changedLine: string
  targetY: number | null
  /** Month values of the series, ascending, one x per point. */
  months: number[]
  xs: number[]
  yTicks: Array<{ y: number; label: string }>
  xTicks: Array<{ x: number; label: string }>
}

const X_STEPS = [1, 2, 3, 6, 12, 24, 36, 60]

/** Geometry of the two run-rate lines and the goal line. Never NaN; a series that cannot be drawn gives null. */
export function whatIfChartGeometry(series: WhatIfResult['series'], width: number, height: number): WhatIfChartGeometry | null {
  const { months: ms, baseline, changed, target } = series
  const n = ms.length
  if (n < 2 || baseline.length !== n || changed.length !== n) return null
  if (![...ms, ...baseline, ...changed].every(finite)) return null
  const first = ms[0]
  const last = ms[n - 1]
  if (!(last > first)) return null
  const W = Math.min(1200, Math.max(280, finite(width) ? width : 640))
  const H = Math.max(160, finite(height) ? height : 260)
  const plot = { left: 56, right: W - 14, top: 14, bottom: H - 30 }

  const hasTarget = finite(target) && target > 0
  const all = [...baseline, ...changed, ...(hasTarget ? [target as number] : [])]
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const axis = niceAxis(lo > 0 ? lo * 0.9 : lo, hi)
  if (!axis) return null
  const x = (m: number) => plot.left + ((m - first) / (last - first)) * (plot.right - plot.left)
  const y = (v: number) => plot.top + (1 - (v - axis.lo) / (axis.hi - axis.lo)) * (plot.bottom - plot.top)
  const xs = ms.map(x)

  const xStep = X_STEPS.find((s) => (last - first) / s <= 6) ?? 60
  const xTicks: WhatIfChartGeometry['xTicks'] = []
  for (let m = first; m <= last + 1e-9; m += xStep) xTicks.push({ x: x(m), label: m === 0 ? 'сейчас' : `${m} мес.` })

  return {
    width: W,
    height: H,
    plot,
    baseLine: linePath(ms.map((m, i): [number, number] => [x(m), y(baseline[i])])),
    changedLine: linePath(ms.map((m, i): [number, number] => [x(m), y(changed[i])])),
    targetY: hasTarget ? y(target as number) : null,
    months: ms,
    xs,
    yTicks: axis.ticks.map((v) => ({ y: y(v), label: fmtAxis(v) })),
    xTicks,
  }
}

/** Index of the point under a pointer at `x`. */
export function nearestPoint(geo: Pick<WhatIfChartGeometry, 'xs'>, x: number): number | null {
  if (!finite(x) || geo.xs.length === 0) return null
  let best = 0
  for (let i = 1; i < geo.xs.length; i++) if (Math.abs(geo.xs[i] - x) < Math.abs(geo.xs[best] - x)) best = i
  return best
}

export function chartReadout(series: WhatIfResult['series'], index: number): string {
  const i = Math.min(series.months.length - 1, Math.max(0, index))
  const month = series.months[i]
  const b = series.baseline[i]
  const c = series.changed[i]
  if (!finite(month) || !finite(b) || !finite(c)) return DASH
  const d = c - b
  return `${month === 0 ? 'Сейчас' : `Месяц ${month}`}: сейчас ${fmtMoney(b)}, при изменении ${fmtMoney(c)}${Math.abs(d) >= 0.5 ? ` (${d > 0 ? '+' : ''}${fmtMoney(d)})` : ''}`
}

export function chartSummary(series: WhatIfResult['series']): string {
  const n = series.months.length
  if (n < 2) return 'График годового темпа выручки недоступен'
  const last = n - 1
  const parts = [
    `Годовой темп выручки по месяцам: сейчас ${fmtMoney(series.baseline[0])}`,
    `к месяцу ${series.months[last]} без изменений ${fmtMoney(series.baseline[last])}, с изменениями ${fmtMoney(series.changed[last])}`,
  ]
  if (series.target !== null) parts.push(`цель ${fmtMoney(series.target)}`)
  return parts.join('; ')
}

// ── Level 0 ─────────────────────────────────────────────────────────────

export const LEVEL0_TEXT =
  'Чтобы считать «что если», нужна хотя бы текущая выручка за год. Пока её нет, мы не подставляем выдуманные цифры. Добавьте данные ниже, и калькуляторы откроются.'
