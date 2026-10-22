/**
 * lib/point-b/planfact/route.ts — what the plan-fact routes share (GIGA, the expert portal, the client):
 *
 *   planFactFailure   PlanFactError → 400 (with the field) / 409 (no approved plan) / 503 (migration 132 not applied);
 *                     ProfanityError → 400 with the field
 *   recomputeNow      the button «Пересчитать»: once in 10 minutes per company (pb_runs), journaled as a manual run,
 *                     the company recomputed inline within its 45-second budget (forced: the expert asked for it)
 *   staffPlanFactView the plan-fact of a client for the staff: every version, the newest runs of the company
 *   saveFactsAndRefresh «Факт за месяц»: only the KPIs of the approved plan; saved as «ежемесячная сверка»; then the
 *                     checkpoints of the company are recalculated (checkpoints only — no invites, no drafts)
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PROFANITY_MESSAGE } from '@/lib/moderation/http'
import { ProfanityError } from '@/lib/moderation/profanity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { getSetting } from '@/lib/settings/store'
import { loadPlanBundle } from '../plan/store'
import { loadPlanFactState } from './load'
import { planKpis } from './planned'
import { recomputeCompany, type RecomputeOutcome } from './recompute'
import {
  finishRun, isMissingTable, lastManualRun, PlanFactError, saveMonthlyFacts, startRun, validateMonthlyFacts,
  type MonthlyFactsInput,
} from './store'
import type { PlanFactState } from './types'
import { normalizeTolerances } from './verdict'

export const RECOMPUTE_COOLDOWN_MS = 10 * 60_000

export const PLANFACT_AUDIT = {
  recomputed: 'point_b.recomputed',
  factsSaved: 'point_b.monthly_facts.saved',
} as const

export const NO_PLAN_TEXT = 'План ещё не одобрен — сверять факт пока не с чем'

const fail = (error: string, status: number, extra: Record<string, unknown> = {}): NextResponse => NextResponse.json({ ok: false, error, ...extra }, { status })

export function planFactFailure(err: unknown): NextResponse | null {
  if (err instanceof ProfanityError) return fail(PROFANITY_MESSAGE, 400, { code: 'profanity', field: err.field })
  if (err instanceof PlanFactError) {
    if (err.code === 'not_ready') return fail('План-факт Точки Б ещё не включён на сервере', 503, { code: 'not_ready' })
    if (err.code === 'no_plan') return fail(NO_PLAN_TEXT, 409, { code: 'no_plan' })
    return fail(err.message, 400, { code: 'invalid', ...(err.field ? { field: err.field } : {}) })
  }
  if (err instanceof Error && isMissingTable(err.message)) return fail('План-факт Точки Б ещё не включён на сервере', 503, { code: 'not_ready' })
  return null
}

async function tolerances() {
  try {
    return normalizeTolerances(await getSetting('pb_verdict_tolerances'))
  } catch {
    return normalizeTolerances(null)
  }
}

export type RecomputeNowResult =
  | { ok: true; outcome: RecomputeOutcome; runId: string | null }
  | { ok: false; limited: true; retryAt: string }

export async function recomputeNow(
  sb: SupabaseClient, input: { companyId: string; userId: string; actorId: string | null; now: Date },
): Promise<RecomputeNowResult> {
  const last = await lastManualRun(sb, input.companyId)
  if (last) {
    const next = Date.parse(last.startedAt) + RECOMPUTE_COOLDOWN_MS
    if (Number.isFinite(next) && next > input.now.getTime()) return { ok: false, limited: true, retryAt: new Date(next).toISOString() }
  }
  // A second guard (two clicks at once, or the journal not there yet): the shared rate store.
  if (await isRateLimitedKey(input.companyId, 'pb-recompute', { max: 1, windowMs: RECOMPUTE_COOLDOWN_MS })) {
    return { ok: false, limited: true, retryAt: new Date(input.now.getTime() + RECOMPUTE_COOLDOWN_MS).toISOString() }
  }
  const runId = await startRun(sb, { kind: 'manual', companyId: input.companyId, triggeredBy: input.actorId, now: input.now })
  const outcome = await recomputeCompany(sb, { companyId: input.companyId, userId: input.userId, now: input.now, force: true, tolerances: await tolerances() })
  await finishRun(sb, runId, {
    companies: outcome.status === 'done' ? 1 : 0,
    skipped: outcome.status === 'done' || outcome.status === 'failed' ? 0 : 1,
    aiCalls: 0,
    cost: 0,
    errors: outcome.status === 'failed' ? [{ companyId: input.companyId, error: outcome.error ?? 'failed' }] : [],
  }, new Date())
  return { ok: true, outcome, runId }
}

export interface StaffRun { kind: string; status: string; startedAt: string; finishedAt: string | null }

export async function staffPlanFactView(sb: SupabaseClient, input: { companyId: string; now: Date }): Promise<{ published: boolean; planFact: PlanFactState; runs: StaffRun[] }> {
  const bundle = await loadPlanBundle(sb, input.companyId)
  const planFact = await loadPlanFactState(sb, { companyId: input.companyId, published: bundle.published, versions: bundle.versions, audience: 'staff', now: input.now })
  let runs: StaffRun[] = []
  const { data, error } = await sb.from('pb_runs').select('kind, status, started_at, finished_at').eq('company_id', input.companyId).order('started_at', { ascending: false }).limit(5)
  if (!error) runs = ((data ?? []) as Array<{ kind: string; status: string; started_at: string; finished_at: string | null }>).map((r) => ({ kind: r.kind, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at }))
  return { published: !!bundle.published, planFact, runs }
}

export async function saveFactsAndRefresh(
  sb: SupabaseClient,
  input: { companyId: string; userId: string; body: MonthlyFactsInput; enteredBy: string | null; role: 'owner' | 'expert'; now: Date },
): Promise<{ period: string; saved: string[]; cleared: string[]; checkpoint: RecomputeOutcome }> {
  const bundle = await loadPlanBundle(sb, input.companyId)
  if (!bundle.published) throw new PlanFactError('no_plan', NO_PLAN_TEXT)
  const valid = validateMonthlyFacts(input.body, { kpis: planKpis(bundle.published), now: input.now })
  const r = await saveMonthlyFacts(sb, { ...valid, companyId: input.companyId, enteredBy: input.enteredBy, role: input.role })
  const checkpoint = await recomputeCompany(sb, { companyId: input.companyId, userId: input.userId, now: input.now, mode: 'checkpoint', force: true, tolerances: await tolerances() })
  return { period: valid.period, saved: r.saved, cleared: r.cleared, checkpoint }
}
