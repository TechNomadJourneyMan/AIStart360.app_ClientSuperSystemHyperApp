/**
 * lib/point-b/planfact/store.ts — the tables of the plan-fact (migration 132; spec §13–§14). Service-role client
 * only; the callers authorise the user / company first.
 *
 *   validateMonthlyFacts  the «Факт за месяц» form: a month that is over or running (not the future, at most 24
 *                         months back), only the KPIs of the approved plan, numbers in range, a clean note
 *   saveMonthlyFacts      upsert by (company, month, KPI), source «ежемесячная сверка»; null clears a value
 *   loadMonthlyFacts      the reconciliation facts of a company since a month
 *   upsertCheckpoints     one row per (version, month): the recompute rewrites it
 *   listCheckpoints       the newest months of a version (or of the company)
 *   startRun / finishRun  the journal pb_runs; lastManualRun — the «once in 10 minutes» of the button
 *
 * Migration 132 not applied: reads give empty results through `isMissingTable` at the callers; writes throw
 * PlanFactError('not_ready').
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertClean } from '@/lib/moderation/profanity'
import { KPI_META, PERIOD_RE, periodOf, periodOrdinal } from './kpis'
import { PLAN_KPIS, type Checkpoint, type KpiValues, type PlanFactVerdict, type PlanKpi } from './types'

export const MONTHLY_SOURCE = 'monthly_reconciliation'
export const MONTHLY_SOURCE_LABEL = 'Ежемесячная сверка'
export const MAX_MONTHS_BACK = 24
export const NOTE_MAX = 500

export type PlanFactErrorCode = 'invalid' | 'not_ready' | 'no_plan'

export class PlanFactError extends Error {
  constructor(public readonly code: PlanFactErrorCode, message: string, public readonly field?: string) {
    super(message)
    this.name = 'PlanFactError'
  }
}

export const isMissingTable = (message: string): boolean => /\((42P01|PGRST205)\)/.test(message)

function dbError(op: string, error: { code?: string } | null | undefined): Error {
  const code = error?.code ?? 'unknown'
  if (code === '42P01' || code === 'PGRST205') return new PlanFactError('not_ready', `point-b plan-fact: ${op} failed (${code})`)
  return new Error(`point-b plan-fact: ${op} failed (${code})`)
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

// ── «Факт за месяц» ─────────────────────────────────────────────────────

export interface MonthlyFactsInput {
  period: unknown
  values: unknown
  note?: unknown
}

export interface ValidMonthlyFacts {
  period: string
  /** null = clear the value of this KPI. */
  values: Partial<Record<PlanKpi, number | null>>
  note: string | null
}

export function validateMonthlyFacts(input: MonthlyFactsInput, opts: { kpis: readonly PlanKpi[]; now: Date }): ValidMonthlyFacts {
  const period = typeof input.period === 'string' ? input.period.trim() : ''
  if (!PERIOD_RE.test(period)) throw new PlanFactError('invalid', 'Укажите месяц в формате ГГГГ-ММ', 'period')
  const now = periodOrdinal(periodOf(opts.now))!
  const at = periodOrdinal(period)!
  if (at > now) throw new PlanFactError('invalid', 'Факт можно внести только за прошедший или текущий месяц', 'period')
  if (now - at > MAX_MONTHS_BACK) throw new PlanFactError('invalid', `Факт можно внести не дальше чем за ${MAX_MONTHS_BACK} месяца назад`, 'period')

  if (!input.values || typeof input.values !== 'object' || Array.isArray(input.values)) throw new PlanFactError('invalid', 'Нет значений', 'values')
  const values: ValidMonthlyFacts['values'] = {}
  for (const [key, raw] of Object.entries(input.values as Record<string, unknown>)) {
    if (!(PLAN_KPIS as readonly string[]).includes(key)) throw new PlanFactError('invalid', 'Неизвестный показатель', key)
    const kpi = key as PlanKpi
    if (!opts.kpis.includes(kpi)) throw new PlanFactError('invalid', `«${KPI_META[kpi].label}» нет в плане — его не сверяем`, kpi)
    if (raw === null || raw === '') { values[kpi] = null; continue }
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(/\s+/g, '').replace(',', '.')) : NaN
    const meta = KPI_META[kpi]
    if (!finite(n)) throw new PlanFactError('invalid', `${meta.label}: нужно число`, kpi)
    if (n < meta.min || n > meta.max) throw new PlanFactError('invalid', `${meta.label}: допустимо от ${meta.min} до ${meta.max}`, kpi)
    if (meta.integer && !Number.isInteger(n)) throw new PlanFactError('invalid', `${meta.label}: нужно целое число`, kpi)
    values[kpi] = n
  }
  if (!Object.keys(values).length) throw new PlanFactError('invalid', 'Внесите хотя бы одно значение', 'values')

  let note: string | null = null
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== 'string') throw new PlanFactError('invalid', 'Комментарий — текстом', 'note')
    note = input.note.trim() || null
    if (note && note.length > NOTE_MAX) throw new PlanFactError('invalid', `Комментарий — не длиннее ${NOTE_MAX} символов`, 'note')
    assertClean({ note })
  }
  return { period, values, note }
}

export interface MonthlyFactRow {
  company_id: string
  period: string
  metric: PlanKpi
  value: number | string
  source: string
  entered_by: string | null
  entered_role: 'owner' | 'expert'
  note: string | null
  updated_at?: string
}

export async function saveMonthlyFacts(
  sb: SupabaseClient,
  input: ValidMonthlyFacts & { companyId: string; enteredBy: string | null; role: 'owner' | 'expert' },
): Promise<{ saved: PlanKpi[]; cleared: PlanKpi[] }> {
  const saved: PlanKpi[] = []
  const cleared: PlanKpi[] = []
  const rows = (Object.entries(input.values) as Array<[PlanKpi, number | null]>).flatMap(([metric, value]) => {
    if (value === null) { cleared.push(metric); return [] }
    saved.push(metric)
    return [{
      company_id: input.companyId, period: input.period, metric, value, source: MONTHLY_SOURCE,
      entered_by: input.enteredBy, entered_role: input.role, note: input.note,
    }]
  })
  if (rows.length) {
    const { error } = await sb.from('pb_monthly_facts').upsert(rows, { onConflict: 'company_id,period,metric' })
    if (error) throw dbError('save monthly facts', error)
  }
  if (cleared.length) {
    const { error } = await sb.from('pb_monthly_facts').delete().eq('company_id', input.companyId).eq('period', input.period).in('metric', cleared)
    if (error) throw dbError('clear monthly facts', error)
  }
  return { saved, cleared }
}

export async function loadMonthlyFacts(sb: SupabaseClient, companyId: string, opts: { since?: string } = {}): Promise<MonthlyFactRow[]> {
  let q = sb.from('pb_monthly_facts').select('company_id, period, metric, value, source, entered_by, entered_role, note, updated_at').eq('company_id', companyId)
  if (opts.since) q = q.gte('period', opts.since)
  const { data, error } = await q.order('period', { ascending: true }).limit(400)
  if (error) throw dbError('read monthly facts', error)
  return (data ?? []) as MonthlyFactRow[]
}

/** The reconciliation values of one month (numbers). */
export function monthValues(rows: MonthlyFactRow[], period: string): KpiValues {
  const out: KpiValues = {}
  for (const r of rows) {
    if (r.period !== period || !(PLAN_KPIS as readonly string[]).includes(r.metric)) continue
    const n = Number(r.value)
    if (finite(n)) out[r.metric] = n
  }
  return out
}

// ── Checkpoints ─────────────────────────────────────────────────────────

const VERDICTS: PlanFactVerdict[] = ['on_track', 'risk', 'behind', 'no_data']

export interface CheckpointRow {
  id?: string
  company_id: string
  plan_id: string
  version_id: string
  period: string
  planned: Record<string, unknown>
  actual: Record<string, unknown>
  forecast: Record<string, unknown>
  verdict: Record<string, unknown>
  overall: PlanFactVerdict
  reason: string | null
  inputs_hash: string | null
  computed_at: string
}

export function checkpointToRow(c: Checkpoint, ctx: { companyId: string; planId: string; inputsHash: string | null }): CheckpointRow {
  return {
    company_id: ctx.companyId,
    plan_id: ctx.planId,
    version_id: c.versionId,
    period: c.period,
    planned: { values: c.planned, range: c.plannedRange },
    actual: { values: c.actual, sources: c.actualSources },
    forecast: { ...c.forecast },
    verdict: { ...c.verdict },
    overall: c.overall,
    reason: c.reason.slice(0, 1000),
    inputs_hash: ctx.inputsHash,
    computed_at: c.computedAt,
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function kpiValues(v: unknown): KpiValues {
  const o = obj(v)
  const out: KpiValues = {}
  for (const k of PLAN_KPIS) if (finite(o[k])) out[k] = o[k] as number
  return out
}

export function checkpointFromRow(r: CheckpointRow): Checkpoint {
  const planned = obj(r.planned)
  const actual = obj(r.actual)
  const range = obj(planned.range)
  const f = obj(r.forecast)
  const num = (v: unknown): number | null => (finite(v) ? v : null)
  const verdict: Checkpoint['verdict'] = {}
  for (const [k, e] of Object.entries(obj(r.verdict))) {
    if (!(PLAN_KPIS as readonly string[]).includes(k)) continue
    const x = obj(e)
    verdict[k as PlanKpi] = {
      kpi: k as PlanKpi,
      verdict: VERDICTS.includes(x.verdict as PlanFactVerdict) ? (x.verdict as PlanFactVerdict) : 'no_data',
      planned: num(x.planned), actual: num(x.actual), shortfallPct: num(x.shortfallPct),
      reason: typeof x.reason === 'string' ? x.reason : '',
    }
  }
  const sources: Checkpoint['actualSources'] = {}
  for (const [k, s] of Object.entries(obj(actual.sources))) {
    if ((PLAN_KPIS as readonly string[]).includes(k) && (s === 'reconciliation' || s === 'facts')) sources[k as PlanKpi] = s
  }
  return {
    period: r.period,
    versionId: r.version_id,
    planned: kpiValues(planned.values),
    plannedRange: finite(range.low) && finite(range.high) ? { low: range.low, high: range.high } : null,
    actual: kpiValues(actual.values),
    actualSources: sources,
    forecast: {
      atDeadlineAnnual: num(f.atDeadlineAnnual), trendMonthlyPct: num(f.trendMonthlyPct),
      basis: f.basis === 'history' ? 'history' : 'insufficient', goalAnnual: num(f.goalAnnual),
      deadline: typeof f.deadline === 'string' ? f.deadline : null, reachDate: typeof f.reachDate === 'string' ? f.reachDate : null,
    },
    verdict,
    overall: VERDICTS.includes(r.overall) ? r.overall : 'no_data',
    reason: r.reason ?? '',
    computedAt: r.computed_at,
  }
}

export async function upsertCheckpoints(sb: SupabaseClient, rows: CheckpointRow[]): Promise<void> {
  if (!rows.length) return
  const { error } = await sb.from('pb_checkpoints').upsert(rows, { onConflict: 'version_id,period' })
  if (error) throw dbError('save checkpoints', error)
}

export async function readCheckpointHash(sb: SupabaseClient, versionId: string, period: string): Promise<{ hash: string | null; computedAt: string | null } | null> {
  const { data, error } = await sb.from('pb_checkpoints').select('inputs_hash, computed_at').eq('version_id', versionId).eq('period', period).maybeSingle()
  if (error) throw dbError('read checkpoint', error)
  const row = data as { inputs_hash: string | null; computed_at: string | null } | null
  return row ? { hash: row.inputs_hash, computedAt: row.computed_at } : null
}

/** The newest `limit` months of a version, returned OLDEST first. */
export async function listCheckpoints(sb: SupabaseClient, versionId: string, limit = 12): Promise<Checkpoint[]> {
  const { data, error } = await sb.from('pb_checkpoints').select('*').eq('version_id', versionId).order('period', { ascending: false }).limit(limit)
  if (error) throw dbError('read checkpoints', error)
  return ((data ?? []) as CheckpointRow[]).map(checkpointFromRow).reverse()
}

// ── Run journal ─────────────────────────────────────────────────────────

export interface RunTotals { companies: number; skipped: number; aiCalls: number; cost: number; errors: Array<{ companyId: string; error: string }> }

export async function startRun(
  sb: SupabaseClient, input: { kind: 'scheduled' | 'manual'; companyId?: string | null; triggeredBy?: string | null; cursor?: string | null; now: Date },
): Promise<string | null> {
  const { data, error } = await sb.from('pb_runs').insert({
    kind: input.kind, company_id: input.companyId ?? null, triggered_by: input.triggeredBy ?? null, cursor: input.cursor ?? null,
    started_at: input.now.toISOString(), status: 'running',
  }).select('id').single()
  if (error) {
    // The journal is not essential to the recompute itself: logged, the run goes on.
    console.error('[point-b/planfact] run not journaled', error.code ?? 'unknown')
    return null
  }
  return (data as { id: string }).id
}

export async function finishRun(sb: SupabaseClient, runId: string | null, totals: RunTotals, now: Date): Promise<void> {
  if (!runId) return
  const { error } = await sb.from('pb_runs').update({
    status: totals.errors.length && totals.companies === 0 ? 'failed' : 'done', finished_at: now.toISOString(),
    companies: totals.companies, skipped: totals.skipped, ai_calls: totals.aiCalls, cost: totals.cost, errors: totals.errors.slice(0, 50),
  }).eq('id', runId)
  if (error) console.error('[point-b/planfact] run not finished in the journal', error.code ?? 'unknown')
}

/** The newest MANUAL run of a company (the button's limit); null when there is none or the journal is missing. */
export async function lastManualRun(sb: SupabaseClient, companyId: string): Promise<{ startedAt: string } | null> {
  const { data, error } = await sb.from('pb_runs').select('started_at').eq('company_id', companyId).eq('kind', 'manual')
    .order('started_at', { ascending: false }).limit(1)
  if (error) {
    if (isMissingTable(`(${error.code ?? ''})`)) return null
    throw dbError('read runs', error)
  }
  const row = ((data ?? []) as Array<{ started_at: string }>)[0]
  return row ? { startedAt: row.started_at } : null
}
