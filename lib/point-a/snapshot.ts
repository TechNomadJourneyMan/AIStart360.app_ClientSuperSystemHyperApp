/**
 * lib/point-a/snapshot.ts — ONE recalculation of Point A (spec 2026-10-12 §2).
 *
 *   1. materialise the company's metrics, period facts and discrepancies
 *      (without METRIC_UPDATED — it would request the next recalculation)
 *   2. v1 (lib/point-a-engine.ts) and v4 (lib/point-a/v4/engine.ts) on the
 *      same inputs and the company's block configuration
 *   3. nothing changed since the last snapshot (inputs, configuration)? → stop
 *   4. public.diagnostics: v4 when the point_a_v4 setting is on, v1 otherwise
 *      (v4 then runs in the shadow and both are kept in the snapshot)
 *   5. public.point_a_snapshots with the inputs and «что изменилось и почему»
 *   6. POINT_A_UPDATED, the AI fan-out (cached by the hash of its inputs) and
 *      the diagnostic pipeline
 *
 * The deterministic part is recalculated in full on every pass (milliseconds),
 * so an «incremental» result equals a full one by construction; what is
 * incremental is the expensive part — one materialisation per wave of events
 * (lib/point-a/recalc-queue.ts) and AI only when its inputs changed.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase-service'
import { calculatePointA } from '@/lib/point-a-engine'
import type { PointA } from '@/types/onboarding'
import type { MetricValue } from '@/lib/metrics/types'
import { pickedSourceLabel } from '@/lib/metrics/materialize'
import { RESOLVED_INPUT_METRICS, resolvedInputsFromValues } from './resolved-inputs'
import { calculatePointAV4, toCompatPointA, type PointAV4, type V4Block } from './v4/engine'
import { BLOCK_LIBRARY } from './v4/config'
import { loadBlockConfig } from './v4/store'
import { changeReasons, hashOf, inputsHash, type ChangeReason, type SnapshotInputs } from './snapshot-diff'

export type SnapshotTrigger = 'event' | 'manual' | 'schedule' | 'expert'

export interface SnapshotOptions {
  trigger: SnapshotTrigger
  /** Events that caused it (SURVEY_ANSWER_CHANGED …). */
  reasons?: string[]
  /** Write even when nothing changed (a manual recalculation). */
  force?: boolean
  locale?: string
}

export type SnapshotResult =
  | { status: 'skipped'; reason: 'not_migrated' | 'no_owner' | 'no_answers' }
  | { status: 'unchanged'; snapshotId: string }
  | {
      status: 'written'
      snapshotId: string | null
      diagnosticId: string
      diagnostic: Record<string, unknown>
      engine: 'v1' | 'v4'
      written: PointA
      v4: PointAV4
      changes: ChangeReason[]
    }

export interface SnapshotDeps {
  service: () => SupabaseClient
  materialize: (service: SupabaseClient, companyId: string, ownerId: string) => Promise<{ values: MetricValue[]; surveyAnswers: Record<string, unknown> }>
  useV4: () => Promise<boolean>
  store: typeof import('./diagnostic-row').storeCurrentDiagnostic
  afterWrite: (o: { companyId: string; ownerId: string; diagnosticId: string; snapshotId: string | null; engine: 'v1' | 'v4'; written: PointA; changes: ChangeReason[]; trigger: SnapshotTrigger; locale: string }) => void
}

const defaultDeps: SnapshotDeps = {
  service: () => createServiceClient(),
  materialize: async (service, companyId, ownerId) => {
    const { materializeForTenant } = await import('@/lib/metrics/materialize-tenant')
    const { values, ctx } = await materializeForTenant(service, service, { companyId, userId: ownerId }, { announce: false })
    return { values, surveyAnswers: ctx.surveyAnswers }
  },
  useV4: async () => {
    const { getSetting } = await import('@/lib/settings/store')
    return getSetting('point_a_v4')
  },
  store: async (...args) => (await import('./diagnostic-row')).storeCurrentDiagnostic(...args),
  afterWrite: (o) => {
    void (async () => {
      const [{ emitPlatformEventSafely }, { fireAiFanOut, startDiagnosticPipeline }, { internalBaseUrl }] = await Promise.all([
        import('@/lib/events/platform'),
        import('./diagnostic-row'),
        import('@/lib/internal-auth'),
      ])
      emitPlatformEventSafely({
        name: 'POINT_A_UPDATED', companyId: o.companyId, subjectType: 'diagnostic', subjectId: o.diagnosticId, actor: 'system',
        payload: { engine: o.engine, overall: o.written.overall_score, trigger: o.trigger, changes: o.changes.slice(0, 10).map((c) => c.text) },
        dedupeKey: `point_a_updated:${o.snapshotId ?? o.diagnosticId}`,
      })
      const baseUrl = internalBaseUrl({})
      if (process.env.OPENROUTER_API_KEY && baseUrl) fireAiFanOut({ baseUrl, diagnosticId: o.diagnosticId, userId: o.ownerId, locale: o.locale })
      startDiagnosticPipeline({ companyId: o.companyId, diagnosticId: o.diagnosticId, requestedBy: 'system:point-a', trigger: o.trigger === 'manual' ? 'manual' : 'event', reason: 'пересчёт Точки А после изменения данных' })
    })().catch((err) => console.error('[point-a/snapshot] after-write failed', err instanceof Error ? err.message : err))
  },
}

function missingTable(e: { code?: string } | null | undefined): boolean {
  return !!e && (e.code === '42P01' || e.code === 'PGRST205')
}

/** Period label of the value the resolver picked ('2025', '2026-09'), when known. */
function pickedPeriod(v: MetricValue): string | null {
  const won = v.considered.find((a) => a.status === 'hit' && a.source === v.picked)
  const p = won?.period
  if (!p || typeof p.year !== 'number') return null
  return typeof p.month === 'number' ? `${p.year}-${String(p.month).padStart(2, '0')}` : p.quarter ? `${p.year}-${p.quarter}` : String(p.year)
}

/** The metrics Point A rests on: engine inputs and the metrics of every block. */
export function snapshotMetricIds(): string[] {
  const ids = new Set<string>()
  for (const list of Object.values(RESOLVED_INPUT_METRICS)) for (const id of list) ids.add(id)
  for (const b of Object.values(BLOCK_LIBRARY)) for (const id of b.metrics) ids.add(id)
  return [...ids].sort()
}

export function snapshotInputs(values: readonly MetricValue[], answers: Record<string, unknown>, conflicts: readonly string[], config: string): SnapshotInputs {
  const wanted = new Set(snapshotMetricIds())
  const metrics: SnapshotInputs['metrics'] = {}
  for (const v of values) {
    if (!wanted.has(v.metricId) || v.picked === null || typeof v.numeric !== 'number') continue
    metrics[v.metricId] = { value: v.numeric, source: pickedSourceLabel(v.picked), period: pickedPeriod(v) }
  }
  const hashed: Record<string, string> = {}
  for (const k of Object.keys(answers).sort()) hashed[k] = hashOf(answers[k], 12)
  return { metrics, answers: hashed, conflicts: [...conflicts].sort(), config }
}

export async function buildPointASnapshot(companyId: string, opts: SnapshotOptions, deps: SnapshotDeps = defaultDeps): Promise<SnapshotResult> {
  const service = deps.service()

  // Before migration 111 there is nowhere to keep snapshots: do nothing.
  const prevQ = await service
    .from('point_a_snapshots')
    .select('id, blocks, inputs, inputs_hash, config_version')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (prevQ.error) {
    if (missingTable(prevQ.error)) return { status: 'skipped', reason: 'not_migrated' }
    throw new Error(`point-a: snapshot read failed (${prevQ.error.code ?? 'unknown'})`)
  }
  const prev = ((prevQ.data ?? [])[0] ?? null) as { id: string; blocks: V4Block[]; inputs: SnapshotInputs; inputs_hash: string; config_version: string } | null

  const { data: company, error: companyErr } = await service.from('companies').select('id, user_id, industry').eq('id', companyId).maybeSingle()
  if (companyErr) throw new Error(`point-a: company read failed (${companyErr.code ?? 'unknown'})`)
  const ownerId = (company as { user_id?: string | null } | null)?.user_id ?? null
  if (!ownerId) return { status: 'skipped', reason: 'no_owner' }
  const industry = (company as { industry?: string | null }).industry ?? null

  const { values, surveyAnswers } = await deps.materialize(service, companyId, ownerId)
  if (Object.keys(surveyAnswers).length === 0) return { status: 'skipped', reason: 'no_answers' }

  const open = await service.from('data_discrepancies').select('metric_key').eq('company_id', companyId).eq('status', 'open')
  if (open.error && !missingTable(open.error)) throw new Error(`point-a: discrepancies read failed (${open.error.code ?? 'unknown'})`)
  const conflicts = [...new Set(((open.data ?? []) as Array<{ metric_key: string }>).map((r) => r.metric_key))]

  const config = await loadBlockConfig(service, companyId, industry)
  const resolved = resolvedInputsFromValues(values)
  const v1 = calculatePointA(surveyAnswers, resolved)
  const v4 = calculatePointAV4({ answers: surveyAnswers, resolved, blocks: config.blocks, conflictMetrics: new Set(conflicts) })

  const inputs = snapshotInputs(values, surveyAnswers, conflicts, config.version)
  const hash = inputsHash(inputs)
  if (!opts.force && prev && prev.inputs_hash === hash && prev.config_version === config.version) {
    return { status: 'unchanged', snapshotId: prev.id }
  }

  const engine: 'v1' | 'v4' = (await deps.useV4()) ? 'v4' : 'v1'
  const written = engine === 'v4' ? toCompatPointA(v4, v1) : v1
  const stored = await deps.store(service, {
    userId: ownerId, companyId, result: written,
    aiStatus: process.env.OPENROUTER_API_KEY ? 'processing' : 'none',
  })
  if (!stored.ok) throw new Error(`point-a: diagnostic not stored (${stored.error})`)
  const diagnosticId = String(stored.diag.id)

  const changes = changeReasons(prev ? { blocks: prev.blocks ?? [], inputs: prev.inputs } : null, { blocks: v4.blocks, inputs })
  const ins = await service
    .from('point_a_snapshots')
    .insert({
      company_id: companyId,
      diagnostic_id: diagnosticId,
      engine,
      trigger: opts.trigger,
      reasons: opts.reasons ?? [],
      overall: v4.overall,
      confidence: v4.confidence,
      coverage: v4.coverage,
      stage: v4.stage,
      blocks: v4.blocks,
      v4: { strengths: v4.strengths, upload_checklist: v4.upload_checklist, blocks_without_data: v4.blocks_without_data, health_index: v4.health_index },
      v1_overall: v1.overall_score,
      v1_blocks: v1.blocks,
      inputs,
      inputs_hash: hash,
      config_version: config.version,
      change_reasons: changes,
    })
    .select('id')
    .single()
  if (ins.error) console.error('[point-a/snapshot] snapshot not stored', ins.error.code ?? '', ins.error.message ?? '')
  const snapshotId = (ins.data as { id?: string } | null)?.id ?? null

  deps.afterWrite({ companyId, ownerId, diagnosticId, snapshotId, engine, written, changes, trigger: opts.trigger, locale: opts.locale ?? 'ru' })
  return { status: 'written', snapshotId, diagnosticId, diagnostic: stored.diag, engine, written, v4, changes }
}
