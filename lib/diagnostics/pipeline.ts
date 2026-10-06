/**
 * lib/diagnostics/pipeline.ts — the diagnostic pipeline (docs/platform/05-agents.md §2).
 *
 * One diagnostic session runs these stages in order; each stage is its own
 * agent (key = stage) with its own permissions, budget and run history:
 *
 *   data_collection  snapshot of the inputs, completeness            $0
 *   metrics          materialise metrics, recalculate the Point A score $0
 *   data_quality     contradictions, impossible / stale values       $0
 *   benchmark        block scores vs curated industry benchmarks      $0
 *   diagnostic       model hypotheses over the evidence (hidden until
 *                    staff review), critical-risk alerts              LLM, budgeted
 *   recommendation   rule-based actions + model proposals (hidden)    LLM, budgeted
 *
 * The orchestrator opens the session and enqueues the first stage; each stage
 * enqueues the next through the `pipeline.advance` tool; after the last one
 * the orchestrator finalises (overview snapshot, DIAGNOSTIC_COMPLETED).
 * A stage that ends in dead-letter fails the session (lib/diagnostics/sessions.ts).
 */
export const DIAGNOSTIC_STAGES = [
  'data_collection',
  'metrics',
  'data_quality',
  'benchmark',
  'diagnostic',
  'recommendation',
] as const

export type DiagnosticStageKey = (typeof DIAGNOSTIC_STAGES)[number]

export const ORCHESTRATOR_KEY = 'diagnostic_orchestrator'

export const STAGE_LABELS: Record<DiagnosticStageKey, string> = {
  data_collection: 'Сбор данных',
  metrics: 'Метрики и индекс',
  data_quality: 'Качество данных',
  benchmark: 'Бенчмарки',
  diagnostic: 'Гипотезы ИИ',
  recommendation: 'Рекомендации',
}

export function isDiagnosticStage(v: unknown): v is DiagnosticStageKey {
  return typeof v === 'string' && (DIAGNOSTIC_STAGES as readonly string[]).includes(v)
}

/** Stage after `stage`; the first stage for null; null after the last one. */
export function nextStage(stage: DiagnosticStageKey | null): DiagnosticStageKey | null {
  if (stage === null) return DIAGNOSTIC_STAGES[0]
  const i = DIAGNOSTIC_STAGES.indexOf(stage)
  return i >= 0 && i < DIAGNOSTIC_STAGES.length - 1 ? DIAGNOSTIC_STAGES[i + 1] : null
}

/** Idempotency key of a stage task: one task per session and stage. */
export function stageTaskKey(sessionId: string, stage: DiagnosticStageKey | 'finalize'): string {
  return `diag:${sessionId}:${stage}`
}

export type StageStatus = 'running' | 'done' | 'skipped' | 'failed'

export interface StageRecord {
  status: StageStatus
  task_id?: string
  summary?: string
  started_at?: string
  finished_at?: string
  [extra: string]: unknown
}
