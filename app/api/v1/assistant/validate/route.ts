export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { buildAssistantContext } from '@/lib/assistant/context'
import { runValidation } from '@/lib/assistant/validators'
import type { AssistantContext } from '@/lib/assistant/types'

/**
 * POST /api/v1/assistant/validate
 * Body: { section?: string, draftAnswers?: Record<string, unknown> }
 *
 * Cheap, no-LLM inline validation for a single анкета step. The client passes the
 * in-flight `draftAnswers` (values the user just typed but hasn't persisted) and
 * we merge them OVER the curated snapshot's answers, then run the deterministic +
 * rule layers. When `section` is supplied the issue list is narrowed to that
 * section so a step shows only its own hints. Session-scoped (current user from
 * cookie — never a user_id param), same IDOR guard as point-b/route.ts.
 */
export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: { section?: string; draftAnswers?: Record<string, unknown> } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    // Empty/invalid body is fine — validates the persisted answers as-is.
    body = {}
  }

  try {
    const ctx = await buildAssistantContext(user.id, sb)

    // Merge draft answers over the persisted snapshot so unsaved edits are
    // validated. Only plain objects are honoured; anything else is ignored.
    const draft =
      body.draftAnswers && typeof body.draftAnswers === 'object' && !Array.isArray(body.draftAnswers)
        ? body.draftAnswers
        : {}
    const mergedCtx: AssistantContext = {
      ...ctx,
      answers: { ...ctx.answers, ...draft },
    }

    // Layers 1+2 only — inline hints must be instant (no LLM on step blur).
    const allIssues = await runValidation(mergedCtx, { includeLlm: false })

    const section = typeof body.section === 'string' ? body.section.trim() : ''
    const issues = section ? allIssues.filter((i) => i.section === section) : allIssues

    return NextResponse.json({ ok: true, issues })
  } catch (error) {
    console.error('[assistant/validate] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
