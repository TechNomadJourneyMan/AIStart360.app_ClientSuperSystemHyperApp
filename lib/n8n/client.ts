/**
 * n8n webhook client.
 *
 * Used by dispatchN8n() to kick off an n8n workflow run. The workflow then
 * calls back to /api/ai/n8n-callback for each pipeline step and the final
 * completion marker.
 *
 * HMAC signature (X-AiStart360-Signature header) lets the callback endpoint
 * verify that requests genuinely came from our n8n instance, not arbitrary
 * callers hitting an open endpoint.
 *
 * Server-only.
 */

import { createHmac, randomBytes } from 'node:crypto'

export interface TriggerWorkflowInput {
  workflow: 'ai-orchestrate' | 'ai-reextract-on-doc-change' | 'ai-reslotmap-on-survey-change'
  runId: string
  trigger: string
  userId: string
  companyId: string
  documentId?: string
  triggerEntity?: string
  verticalHint?: 'generic' | 'medical'
}

export interface TriggerWorkflowResult {
  executionId?: string
  ok: boolean
  status: number
  body: string
}

/** Resolve the webhook URL for a given workflow. Falls back to base URL + path. */
function resolveWebhookUrl(workflow: string): string {
  const explicit = process.env.N8N_WEBHOOK_URL
  if (explicit) {
    // If operator provided a direct URL, append workflow id as query param for routing
    const sep = explicit.includes('?') ? '&' : '?'
    return `${explicit}${sep}wf=${encodeURIComponent(workflow)}`
  }
  const base = process.env.N8N_API_URL
  if (!base) throw new Error('[n8n] neither N8N_WEBHOOK_URL nor N8N_API_URL is set')
  return `${base.replace(/\/$/, '')}/webhook/${workflow}`
}

function getCallbackSecret(): string {
  const secret = process.env.N8N_CALLBACK_SECRET
  if (!secret) throw new Error('[n8n] N8N_CALLBACK_SECRET is not set — cannot sign requests')
  return secret
}

/** Compute HMAC-SHA256 over body with N8N_CALLBACK_SECRET. */
function sign(body: string): string {
  return createHmac('sha256', getCallbackSecret()).update(body).digest('hex')
}

/** Verify an incoming callback signature. Returns true if valid. */
export function verifyCallbackSignature(body: string, signature: string | null): boolean {
  if (!signature) return false
  const expected = sign(body)
  // Constant-time compare (timing-safe)
  if (expected.length !== signature.length) return false
  let result = 0
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return result === 0
}

/**
 * Trigger an n8n workflow via webhook. Non-blocking after HTTP round-trip —
 * the workflow runs asynchronously on n8n's side and calls back to
 * /api/ai/n8n-callback for progress + completion.
 */
export async function triggerWorkflow(input: TriggerWorkflowInput): Promise<TriggerWorkflowResult> {
  const url = resolveWebhookUrl(input.workflow)
  const body = JSON.stringify({
    runId: input.runId,
    trigger: input.trigger,
    userId: input.userId,
    companyId: input.companyId,
    documentId: input.documentId,
    triggerEntity: input.triggerEntity,
    verticalHint: input.verticalHint,
    nonce: randomBytes(8).toString('hex'),
    timestamp: new Date().toISOString(),
  })

  const signature = sign(body)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiStart360-Signature': signature,
      ...(process.env.N8N_API_KEY ? { 'X-N8N-API-Key': process.env.N8N_API_KEY } : {}),
    },
    body,
  })

  const responseBody = await res.text()

  let executionId: string | undefined
  try {
    const parsed = JSON.parse(responseBody)
    executionId = parsed?.executionId ?? parsed?.execution_id ?? undefined
  } catch {
    // non-JSON response — ignore
  }

  return {
    executionId,
    ok: res.ok,
    status: res.status,
    body: responseBody.slice(0, 500),
  }
}
