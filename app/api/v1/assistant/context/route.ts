export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { buildAssistantContext } from '@/lib/assistant/context'
import { computeCompletion, deriveStatus } from '@/lib/assistant/completion'
import { runValidation } from '@/lib/assistant/validators'
import { computeServerHints } from '@/lib/assistant/mascot/server-hints'
import { readMascotSettings } from '@/lib/assistant/mascot/settings-server'
import { isMascotHidden, type AssistantContextPayload } from '@/lib/assistant/mascot/types'
import { isRateLimited } from '@/lib/rate-limit'

/**
 * GET /api/v1/assistant/context — trigger data for the mascot «Гри».
 *
 * Light, NO-LLM sibling of /status: same deterministic snapshot (completion +
 * layer-1/2 validation) but shaped for the client trigger engine — aggregate
 * progress, headline results and scripted hint CANDIDATES (ids + params only;
 * copy lives in the client catalog). Unlike /status it does NOT persist
 * assistant_runs — it is polled on navigation and must stay cheap.
 *
 * Identity comes from the cookie session only (IDOR-safe). When the user hid
 * the mascot, `hints` is empty — the server enforces silence even if a buggy
 * client keeps polling (ТЗ §11.13).
 */
export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  if (await isRateLimited(req, 'assistant:context', { max: 30, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  try {
    const settings = await readMascotSettings(sb, user.id)

    const ctx = await buildAssistantContext(user.id, sb)
    const completion = computeCompletion(ctx)
    const issues = await runValidation(ctx, { includeLlm: false })
    const status = deriveStatus(completion, issues, ctx.llm_analysis, ctx)
    completion.status = status

    const sections = [...completion.sections].sort((a, b) => a.step - b.step)
    const next = sections.find((s) => s.pct < 100)
    const completedSections = sections.filter((s) => s.pct === 100).length

    const hidden = isMascotHidden(settings, Date.now())
    const hints = hidden
      ? []
      : computeServerHints({
          completion,
          errorCount: issues.filter((i) => i.severity === 'error').length,
          hasDiagnostic: ctx.pointA.has_diagnostic,
          griIndex: ctx.gri.gri_index,
          topLimit: ctx.gri.top_5_limits[0]?.title ?? null,
        })

    const payload: AssistantContextPayload = {
      ok: true,
      progress: {
        completionPct: completion.overall_pct,
        completedSections,
        totalSections: sections.length,
        status,
        nextSection: next ? { label: next.label, step: next.step } : null,
      },
      results: {
        hasDiagnostic: ctx.pointA.has_diagnostic,
        griIndex: ctx.gri.gri_index,
        topLimit: ctx.gri.top_5_limits[0]?.title ?? null,
        realismLevel: ctx.pointB.has_goal ? ctx.pointB.realism.level : null,
      },
      hints,
      settings,
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error('[assistant/context] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
