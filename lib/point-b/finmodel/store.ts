/**
 * lib/point-b/finmodel/store.ts — the «Финмодель»: what the owner and the expert typed
 * (pb_finmodel_inputs, migration 126) merged with what the platform already knows.
 *
 * Priority of a key's value, highest first:
 *   1. a stored value checked by an expert (status verified)
 *   2. a stored value typed by an expert
 *   3. a stored value typed by the owner
 *   4. the questionnaire (sources.ts: debt, days of payment, fixed costs)
 *   5. a platform metric (none is substituted today: cash_flow_mes is NOT cash on the account)
 *   6. the industry default — ONLY for tax_rate, dso_days, dio_days, dpo_days, listed in `defaulted`
 * There is no default for cash, payroll, fixed costs, debt, debt service, interest and capex: without them
 * `missing` is not empty and the model stays at level 1.
 *
 * Writes go through the service-role client only; the callers authorise the user / the expert first.
 * Every value is validated against FINMODEL_DEFS (a wrong value is an error with the field name, never
 * a silent trim). A value typed again is `entered` again — a check applies to the number that was checked.
 * A table that is not there yet (migration 126 not applied) reads as «nothing typed».
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertClean } from '@/lib/moderation/profanity'
import type { PointBInputs } from '../inputs'
import type { TemplateKey } from '../model/types'
import { DEFAULTABLE_KEYS, FINMODEL_DEFS, FINMODEL_KEYS, isFinmodelKey, templateDefaults, type FinmodelKey } from './keys'
import { finmodelFromSurvey, loadFinmodelFacts, NO_FACTS, type FinmodelFacts, type SurveyFinmodelValue } from './sources'

export type FinmodelOrigin = 'owner' | 'expert' | 'survey' | 'metric' | 'default'

export interface FinmodelValue {
  key: FinmodelKey
  value: number
  origin: FinmodelOrigin
  /** `auto` = not typed by a person (questionnaire, metric, industry default). */
  status: 'entered' | 'verified' | 'auto'
  period: string | null
  asOf: string | null
  note: string | null
  verifiedByName: string | null
  verifiedAt: string | null
  updatedAt: string | null
}

export interface FinmodelState {
  values: Partial<Record<FinmodelKey, FinmodelValue>>
  /** Hard inputs (and the conditional ones) without a value. */
  missing: FinmodelKey[]
  complete: boolean
  /** Keys whose value is the industry assumption. */
  defaulted: FinmodelKey[]
  /** Facts the model compares against (monthly, ₸). Absent in states built by hand. */
  facts?: FinmodelFacts
}

export type FinmodelErrorCode = 'invalid_value' | 'unknown_key' | 'not_found'

export class FinmodelError extends Error {
  constructor(public readonly code: FinmodelErrorCode, message: string, public readonly field?: string) {
    super(message)
    this.name = 'FinmodelError'
  }
}

/** A row of pb_finmodel_inputs. */
export interface FinmodelRow {
  key: string
  value: number | string
  period_key?: string | null
  as_of?: string | null
  origin: string
  status: string
  note?: string | null
  verified_by_name?: string | null
  verified_at?: string | null
  updated_at?: string | null
}

const isMissingTable = (code: string | undefined): boolean => code === '42P01' || code === 'PGRST205'

function dbError(op: string, error: { code?: string } | null | undefined): Error {
  return new Error(`point-b finmodel: ${op} failed (${error?.code ?? 'unknown'})`)
}

// ─── merge (pure) ───────────────────────────────────────────────────────────

function storedRank(r: FinmodelRow): number {
  if (r.status === 'verified') return 3
  return r.origin === 'expert' ? 2 : 1
}

function storedValue(r: FinmodelRow): FinmodelValue | null {
  const key = r.key
  const value = Number(r.value)
  if (!isFinmodelKey(key) || !Number.isFinite(value) || value < 0) return null
  const verified = r.status === 'verified'
  return {
    key,
    value,
    origin: r.origin === 'expert' ? 'expert' : 'owner',
    status: verified ? 'verified' : 'entered',
    period: r.period_key ? r.period_key : null,
    asOf: r.as_of ?? null,
    note: r.note ?? null,
    verifiedByName: verified ? r.verified_by_name ?? null : null,
    verifiedAt: verified ? r.verified_at ?? null : null,
    updatedAt: r.updated_at ?? null,
  }
}

/** The best stored row of a key: higher rank first, then the later period, then the later update. */
function bestStored(rows: FinmodelRow[]): FinmodelRow | null {
  let best: FinmodelRow | null = null
  const cmp = (a: FinmodelRow, b: FinmodelRow): number =>
    storedRank(a) - storedRank(b)
    || String(a.period_key ?? '').localeCompare(String(b.period_key ?? ''))
    || String(a.updated_at ?? '').localeCompare(String(b.updated_at ?? ''))
  for (const r of rows) if (best === null || cmp(r, best) > 0) best = r
  return best
}

export function mergeFinmodel(input: {
  rows: FinmodelRow[]
  survey: Partial<Record<FinmodelKey, SurveyFinmodelValue>>
  template: TemplateKey
  facts?: FinmodelFacts
}): FinmodelState {
  const values: FinmodelState['values'] = {}
  const defaults = templateDefaults(input.template)
  const defaulted: FinmodelKey[] = []

  for (const key of FINMODEL_KEYS) {
    const stored = bestStored(input.rows.filter((r) => r.key === key))
    const fromRow = stored ? storedValue(stored) : null
    if (fromRow) { values[key] = fromRow; continue }

    const s = input.survey[key]
    if (s) {
      values[key] = {
        key, value: s.value, origin: 'survey', status: 'auto', period: s.period, asOf: null, note: null,
        verifiedByName: null, verifiedAt: null, updatedAt: null,
      }
      continue
    }

    if ((DEFAULTABLE_KEYS as readonly FinmodelKey[]).includes(key)) {
      const value = defaults[key as keyof typeof defaults]
      values[key] = {
        key, value, origin: 'default', status: 'auto', period: null, asOf: null, note: null,
        verifiedByName: null, verifiedAt: null, updatedAt: null,
      }
      defaulted.push(key)
    }
  }

  const numeric: Partial<Record<FinmodelKey, number | null>> = {}
  for (const key of FINMODEL_KEYS) numeric[key] = values[key]?.value ?? null
  const missing = FINMODEL_KEYS.filter((key) => {
    if (values[key]) return false
    const def = FINMODEL_DEFS[key]
    return def.required || (def.requiredIf?.(numeric) ?? false)
  })
  return { values, missing, complete: missing.length === 0, defaulted, facts: input.facts ?? { ...NO_FACTS } }
}

/** The completeness of a state without its values (what `PointBState.finmodel` carries). */
export function finmodelStatus(state: FinmodelState | null | undefined): { complete: boolean; missing: FinmodelKey[]; defaulted: FinmodelKey[] } {
  if (!state) return { complete: false, missing: FINMODEL_KEYS.filter((k) => FINMODEL_DEFS[k].required), defaulted: [] }
  return { complete: state.complete, missing: [...state.missing], defaulted: [...state.defaulted] }
}

// ─── reads ──────────────────────────────────────────────────────────────────

const COLUMNS = 'key, value, period_key, as_of, origin, status, note, verified_by_name, verified_at, updated_at'

/** The rows people typed for a company; none when the table is not there yet. */
export async function readFinmodelRows(sb: SupabaseClient, companyId: string): Promise<FinmodelRow[]> {
  const { data, error } = await sb.from('pb_finmodel_inputs').select(COLUMNS).eq('company_id', companyId)
  if (error) {
    if (isMissingTable(error.code)) return []
    throw dbError('read', error)
  }
  return (data ?? []) as FinmodelRow[]
}

export async function loadFinmodel(
  sb: SupabaseClient,
  input: { companyId: string; template: TemplateKey; pb: Pick<PointBInputs, 'answers'> },
): Promise<FinmodelState> {
  const [rows, facts] = await Promise.all([
    readFinmodelRows(sb, input.companyId),
    loadFinmodelFacts(sb, input.companyId),
  ])
  return mergeFinmodel({ rows, survey: finmodelFromSurvey(input.pb.answers ?? {}), template: input.template, facts })
}

// ─── writes ─────────────────────────────────────────────────────────────────

export interface FinmodelInputValue {
  key: FinmodelKey
  value: number
  asOf?: string | null
  period?: string | null
  note?: string | null
}

const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2]))?$/
const NOTE_MAX = 500

function rangeText(key: FinmodelKey): string {
  const d = FINMODEL_DEFS[key]
  const fmt = (n: number): string => {
    const v = d.unit === '%' ? n * 100 : n
    return Number.isInteger(v) ? v.toLocaleString('ru-RU').replace(/ /g, ' ') : String(v)
  }
  const unit = d.unit === '%' ? '%' : d.unit === 'days' ? ' дн.' : ' ₸'
  return `от ${fmt(d.min)}${d.unit === '%' ? '%' : ''} до ${fmt(d.max)}${unit}`
}

/** Checks one entry; returns the clean row fields or throws FinmodelError with the field. */
function validateEntry(v: FinmodelInputValue): { key: FinmodelKey; value: number; asOf: string | null; period: string; note: string | null } {
  if (!v || !isFinmodelKey(v.key)) throw new FinmodelError('unknown_key', 'Неизвестный показатель финмодели', typeof v?.key === 'string' ? v.key : undefined)
  const def = FINMODEL_DEFS[v.key]
  if (typeof v.value !== 'number' || !Number.isFinite(v.value)) {
    throw new FinmodelError('invalid_value', `«${def.label}»: нужно число`, v.key)
  }
  if (v.value < def.min || v.value > def.max) {
    throw new FinmodelError('invalid_value', `«${def.label}»: допустимо ${rangeText(v.key)}`, v.key)
  }
  const asOf = v.asOf ?? null
  if (asOf !== null && (typeof asOf !== 'string' || !DATE_RE.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`)))) {
    throw new FinmodelError('invalid_value', `«${def.label}»: дата указана неверно (ГГГГ-ММ-ДД)`, 'asOf')
  }
  const period = v.period ?? ''
  if (typeof period !== 'string' || (period !== '' && !PERIOD_RE.test(period))) {
    throw new FinmodelError('invalid_value', `«${def.label}»: период указан неверно (ГГГГ или ГГГГ-ММ)`, 'period')
  }
  const note = typeof v.note === 'string' && v.note.trim() ? v.note.trim() : null
  if (v.note !== undefined && v.note !== null && typeof v.note !== 'string') {
    throw new FinmodelError('invalid_value', 'Комментарий должен быть текстом', 'note')
  }
  if (note !== null && note.length > NOTE_MAX) {
    throw new FinmodelError('invalid_value', `Комментарий не длиннее ${NOTE_MAX} символов`, 'note')
  }
  return { key: v.key, value: v.value, asOf, period, note }
}

/**
 * Saves the values the owner or an expert typed. All entries are checked first (nothing is written when
 * one is wrong; profanity in a note → ProfanityError with the field). A saved value is `entered`, its
 * origin is the actor's role, a previous check is cleared. Returns the saved values by key.
 */
export async function saveFinmodelValues(
  sb: SupabaseClient,
  input: {
    companyId: string
    actor: { id: string; role: 'owner' | 'expert'; name: string | null }
    values: FinmodelInputValue[]
  },
): Promise<FinmodelState['values']> {
  const clean = input.values.map(validateEntry)
  for (const c of clean) assertClean({ note: c.note })

  // One value per (key, period): the last of a repeated entry wins.
  const last = new Map<string, (typeof clean)[number]>()
  for (const c of clean) last.set(`${c.key}|${c.period}`, c)

  const saved: FinmodelState['values'] = {}
  for (const c of last.values()) {
    const { data, error } = await sb
      .from('pb_finmodel_inputs')
      .upsert(
        {
          company_id: input.companyId,
          key: c.key,
          value: c.value,
          period_key: c.period,
          as_of: c.asOf,
          origin: input.actor.role,
          status: 'entered',
          note: c.note,
          verified_by: null,
          verified_by_name: null,
          verified_at: null,
          updated_by: input.actor.id,
        },
        { onConflict: 'company_id,key,period_key' },
      )
      .select(COLUMNS)
    if (error) throw dbError('write', error)
    const row = ((data ?? []) as FinmodelRow[])[0]
    const value = row ? storedValue(row) : null
    if (value) saved[c.key] = value
  }
  return saved
}

/**
 * An expert confirms values that PEOPLE typed. A key without a stored row (empty, taken from the
 * questionnaire, a metric or the industry default) cannot be verified → FinmodelError('not_found').
 */
export async function verifyFinmodelValues(
  sb: SupabaseClient,
  input: { companyId: string; keys: FinmodelKey[]; reviewer: { id: string; name: string }; now?: Date },
): Promise<void> {
  const keys = [...new Set(input.keys)]
  for (const key of keys) {
    if (!isFinmodelKey(key)) throw new FinmodelError('unknown_key', 'Неизвестный показатель финмодели', String(key))
  }
  if (keys.length === 0) throw new FinmodelError('not_found', 'Не выбрано ни одного показателя')

  const { data, error } = await sb.from('pb_finmodel_inputs').select('key').eq('company_id', input.companyId).in('key', keys)
  if (error) throw dbError('read for verify', error)
  const stored = new Set(((data ?? []) as Array<{ key: string }>).map((r) => r.key))
  const absent = keys.filter((k) => !stored.has(k))
  if (absent.length) {
    const labels = absent.map((k) => `«${FINMODEL_DEFS[k].label}»`).join(', ')
    throw new FinmodelError('not_found', `Подтвердить можно только введённые значения; нет введённого значения: ${labels}`, absent[0])
  }

  const at = (input.now ?? new Date()).toISOString()
  const res = await sb
    .from('pb_finmodel_inputs')
    .update({ status: 'verified', verified_by: input.reviewer.id, verified_by_name: input.reviewer.name, verified_at: at })
    .eq('company_id', input.companyId)
    .in('key', keys)
  if (res.error) throw dbError('verify', res.error)
}
