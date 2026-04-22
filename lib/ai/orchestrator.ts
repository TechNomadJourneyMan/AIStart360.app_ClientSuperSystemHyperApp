/**
 * AI orchestrator — single entry point for every AI pipeline run.
 *
 * The orchestrator:
 *   1. Creates an `ai_runs` master record.
 *   2. Dispatches to the chosen async backbone (Inngest or n8n) OR runs inline.
 *   3. Executes the step graph: parse → classify → extract → persist → consensus
 *      → slot-map → invalidate-downstream.
 *   4. Each step updates `ai_runs.steps[]` with status + duration + cost.
 *
 * The async backbone chosen at deploy time via `AI_BACKBONE` env var:
 *   - 'inngest' — emits `inngest.send('ai/orchestrate.v1', …)`
 *   - 'n8n'     — fetches N8N_WEBHOOK_URL
 *   - 'inline'  — runs synchronously (dev / small tasks)
 *
 * Step implementations live next to this file as lib/ai/steps/*.ts (added in
 * Phase 1+). This file is the shell that sequences them.
 *
 * Server-only. All writes use the service-role key via `getServiceRoleFetch()`.
 */

import { randomUUID } from 'node:crypto'

import type { AiRunStep, ExtractorContext } from './extractors/types'

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export type OrchestrationTrigger =
  | 'document_uploaded'
  | 'survey_completed'
  | 'manual_rerun'
  | 'snapshot_changed'

export type AiBackbone = 'inngest' | 'n8n' | 'inline'

export interface OrchestrateInput {
  trigger: OrchestrationTrigger
  userId: string
  companyId: string
  documentId?: string
  triggerEntity?: string
  verticalHint?: 'generic' | 'medical'
}

export interface OrchestrateResult {
  runId: string
  backbone: AiBackbone
  /** True if the orchestration completed in this call (inline only). */
  inline: boolean
  /** External handle for tracking — Inngest run id or n8n execution id. */
  externalRunId?: string
}

/**
 * Single entry point. Creates `ai_runs` row, dispatches to the configured
 * backbone, returns immediately with the run id.
 *
 * Inline mode runs all steps synchronously and returns after completion.
 */
export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateResult> {
  const backbone = resolveBackbone()
  const runId = randomUUID()

  await createRunRecord({
    id: runId,
    userId: input.userId,
    companyId: input.companyId,
    trigger: input.trigger,
    triggerEntity: input.triggerEntity,
    backbone,
  })

  try {
    switch (backbone) {
      case 'inngest':
        return await dispatchInngest(runId, input)
      case 'n8n':
        return await dispatchN8n(runId, input)
      case 'inline':
        return await runInline(runId, input)
      default: {
        const exhaustive: never = backbone
        throw new Error(`unknown backbone: ${exhaustive as string}`)
      }
    }
  } catch (err) {
    await markRunFailed(runId, err instanceof Error ? err.message : String(err))
    throw err
  }
}

/**
 * Mark a run completed externally (Inngest/n8n call back to this via API).
 * Writes final status + total_cost_usd + finished_at.
 */
export async function completeRun(params: {
  runId: string
  status: 'completed' | 'failed' | 'partial'
  steps: AiRunStep[]
  totalCostUsd?: number
  error?: string
}): Promise<void> {
  await updateRunRecord({
    id: params.runId,
    status: params.status,
    steps: params.steps,
    totalCostUsd: params.totalCostUsd,
    error: params.error,
    finishedAt: new Date().toISOString(),
  })
}

// -----------------------------------------------------------------------------
// Backbone resolution
// -----------------------------------------------------------------------------

function resolveBackbone(): AiBackbone {
  const raw = (process.env.AI_BACKBONE ?? '').toLowerCase()
  if (raw === 'inngest' || raw === 'n8n' || raw === 'inline') return raw
  // Default: inline for dev / preview; prod overrides explicitly
  return 'inline'
}

// -----------------------------------------------------------------------------
// Backbone dispatchers — implemented per-branch
// -----------------------------------------------------------------------------

async function dispatchInngest(runId: string, input: OrchestrateInput): Promise<OrchestrateResult> {
  // Dynamic import keeps orchestrator importable even when Inngest isn't
  // initialised (edge runtime, tests).
  const { inngest } = await import('@/lib/inngest')

  const send = await inngest.send({
    // @ts-ignore — Inngest event typing quirk with custom event names
    name: 'ai/orchestrate.v1',
    data: {
      runId,
      trigger: input.trigger,
      userId: input.userId,
      companyId: input.companyId,
      documentId: input.documentId,
      triggerEntity: input.triggerEntity,
      verticalHint: input.verticalHint,
    },
  })

  const externalRunId =
    (send as { ids?: string[] } | undefined)?.ids?.[0] ?? undefined

  if (externalRunId) {
    await updateRunRecord({ id: runId, externalRunId })
  }

  return { runId, backbone: 'inngest', inline: false, externalRunId }
}

async function dispatchN8n(runId: string, input: OrchestrateInput): Promise<OrchestrateResult> {
  // Branch `ai-pipeline/n8n` fills this in — fetches N8N_WEBHOOK_URL with
  // HMAC signature and returns.
  throw new Error(
    '[orchestrator] AI_BACKBONE=n8n requires the n8n branch. ' +
      'Switch to branch `ai-pipeline/n8n` or set AI_BACKBONE=inline.'
  )
}

// -----------------------------------------------------------------------------
// Inline executor (dev / small tasks)
// -----------------------------------------------------------------------------

async function runInline(runId: string, input: OrchestrateInput): Promise<OrchestrateResult> {
  const steps: AiRunStep[] = []

  const ctx = buildExtractorContext(input, runId)

  try {
    // Dynamic imports keep orchestrator.ts importable in contexts where
    // pipeline deps (e.g. supabase REST) aren't needed.
    const {
      loadSurveyAnswers,
      runSurveyExtractor,
      persistExtractions,
      applyConsensus,
    } = await import('./pipeline-steps')

    const t0 = Date.now()

    // Step 1: load survey
    const answers = await loadSurveyAnswers(input.userId)
    steps.push({
      name: 'load-survey',
      status: 'completed',
      duration_ms: Date.now() - t0,
      meta: { count: answers.length },
    })

    if (input.trigger === 'survey_completed' || input.trigger === 'manual_rerun' || input.trigger === 'snapshot_changed') {
      // Step 2: extract
      const t1 = Date.now()
      const entities = await runSurveyExtractor(answers, ctx)
      steps.push({
        name: 'extract-survey',
        status: 'completed',
        duration_ms: Date.now() - t1,
        meta: { entityCount: entities.length },
      })

      // Step 3: persist
      const t2 = Date.now()
      const persisted = await persistExtractions(entities, ctx)
      steps.push({
        name: 'persist-extractions',
        status: 'completed',
        duration_ms: Date.now() - t2,
        meta: { persistedCount: persisted.length },
      })

      // Step 4: consensus + metrics
      const t3 = Date.now()
      const result = await applyConsensus(persisted, ctx)
      steps.push({
        name: 'consensus',
        status: 'completed',
        duration_ms: Date.now() - t3,
        meta: result as unknown as Record<string, unknown>,
      })
    } else {
      // document_uploaded — Phase 2+ will add document extractor steps here
      steps.push({
        name: 'document-trigger-placeholder',
        status: 'skipped',
        duration_ms: 0,
        meta: { note: 'Document extractors added in Phase 2' },
      })
    }

    await completeRun({ runId, status: 'completed', steps, totalCostUsd: 0 })
    return { runId, backbone: 'inline', inline: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    steps.push({ name: 'error', status: 'failed', error: msg })
    await completeRun({ runId, status: 'failed', steps, error: msg })
    throw err
  }
}

// -----------------------------------------------------------------------------
// DB helpers — service-role REST (bypasses RLS)
// -----------------------------------------------------------------------------

function getServiceRoleUrl(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      '[orchestrator] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'
    )
  }
  return { url, key }
}

interface CreateRunArgs {
  id: string
  userId: string
  companyId: string
  trigger: OrchestrationTrigger
  triggerEntity?: string
  backbone: AiBackbone
}

async function createRunRecord(args: CreateRunArgs): Promise<void> {
  const { url, key } = getServiceRoleUrl()
  const res = await fetch(`${url}/rest/v1/ai_runs`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      id: args.id,
      user_id: args.userId,
      company_id: args.companyId,
      trigger: args.trigger,
      trigger_entity: args.triggerEntity,
      backbone: args.backbone,
      status: 'running',
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`[orchestrator] failed to create ai_runs row: ${res.status} ${body}`)
  }
}

interface UpdateRunArgs {
  id: string
  status?: 'running' | 'completed' | 'failed' | 'partial'
  steps?: AiRunStep[]
  totalCostUsd?: number
  error?: string
  finishedAt?: string
  externalRunId?: string
}

async function updateRunRecord(args: UpdateRunArgs): Promise<void> {
  const { url, key } = getServiceRoleUrl()
  const body: Record<string, unknown> = {}
  if (args.status !== undefined) body.status = args.status
  if (args.steps !== undefined) body.steps = args.steps
  if (args.totalCostUsd !== undefined) body.total_cost_usd = args.totalCostUsd
  if (args.error !== undefined) body.error = args.error
  if (args.finishedAt !== undefined) body.finished_at = args.finishedAt
  if (args.externalRunId !== undefined) body.external_run_id = args.externalRunId

  const res = await fetch(`${url}/rest/v1/ai_runs?id=eq.${args.id}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[orchestrator] failed to update ai_runs row: ${res.status} ${text}`)
  }
}

async function markRunFailed(runId: string, error: string): Promise<void> {
  try {
    await updateRunRecord({
      id: runId,
      status: 'failed',
      error,
      finishedAt: new Date().toISOString(),
    })
  } catch (err) {
    // Best-effort; log but don't throw (we're already in an error path)
    // eslint-disable-next-line no-console
    console.error('[orchestrator] markRunFailed also failed:', err)
  }
}

// -----------------------------------------------------------------------------
// Context builder — for extractors
// -----------------------------------------------------------------------------

/** Build an ExtractorContext from an OrchestrateInput. */
export function buildExtractorContext(input: OrchestrateInput, runId: string): ExtractorContext {
  return {
    userId: input.userId,
    companyId: input.companyId,
    documentId: input.documentId,
    vertical: input.verticalHint ?? 'generic',
    runId,
  }
}
