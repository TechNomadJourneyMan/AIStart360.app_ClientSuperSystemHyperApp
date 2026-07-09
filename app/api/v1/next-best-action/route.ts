export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { buildAssistantContext } from '@/lib/assistant/context'
import { computeCompletion, deriveStatus } from '@/lib/assistant/completion'
import { runValidation } from '@/lib/assistant/validators'
import { readCrmProblemSignals } from '@/lib/assistant/mascot/problem-signals'
import { pickNextBestAction } from '@/lib/dashboard/next-best-action'
import { isRateLimited } from '@/lib/rate-limit'

/**
 * GET /api/v1/next-best-action — «1 действие сейчас» для дашборда (Фаза 5, №2).
 *
 * Дешёвая сборка сигналов из того же снимка, что и ассистент (completion + Point
 * A red-zone + GRI top-limit) плюс CRM-риск (Фаза 4B), под сессией пользователя.
 * Выбор действия — чистый pickNextBestAction. Личность из cookie (IDOR-safe).
 */
export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  if (await isRateLimited(req, 'next-best-action', { max: 30, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  try {
    const ctx = await buildAssistantContext(user.id, sb)
    const completion = computeCompletion(ctx)
    const issues = await runValidation(ctx, { includeLlm: false })
    completion.status = deriveStatus(completion, issues, ctx.llm_analysis, ctx)

    const sections = [...completion.sections].sort((a, b) => a.step - b.step)
    const next = sections.find((s) => s.pct < 100) ?? null
    const criticalBlock = ctx.pointA.blocks.find((b) => b.status === 'critical') ?? null
    const crm = await readCrmProblemSignals(sb, user.id, Date.now())

    const action = pickNextBestAction({
      completionPct: completion.overall_pct,
      nextSectionLabel: next?.label ?? null,
      hasDiagnostic: ctx.pointA.has_diagnostic,
      overdueClients: crm.clientsAtRisk,
      criticalBlockLabel: ctx.pointA.has_diagnostic ? criticalBlock?.label ?? null : null,
      griTopLimit: ctx.gri.top_5_limits[0]?.title ?? null,
    })

    return NextResponse.json({ ok: true, action })
  } catch (error) {
    console.error('[next-best-action] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
