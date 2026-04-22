/**
 * n8n → Next.js callback endpoint.
 *
 * n8n workflow nodes POST here at each step to:
 *   - report step progress (status='running'|'completed'|'failed')
 *   - fetch data that lives in our DB (parsed document, classified type, etc.)
 *   - finalize the run (status='completed', total_cost_usd)
 *
 * Requests are signed with N8N_CALLBACK_SECRET (HMAC-SHA256 over raw body).
 *
 * Phase 0: accepts step updates + finalize. Phases 1+ add data-fetching
 * endpoints under /api/ai/n8n-callback/{step} (e.g. /parse, /classify).
 */

import { NextResponse, type NextRequest } from 'next/server'

import { completeRun } from '@/lib/ai/orchestrator'
import { verifyCallbackSignature } from '@/lib/n8n/client'
import type { AiRunStep } from '@/lib/ai/extractors/types'

export const runtime = 'nodejs'
export const maxDuration = 60

interface CallbackPayload {
  /** One of: 'step-update' | 'finalize' */
  kind: 'step-update' | 'finalize'
  runId: string
  /** For step-update: the step entry. For finalize: accumulated steps. */
  step?: AiRunStep
  steps?: AiRunStep[]
  /** Only for finalize. */
  status?: 'completed' | 'failed' | 'partial'
  totalCostUsd?: number
  error?: string
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-aistart360-signature')

  if (!verifyCallbackSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let payload: CallbackPayload
  try {
    payload = JSON.parse(rawBody) as CallbackPayload
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (!payload?.runId) {
    return NextResponse.json({ error: 'runId required' }, { status: 400 })
  }

  if (payload.kind === 'finalize') {
    if (!payload.status) {
      return NextResponse.json({ error: 'status required for finalize' }, { status: 400 })
    }
    try {
      await completeRun({
        runId: payload.runId,
        status: payload.status,
        steps: payload.steps ?? [],
        totalCostUsd: payload.totalCostUsd,
        error: payload.error,
      })
      return NextResponse.json({ ok: true, runId: payload.runId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `finalize failed: ${msg}` }, { status: 500 })
    }
  }

  if (payload.kind === 'step-update') {
    // In Phase 0 we simply acknowledge. Phases 1+ append to ai_runs.steps JSONB.
    return NextResponse.json({ ok: true, acknowledged: payload.step?.name ?? 'unnamed' })
  }

  return NextResponse.json({ error: `unknown kind: ${payload.kind}` }, { status: 400 })
}

// Health-check for n8n "Test" button in the webhook node
export async function GET() {
  return NextResponse.json({
    service: 'aistart360-n8n-callback',
    status: 'ready',
    runtime: 'nodejs',
  })
}
