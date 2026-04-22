/**
 * n8n helper endpoint — runs the Phase 1 pipeline (survey extractor +
 * consensus + metrics) server-side so the n8n workflow doesn't need to
 * reimplement our extractor logic in Function nodes.
 *
 * Flow from n8n perspective:
 *   1. Workflow webhook receives ai/orchestrate.v1 data.
 *   2. HTTP Request node → POST /api/ai/n8n-run-pipeline with signed body.
 *   3. This endpoint runs the pipeline, returns ai_run_id + step summary.
 *   4. Workflow then POSTs /api/ai/n8n-callback with kind='finalize'.
 *
 * Signed with X-AiStart360-Signature (same HMAC scheme as callback).
 *
 * Phases 2+ will split this into per-step endpoints (/parse, /classify,
 * /extract) so n8n can parallelize + branch more naturally.
 */

import { NextResponse, type NextRequest } from 'next/server'

import {
  applyConsensus,
  loadSurveyAnswers,
  persistExtractions,
  runSurveyExtractor,
} from '@/lib/ai/pipeline-steps'
import { completeRun } from '@/lib/ai/orchestrator'
import type { AiRunStep, ExtractorContext } from '@/lib/ai/extractors/types'
import { verifyCallbackSignature } from '@/lib/n8n/client'

export const runtime = 'nodejs'
export const maxDuration = 60

interface RunPipelinePayload {
  runId: string
  trigger: 'document_uploaded' | 'survey_completed' | 'manual_rerun' | 'snapshot_changed'
  userId: string
  companyId: string
  documentId?: string
  verticalHint?: 'generic' | 'medical'
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-aistart360-signature')

  if (!verifyCallbackSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let payload: RunPipelinePayload
  try {
    payload = JSON.parse(rawBody) as RunPipelinePayload
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (!payload?.runId || !payload?.userId || !payload?.companyId) {
    return NextResponse.json(
      { error: 'runId, userId, companyId are required' },
      { status: 400 }
    )
  }

  const ctx: ExtractorContext = {
    runId: payload.runId,
    userId: payload.userId,
    companyId: payload.companyId,
    documentId: payload.documentId,
    vertical: payload.verticalHint ?? 'generic',
  }

  const steps: AiRunStep[] = []

  try {
    const answers = await loadSurveyAnswers(payload.userId)
    steps.push({ name: 'load-survey', status: 'completed', meta: { count: answers.length } })

    if (
      payload.trigger === 'survey_completed' ||
      payload.trigger === 'manual_rerun' ||
      payload.trigger === 'snapshot_changed'
    ) {
      const entities = await runSurveyExtractor(answers, ctx)
      steps.push({ name: 'extract-survey', status: 'completed', meta: { entityCount: entities.length } })

      const persisted = await persistExtractions(entities, ctx)
      steps.push({ name: 'persist-extractions', status: 'completed', meta: { persistedCount: persisted.length } })

      const result = await applyConsensus(persisted, ctx)
      steps.push({
        name: 'consensus',
        status: 'completed',
        meta: result as unknown as Record<string, unknown>,
      })
    } else {
      steps.push({
        name: 'document-trigger-placeholder',
        status: 'skipped',
        meta: { note: 'Document extractors land in Phase 2' },
      })
    }

    await completeRun({ runId: payload.runId, status: 'completed', steps, totalCostUsd: 0 })

    return NextResponse.json({ ok: true, runId: payload.runId, steps })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    steps.push({ name: 'error', status: 'failed', error: msg })
    await completeRun({ runId: payload.runId, status: 'failed', steps, error: msg })
    return NextResponse.json({ ok: false, error: msg, steps }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    service: 'aistart360-n8n-run-pipeline',
    status: 'ready',
    supportedTriggers: [
      'document_uploaded',
      'survey_completed',
      'manual_rerun',
      'snapshot_changed',
    ],
  })
}
