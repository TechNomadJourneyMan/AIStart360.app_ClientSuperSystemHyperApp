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
import type { AiRunStep, ExtractorContext } from '@/lib/ai/extractors/types'
import {
  loadSurveyAnswers,
  runSurveyExtractor,
  persistExtractions,
  applyConsensus,
  loadDocument,
  parseAndClassify,
  runDocumentExtractor,
  stampDocumentProcessed,
} from '@/lib/ai/pipeline-steps'

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
    const ctx: ExtractorContext = {
      userId,
      companyId,
      documentId,
      vertical: verticalHint ?? 'generic',
      runId,
    }

    try {
      const answers = await step.run('load-survey', async () => {
        const rows = await loadSurveyAnswers(userId)
        steps.push({ name: 'load-survey', status: 'completed', meta: { count: rows.length } })
        return rows
      })

      if (trigger === 'survey_completed' || trigger === 'manual_rerun' || trigger === 'snapshot_changed') {
        const entities = await step.run('extract-survey', async () => {
          const ents = await runSurveyExtractor(answers, ctx)
          steps.push({ name: 'extract-survey', status: 'completed', meta: { entityCount: ents.length } })
          return ents
        })

        const persisted = await step.run('persist-extractions', async () => {
          const rows = await persistExtractions(entities, ctx)
          steps.push({ name: 'persist-extractions', status: 'completed', meta: { persistedCount: rows.length } })
          return rows
        })

        await step.run('consensus', async () => {
          const result = await applyConsensus(persisted, ctx)
          steps.push({
            name: 'consensus',
            status: 'completed',
            meta: result as unknown as Record<string, unknown>,
          })
        })
      } else if (trigger === 'document_uploaded') {
        if (!documentId) throw new Error('document_uploaded trigger requires documentId')

        const { doc, parsed, classification } = await step.run('parse-and-classify', async () => {
          const d = await loadDocument(documentId)
          if (!d) throw new Error(`document ${documentId} not found`)
          const pc = await parseAndClassify(d)
          steps.push({
            name: 'parse-and-classify',
            status: 'completed',
            meta: {
              docType: pc.classification.doc_type,
              vertical: pc.classification.vertical,
              confidence: pc.classification.confidence,
              wordCount: pc.parsed.metadata.wordCount,
            },
          })
          return { doc: d, parsed: pc.parsed, classification: pc.classification }
        })

        // Refine context with classifier output
        if (!verticalHint && classification.vertical) ctx.vertical = classification.vertical
        ctx.classifiedType = classification.doc_type
        ctx.classificationConf = classification.confidence

        const { entities, extractorName } = await step.run('extract-document', async () => {
          const r = await runDocumentExtractor(parsed, ctx, classification.doc_type)
          steps.push({
            name: 'extract-document',
            status: r.entities.length ? 'completed' : 'skipped',
            meta: { entityCount: r.entities.length, extractor: r.extractorName },
          })
          return r
        })

        if (entities.length) {
          const persisted = await step.run('persist-extractions', async () => {
            const rows = await persistExtractions(entities, ctx)
            steps.push({ name: 'persist-extractions', status: 'completed', meta: { persistedCount: rows.length } })
            return rows
          })

          await step.run('consensus', async () => {
            const result = await applyConsensus(persisted, ctx)
            steps.push({
              name: 'consensus',
              status: 'completed',
              meta: result as unknown as Record<string, unknown>,
            })
          })
        }

        await step.run('stamp-document', async () => {
          await stampDocumentProcessed(documentId, classification, extractorName)
          steps.push({ name: 'stamp-document', status: 'completed' })
        })
      } else {
        steps.push({
          name: 'unknown-trigger',
          status: 'skipped',
          meta: { trigger },
        })
      }

      await step.run('finalize', async () => {
        await completeRun({ runId, status: 'completed', steps, totalCostUsd: 0 })
      })

      return { runId, status: 'completed', stepCount: steps.length }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      steps.push({ name: 'error', status: 'failed', error: msg })
      await completeRun({ runId, status: 'failed', steps, error: msg })
      throw err
    }
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
