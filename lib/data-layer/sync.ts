/**
 * lib/data-layer/sync.ts — persist the data layer of a company
 * (public.metric_facts, public.data_discrepancies — migration 110).
 *
 * Runs after every metrics materialisation (lib/metrics/materialize.ts), with
 * the service role:
 *   1. facts: rebuilt from the same resolver context (delete + insert)
 *   2. discrepancies:
 *      • a new one → INSERT (status 'open')
 *      • still there → candidates / chosen value refreshed
 *      • gone (data fixed, document deleted) → 'auto_resolved'
 *      • one the owner / an expert already resolved or ignored is not reopened
 *        while its candidate values stay the same
 *
 * Never throws: a failure is returned as `error` (materialisation goes on).
 * Before migration 110 is applied the tables do not exist → 'not_migrated'.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ResolverContext } from '@/lib/metrics/types'
import { collectFacts } from './facts'
import { normalizeFacts } from './normalize'
import { reconcile } from './reconcile'
import type { DiscrepancyCandidate, DiscrepancyDraft, Fact } from './types'

export interface DataLayerSyncResult {
  facts: number
  opened: number
  updated: number
  autoResolved: number
  /** Discrepancies opened by this run (for notifications). */
  openedDrafts: DiscrepancyDraft[]
  error: string | null
}

interface StoredDiscrepancy {
  id: string
  metric_key: string
  period_key: string
  kind: string
  status: string
  candidates: DiscrepancyCandidate[] | null
  chosen_value: number | string | null
  created_at: string
}

const INSERT_BATCH = 500
/** Postgres «relation does not exist» / PostgREST «table not in the schema cache». */
const MISSING_TABLE = new Set(['42P01', 'PGRST205'])

function factRow(companyId: string, f: Fact, computedAt: string) {
  return {
    company_id: companyId,
    metric_key: f.metricId,
    period_key: f.periodKey,
    period_year: f.period?.year ?? null,
    period_quarter: f.period?.quarter ?? null,
    period_month: f.period?.month ?? null,
    value: f.value,
    unit: f.unit || null,
    source_kind: f.sourceKind,
    source_ref: f.sourceRef,
    source_refs: f.sourceRefs,
    confidence: f.confidence,
    flags: f.flags,
    is_current: f.current === true,
    observed_at: f.observedAt,
    note: f.note ?? null,
    computed_at: computedAt,
  }
}

function keyOf(metricId: string, periodKey: string, kind: string): string {
  return `${metricId}|${periodKey}|${kind}`
}

/** Same candidate values from the same sources (order-insensitive). */
export function sameCandidates(a: readonly DiscrepancyCandidate[] | null, b: readonly DiscrepancyCandidate[]): boolean {
  const sig = (xs: readonly DiscrepancyCandidate[]) => xs.map((c) => `${c.sourceRef}=${Number(c.value)}`).sort().join('|')
  return sig(a ?? []) === sig(b)
}

function sameValue(a: number | string | null | undefined, b: number | null): boolean {
  if (a === null || a === undefined) return b === null
  return b !== null && Number(a) === b
}

/** PostgREST: the RPC does not exist yet (migration 111 not applied). */
function isMissingFunction(e: { code?: string; message?: string }): boolean {
  return e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? '')
}

function err(e: { code?: string; message?: string } | null | undefined): string | null {
  if (!e) return null
  return e.code && MISSING_TABLE.has(e.code) ? 'not_migrated' : e.message ?? e.code ?? 'error'
}

export async function syncDataLayer(client: SupabaseClient, ctx: ResolverContext): Promise<DataLayerSyncResult> {
  const out: DataLayerSyncResult = { facts: 0, opened: 0, updated: 0, autoResolved: 0, openedDrafts: [], error: null }
  try {
    const now = ctx.now.toISOString()
    const facts = normalizeFacts(collectFacts(ctx), ctx.now)

    // 1. Facts — replaced atomically under a per-company lock
    // (public.replace_metric_facts, migration 111); before 111: delete + insert.
    const rows = facts.map((f) => factRow(ctx.companyId, f, now))
    const rpc = await client.rpc('replace_metric_facts', { p_company_id: ctx.companyId, p_rows: rows })
    if (rpc.error) {
      if (!isMissingFunction(rpc.error)) return { ...out, error: err(rpc.error) }
      const del = await client.from('metric_facts').delete().eq('company_id', ctx.companyId)
      if (del.error) return { ...out, error: err(del.error) }
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const ins = await client.from('metric_facts').insert(rows.slice(i, i + INSERT_BATCH))
        if (ins.error) return { ...out, error: err(ins.error) }
      }
    }
    out.facts = rows.length

    // 2. Discrepancies
    const drafts = reconcile(facts)
    const existing = await client
      .from('data_discrepancies')
      .select('id, metric_key, period_key, kind, status, candidates, chosen_value, created_at')
      .eq('company_id', ctx.companyId)
      .order('created_at', { ascending: false })
      .limit(2000)
    if (existing.error) return { ...out, error: err(existing.error) }
    const stored = (existing.data ?? []) as StoredDiscrepancy[]
    const open = new Map<string, StoredDiscrepancy>()
    const lastClosed = new Map<string, StoredDiscrepancy>()
    for (const r of stored) {
      const k = keyOf(r.metric_key, r.period_key, r.kind)
      if (r.status === 'open') open.set(k, r)
      else if (!lastClosed.has(k)) lastClosed.set(k, r) // newest first
    }

    const draftKeys = new Set<string>()
    for (const d of drafts) {
      const k = keyOf(d.metricId, d.periodKey, d.kind)
      draftKeys.add(k)
      const row = open.get(k)
      if (row) {
        if (sameCandidates(row.candidates, d.candidates) && sameValue(row.chosen_value, d.chosenValue)) continue
        const up = await client
          .from('data_discrepancies')
          .update({ candidates: d.candidates, chosen_value: d.chosenValue, detail: d.detail })
          .eq('id', row.id)
          .eq('company_id', ctx.companyId)
        if (up.error) return { ...out, error: err(up.error) }
        out.updated++
        continue
      }
      const closed = lastClosed.get(k)
      if (closed && closed.status !== 'auto_resolved' && sameCandidates(closed.candidates, d.candidates)) continue
      const ins = await client.from('data_discrepancies').insert({
        company_id: ctx.companyId,
        metric_key: d.metricId,
        period_key: d.periodKey,
        kind: d.kind,
        candidates: d.candidates,
        chosen_value: d.chosenValue,
        detail: d.detail,
        status: 'open',
      })
      // 23505: a concurrent run opened the same one — not an error.
      if (ins.error && ins.error.code !== '23505') return { ...out, error: err(ins.error) }
      if (ins.error) continue
      out.opened++
      out.openedDrafts.push(d)
    }

    const gone = [...open.entries()].filter(([k]) => !draftKeys.has(k)).map(([, r]) => r.id)
    if (gone.length) {
      const up = await client
        .from('data_discrepancies')
        .update({ status: 'auto_resolved', resolved_at: now, resolved_by: 'system' })
        .eq('company_id', ctx.companyId)
        .in('id', gone)
      if (up.error) return { ...out, error: err(up.error) }
      out.autoResolved = gone.length
    }
    return out
  } catch (e) {
    return { ...out, error: e instanceof Error ? e.message : String(e) }
  }
}
