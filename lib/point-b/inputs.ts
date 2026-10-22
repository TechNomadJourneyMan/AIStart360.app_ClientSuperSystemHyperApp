/**
 * lib/point-b/inputs.ts — everything Point B needs, read ONCE.
 *
 * The client page, the AI bridge, the expert and GIGA tabs, the public share
 * link and the PDF used to assemble these inputs five different ways (a copy of
 * the diagnostics adapter each, two of them reading the dead `metrics.revenue`
 * key). Now they all call loadPointBInputs and hand the result to computePointB
 * (lib/point-b/compute.ts).
 *
 * Honest data: a Point A block without a score is reported in blocksWithoutData
 * (not turned into a weak block), and the revenue base carries its calendar
 * period and age so a 2024 figure is never silently used as «current».
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PointA } from '@/types/onboarding'
import type { Goal } from '@/lib/goals/evaluate'
import { loadGoals, REVENUE_GOAL_METRIC } from '@/lib/goals/store'
import { parsePeriodKey, periodOrdinal } from '@/lib/data-layer/period-key'
import { diagToPointA, mapGriTop5 } from './adapters'
import { parseGoals, POINT_B_LEVER_METRICS, type PointBOptions } from './engine'
import { loadPointBMetrics, type PointBMetricOptions } from './metrics'

/** A revenue base older than this many months is flagged as stale. */
export const STALE_BASE_MONTHS = 15

export interface PointBInputs {
  userId: string
  companyId: string | null
  /** diagnostics is_current row. */
  diagnostic: Record<string, unknown> | null
  snapshot: { id: string; engine: 'v1' | 'v4'; confidence: number | null; coverage: number | null; createdAt: string } | null
  /** BlockKey of blocks with no score (v4 snapshot: score === null; diagnostics row: block column missing). */
  blocksWithoutData: string[]
  pointA: PointA | null
  answers: Record<string, unknown>
  griTop5: PointBOptions['griTop5']
  metricOptions: PointBMetricOptions
  goal12mYear: number | null
  goal3yYear: number | null
  base: { revenue: number | null; period: string | null; ageMonths: number | null; stale: boolean }
}

export interface LoadPointBInputsOptions {
  companyId?: string | null
  /** A specific diagnostic instead of the current one (AI bridge). */
  diagnosticId?: string | null
  /** For tests. */
  now?: Date
  /**
   * The company's goals, when the caller reads them anyway (the Point B page reads them once for the plan
   * snapshot, the model and here). Without it the goals are read here.
   */
  goals?: () => Promise<Goal[]>
}

const ENGINE_BLOCK_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['finance', 'finance_score'],
  ['sales', 'sales_score'],
  ['operations', 'operations_score'],
  ['marketing', 'marketing_score'],
  ['strategy', 'strategy_score'],
]

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function positive(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

function isMissingTable(e: { code?: string } | null | undefined): boolean {
  return !!e && (e.code === '42P01' || e.code === 'PGRST205')
}

/**
 * The Point A snapshot writes a quarter as '2025-2' (lib/point-a/snapshot.ts
 * pickedPeriod); lib/data-layer keys use '2025-Q2'. One spelling for Point B.
 */
export function normalizePeriodKey(key: string | null | undefined): string | null {
  if (!key) return null
  const q = /^(\d{4})-([1-4])$/.exec(key)
  return q ? `${q[1]}-Q${q[2]}` : key
}

/** End of a period key in months since year 0, null when unknown. */
function periodEndMonths(key: string): number | null {
  const p = parsePeriodKey(key)
  return p ? periodOrdinal(p) : null
}

/** Base period → age; clamps at 0 (a running year / month is not «in the future»). */
export function baseFreshness(period: string | null, now: Date): { ageMonths: number | null; stale: boolean } {
  if (!period) return { ageMonths: null, stale: false }
  const end = periodEndMonths(period)
  if (end === null) return { ageMonths: null, stale: false }
  const nowMonths = now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1)
  const ageMonths = Math.max(0, nowMonths - end)
  return { ageMonths, stale: ageMonths > STALE_BASE_MONTHS }
}

/** Questionnaire revenue (what the engine reads when no registry metric exists) with the year its key names. */
function surveyRevenueBase(answers: Record<string, unknown>, now: Date): { revenue: number; period: string } | null {
  const revenue = positive(parseGoals(answers).current_revenue_year)
  if (revenue === null) return null
  const explicit = positive(num(answers.s1_current_revenue_year)) ?? positive(num(answers.s1_current_revenue_month))
  if (explicit !== null) return { revenue, period: String(now.getUTCFullYear()) }
  for (const key of ['s2_revenue_2025', 's2_revenue_2024', 's9n_revenue_2024', 's2_revenue_2023']) {
    if (positive(num(answers[key])) !== null) return { revenue, period: /(\d{4})$/.exec(key)![1] }
  }
  return null
}

export async function loadPointBInputs(
  client: SupabaseClient,
  userId: string,
  opts: LoadPointBInputsOptions = {},
): Promise<PointBInputs> {
  const now = opts.now ?? new Date()

  // 1. Point A row the numbers on screen come from.
  let diagQuery = client.from('diagnostics').select('*').eq('user_id', userId)
  diagQuery = opts.diagnosticId ? diagQuery.eq('id', opts.diagnosticId) : diagQuery.eq('is_current', true)
  const readDiagnostic = async (): Promise<Record<string, unknown> | null> => {
    const diagRes = await diagQuery.order('calculated_at', { ascending: false }).limit(1)
    if (diagRes.error && !isMissingTable(diagRes.error)) throw new Error(`point-b inputs: diagnostics read failed (${diagRes.error.code ?? 'unknown'})`)
    return ((diagRes.data ?? []) as Array<Record<string, unknown>>)[0] ?? null
  }

  // 2. Company: the caller's, the diagnostic's, or the user's own. A caller that names the company does
  //    not wait for the diagnostic: it is read in the wave below (one round trip less).
  let companyId = opts.companyId ?? null
  let diagnosticP: Promise<Record<string, unknown> | null>
  if (companyId) {
    diagnosticP = readDiagnostic()
  } else {
    const diagnostic = await readDiagnostic()
    diagnosticP = Promise.resolve(diagnostic)
    companyId = (diagnostic?.company_id as string | null | undefined) ?? null
    if (!companyId) {
      const { data } = await client.from('companies').select('id').eq('user_id', userId).maybeSingle()
      companyId = (data as { id?: string } | null)?.id ?? null
    }
  }

  // 3. Everything else is independent: one wave.
  const [diagnostic, surveyRes, griRes, metrics, snapRes, goals] = await Promise.all([
    diagnosticP,
    client.from('survey_answers').select('question_key, answer').eq('user_id', userId),
    client.from('gri_assessments').select('top_5_limits').eq('user_id', userId).eq('is_current', true).limit(1),
    loadPointBMetrics(client, companyId),
    companyId
      ? client.from('point_a_snapshots').select('id, engine, confidence, coverage, created_at, blocks, inputs').eq('company_id', companyId).order('created_at', { ascending: false }).limit(1)
      : Promise.resolve({ data: [], error: null }),
    companyId
      ? (opts.goals ? opts.goals() : loadGoals(client, companyId)).catch((err) => {
          console.error('[point-b] goals not loaded — Point B falls back to the questionnaire', err instanceof Error ? err.message : err)
          return [] as Goal[]
        })
      : Promise.resolve([] as Goal[]),
  ])

  const answers: Record<string, unknown> = {}
  for (const row of (surveyRes.data ?? []) as Array<{ question_key: string; answer: unknown }>) {
    const a = row.answer
    answers[row.question_key] = a && typeof a === 'object' && 'value' in a ? (a as { value?: unknown }).value : a
  }
  const griTop5 = mapGriTop5(((griRes.data ?? []) as Array<{ top_5_limits?: unknown }>)[0]?.top_5_limits)

  // 4. The snapshot (Point A v4). A failed read is logged: Point B then works from the diagnostics row.
  if (snapRes.error && !isMissingTable(snapRes.error)) console.error('[point-b] snapshot read failed', snapRes.error.code ?? 'unknown')
  const snapRow = snapRes.error ? null : ((snapRes.data ?? []) as Array<Record<string, unknown>>)[0] ?? null
  const snapshot: PointBInputs['snapshot'] = snapRow
    ? {
        id: String(snapRow.id),
        engine: snapRow.engine === 'v4' ? 'v4' : 'v1',
        confidence: num(snapRow.confidence),
        coverage: num(snapRow.coverage),
        createdAt: String(snapRow.created_at),
      }
    : null

  // 5. Blocks without data. v4: a block with no score. Otherwise a diagnostics row without the block column
  //    (the adapter turns it into a zero block — that zero must not count as «weak»).
  const without: string[] = []
  if (snapRow && snapshot?.engine === 'v4' && Array.isArray(snapRow.blocks)) {
    for (const b of snapRow.blocks as Array<{ key?: unknown; score?: unknown }>) {
      if (typeof b?.key === 'string' && (b.score === null || b.score === undefined)) without.push(b.key)
    }
  } else if (diagnostic) {
    for (const [key, column] of ENGINE_BLOCK_COLUMNS) {
      const v = diagnostic[column]
      if (!v || typeof v !== 'object') without.push(key)
    }
  }

  // 6. Revenue base with its period.
  const goalOf = (period: '12m' | '3y') => positive(goals.find((g) => g.metricId === REVENUE_GOAL_METRIC && g.periodLabel === period)?.targetValue)
  let base: PointBInputs['base'] = { revenue: null, period: null, ageMonths: null, stale: false }
  const registryRevenue = positive(metrics.options.currentRevenueYear)
  if (registryRevenue !== null) {
    const snapInputs = snapRow?.inputs as { metrics?: Record<string, { period?: string | null }> } | null | undefined
    const period = normalizePeriodKey(snapInputs?.metrics?.[POINT_B_LEVER_METRICS.revenue]?.period) ?? metrics.revenuePeriod ?? null
    base = { revenue: registryRevenue, period, ...baseFreshness(period, now) }
  } else {
    const fromSurvey = surveyRevenueBase(answers, now)
    if (fromSurvey) base = { revenue: fromSurvey.revenue, period: fromSurvey.period, ...baseFreshness(fromSurvey.period, now) }
  }

  return {
    userId,
    companyId,
    diagnostic,
    snapshot,
    blocksWithoutData: without,
    pointA: diagnostic ? diagToPointA(diagnostic) : null,
    answers,
    griTop5,
    metricOptions: metrics.options,
    goal12mYear: goalOf('12m'),
    goal3yYear: goalOf('3y'),
    base,
  }
}
