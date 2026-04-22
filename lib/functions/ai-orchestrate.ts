/**
 * Inngest functions for the AI orchestrator.
 *
 * Three functions:
 *   - `aiOrchestrate`             event: 'ai/orchestrate.v1'
 *       Runs the full pipeline: parse → classify → extract → persist → consensus
 *       → slot-map → invalidate-downstream.
 *   - `aiReExtractOnDocChange`    event: 'document/updated.v1'
 *       Invalidate + re-extract only the affected document. Downstream re-slot.
 *   - `aiReSlotMapOnSurveyChange` event: 'survey/answer-changed.v1'
 *       No LLM work. Only survey-extractor → consensus → slot-map.
 *
 * Phase 0: steps are placeholders. Phases 1+ wire real step impls from
 * lib/ai/extractors/**, lib/ai/consensus.ts, lib/ai/slot-mapper.ts.
 */

import { inngest } from '@/lib/inngest'
import { completeRun } from '@/lib/ai/orchestrator'
import type { AiRunStep } from '@/lib/ai/extractors/types'

// -----------------------------------------------------------------------------
// aiOrchestrate — main entry
// -----------------------------------------------------------------------------

export const aiOrchestrate = inngest.createFunction(
  {
    id: 'ai-orchestrate',
    name: 'AI orchestrator — full pipeline',
    retries: 2,
    // @ts-ignore Inngest event typing
    event: 'ai/orchestrate.v1',
  },
  // @ts-ignore
  async ({ event, step }: any) => {
    const {
      runId,
      trigger,
      userId,
      companyId,
      documentId,
      verticalHint,
    } = event.data as {
      runId: string
      trigger: 'document_uploaded' | 'survey_completed' | 'manual_rerun' | 'snapshot_changed'
      userId: string
      companyId: string
      documentId?: string
      verticalHint?: 'generic' | 'medical'
    }

    const steps: AiRunStep[] = []

    // Phase 1+: real steps registered here.
    // Placeholder so the run completes cleanly in Phase 0.
    await step.run('placeholder', async () => {
      steps.push({
        name: 'placeholder',
        status: 'completed',
        duration_ms: 0,
        meta: { trigger, userId, companyId, documentId, verticalHint },
      })
    })

    await step.run('finalize', async () => {
      await completeRun({
        runId,
        status: 'completed',
        steps,
        totalCostUsd: 0,
      })
    })

    return { runId, status: 'completed', stepCount: steps.length }
  }
)

// -----------------------------------------------------------------------------
// aiReExtractOnDocChange — emits from document.update hook
// -----------------------------------------------------------------------------

export const aiReExtractOnDocChange = inngest.createFunction(
  {
    id: 'ai-reextract-on-doc-change',
    name: 'AI re-extract on document change',
    retries: 2,
    // @ts-ignore
    event: 'document/updated.v1',
  },
  // @ts-ignore
  async ({ event, step }: any) => {
    const { runId, userId, companyId, documentId } = event.data

    const steps: AiRunStep[] = []

    await step.run('placeholder', async () => {
      steps.push({ name: 'placeholder', status: 'completed', duration_ms: 0 })
    })

    await step.run('finalize', async () => {
      await completeRun({ runId, status: 'completed', steps, totalCostUsd: 0 })
    })

    return { runId, status: 'completed' }
  }
)

// -----------------------------------------------------------------------------
// aiReSlotMapOnSurveyChange — emits when a survey answer is edited
// -----------------------------------------------------------------------------

export const aiReSlotMapOnSurveyChange = inngest.createFunction(
  {
    id: 'ai-reslotmap-on-survey-change',
    name: 'AI re-slot-map on survey answer change',
    retries: 2,
    // @ts-ignore
    event: 'survey/answer-changed.v1',
  },
  // @ts-ignore
  async ({ event, step }: any) => {
    const { runId, userId, companyId } = event.data

    const steps: AiRunStep[] = []

    await step.run('placeholder', async () => {
      steps.push({ name: 'placeholder', status: 'completed', duration_ms: 0 })
    })

    await step.run('finalize', async () => {
      await completeRun({ runId, status: 'completed', steps, totalCostUsd: 0 })
    })

    return { runId, status: 'completed' }
  }
)
