export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { buildAssistantContext } from '@/lib/assistant/context'
import { runValidation } from '@/lib/assistant/validators'
import { createExpertCase } from '@/lib/assistant/escalation/adapter'
import type { EscalationTrigger } from '@/lib/assistant/types'

/**
 * POST /api/v1/assistant/escalate
 * Body: { trigger_type: 'user_requested_help' | 'manual', userMessage?: string }
 *
 * Opens an ExpertCase for the CURRENT authenticated user (cookie session — never
 * a user_id param, IDOR-safe per point-b/route.ts) and dispatches it through the
 * EscalationDispatcher (createExpertCase). The internal adapter persists the case
 * via the service role and notifies admins; Telegram/Email adapters are env-gated
 * no-op stubs. This is the "Позвать эксперта" action from the hint widget / chat.
 *
 * Only client-initiated triggers are accepted here — 'user_requested_help'
 * (the button) and 'manual'. The data-derived triggers (validation_issue,
 * critical_risk, llm_recommendation, incomplete_data) are produced server-side by
 * shouldEscalate() at other call sites, never taken from a client request.
 *
 * Detected issues are computed (deterministic + rules, no LLM) and carried into
 * the case verbatim so the expert sees what the assistant flagged — никаких
 * выдуманных цифр (the case summary repeats only snapshot values).
 */
const ALLOWED_TRIGGERS: ReadonlySet<EscalationTrigger> = new Set([
  'user_requested_help',
  'manual',
])

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: { trigger_type?: string; userMessage?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }

  const triggerType = (body.trigger_type ?? 'user_requested_help') as EscalationTrigger
  if (!ALLOWED_TRIGGERS.has(triggerType)) {
    return NextResponse.json(
      { ok: false, error: 'Unsupported trigger_type' },
      { status: 400 },
    )
  }

  const userMessage =
    typeof body.userMessage === 'string' && body.userMessage.trim()
      ? body.userMessage.trim()
      : undefined

  try {
    const ctx = await buildAssistantContext(user.id, sb)

    // Carry the current deterministic/rule issues into the case (no LLM here —
    // escalation must be fast; the analyze route owns the LLM pass).
    const detectedIssues = await runValidation(ctx, { includeLlm: false })

    const expertCase = await createExpertCase(ctx, {
      triggerType,
      detectedIssues,
      userMessage,
    })

    return NextResponse.json({ ok: true, caseId: expertCase.id })
  } catch (error) {
    console.error('[assistant/escalate] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
