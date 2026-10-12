/**
 * lib/data-layer/resolve.ts — the owner / an expert decides a discrepancy
 * (spec 2026-10-12 §5).
 *
 *   candidate  «верно из анкеты» / «взять из документа»: the value of one of
 *              the candidates. The value already in use (the first, highest-
 *              priority candidate) needs no override; any other one is written
 *              as the manual value of that period (public.metric_overrides).
 *   custom     «ввести другое»: the typed value becomes the manual value.
 *   ignore     «не важно»: closed as is; not reopened while the values stay.
 *
 * A manual value is written for every catalog metric that reads the same
 * inputs in that period (biz «Выручка (год)» and kpi «Общая выручка» …), so
 * the sibling metric does not reopen the same discrepancy.
 *
 * Service role; the caller has authorised the company (manage access).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMetricById } from '@/lib/metrics/registry'
import { isPlausibleFor } from '@/lib/metrics/resolver'
import { basisSignature } from './reconcile'
import type { DiscrepancyCandidate } from './types'

export type ResolveChoice =
  | { choice: 'candidate'; index: number; expected?: { sourceRef: string; value: number }; note?: string }
  | { choice: 'custom'; value: number; note?: string }
  | { choice: 'ignore'; note?: string }

export interface ResolveActor {
  userId: string
  /** Expert / staff → resolved_expert, otherwise resolved_user. */
  expert: boolean
}

export type ResolveOutcome =
  | { ok: true; status: 'resolved_user' | 'resolved_expert' | 'ignored'; value: number | null; overrides: string[] }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string }

interface Row {
  id: string
  company_id: string
  metric_key: string
  period_key: string
  kind: string
  status: string
  candidates: DiscrepancyCandidate[] | null
}

export async function resolveDiscrepancy(
  client: SupabaseClient,
  companyId: string,
  id: string,
  input: ResolveChoice,
  actor: ResolveActor,
): Promise<ResolveOutcome> {
  const { data, error } = await client
    .from('data_discrepancies')
    .select('id, company_id, metric_key, period_key, kind, status, candidates')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: 'read_failed' }
  const row = data as Row | null
  if (!row) return { ok: false, status: 404, error: 'not_found' }
  if (row.status !== 'open') return { ok: false, status: 409, error: 'already_closed' }
  const candidates = row.candidates ?? []

  let value: number | null = null
  let writeOverride = false
  if (input.choice === 'candidate') {
    const c = candidates[input.index]
    if (!c) return { ok: false, status: 400, error: 'bad_candidate' }
    if (input.expected && (c.sourceRef !== input.expected.sourceRef || Number(c.value) !== input.expected.value)) {
      return { ok: false, status: 409, error: 'stale_candidates' }
    }
    if (row.kind === 'invalid') return { ok: false, status: 400, error: 'invalid_value_needs_custom' }
    value = Number(c.value)
    // The first candidate is the value in use already.
    writeOverride = row.kind === 'conflict' && input.index > 0
  } else if (input.choice === 'custom') {
    const entry = getMetricById(row.metric_key)
    if (!Number.isFinite(input.value) || (entry && !isPlausibleFor(entry, input.value))) return { ok: false, status: 400, error: 'bad_value' }
    value = input.value
    writeOverride = true
  }

  const overrides: string[] = []
  if (writeOverride && value !== null) {
    const metrics = await siblingMetrics(client, row, candidates)
    const now = new Date()
    // A value of an unknown period (an undated older answer) is the current one.
    const periodKey = row.period_key === 'unknown' ? String(now.getUTCFullYear()) : row.period_key
    const rows = metrics.map((metric_key) => ({
      company_id: companyId,
      metric_key,
      period_key: periodKey,
      value,
      note: input.note ?? null,
      set_by: actor.userId,
      discrepancy_id: row.id,
      updated_at: now.toISOString(),
      basis_signature: basisSignature(candidates),
    }))
    let up = await client.from('metric_overrides').upsert(rows, { onConflict: 'company_id,metric_key,period_key' })
    // Before migration 111 there is no basis_signature column.
    if (up.error && (up.error.code === 'PGRST204' || up.error.code === '42703')) {
      up = await client.from('metric_overrides').upsert(rows.map(({ basis_signature: _b, ...r }) => r), { onConflict: 'company_id,metric_key,period_key' })
    }
    if (up.error) return { ok: false, status: 500, error: 'override_failed' }
    overrides.push(...metrics)
  }

  const status = input.choice === 'ignore' ? 'ignored' : actor.expert ? 'resolved_expert' : 'resolved_user'
  const upd = await client
    .from('data_discrepancies')
    .update({
      status,
      resolved_by: actor.userId,
      resolution_value: value,
      resolution_note: input.note ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('company_id', companyId)
  if (upd.error) return { ok: false, status: 500, error: 'update_failed' }
  return { ok: true, status, value, overrides }
}

/** Catalog metrics that read the same inputs in the same period (+ the discrepancy's own). */
async function siblingMetrics(client: SupabaseClient, row: Row, candidates: readonly DiscrepancyCandidate[]): Promise<string[]> {
  const refs = candidates.map((c) => c.sourceRef).filter(Boolean)
  const out = new Set<string>([row.metric_key])
  if (!refs.length) return [...out]
  // Same period, same source, same unit: a metric that reads the same field
  // in another unit («раз/год» vs a bare count) is not the same value.
  const unit = candidates[0]?.unit ?? ''
  const { data } = await client
    .from('metric_facts')
    .select('metric_key, unit')
    .eq('company_id', row.company_id)
    .eq('period_key', row.period_key)
    .in('source_ref', refs)
  for (const r of (data ?? []) as Array<{ metric_key: string; unit: string | null }>) {
    if ((r.unit ?? '') === unit) out.add(r.metric_key)
  }
  return [...out]
}
