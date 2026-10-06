import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { providerErrorResponse } from '@/lib/admin/ai-providers-http'
import { spendSummary } from '@/lib/ai/providers/service'

export const dynamic = 'force-dynamic'

const GROUPS = ['provider', 'model', 'feature', 'company'] as const
type Group = (typeof GROUPS)[number]

/**
 * GET /api/giga-admin/ai-providers/spend?days=7&groupBy=provider — LLM spend
 * over the last N days (1–366) grouped by provider / model / feature /
 * company, most expensive first. agents.view.
 */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  const sp = req.nextUrl.searchParams
  const rawDays = sp.get('days')
  const days = rawDays === null || rawDays === '' ? 7 : Number(rawDays)
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    return NextResponse.json({ ok: false, error: 'days: целое число от 1 до 366', code: 'VALIDATION' }, { status: 400 })
  }
  const rawGroup = sp.get('groupBy') || 'provider'
  if (!(GROUPS as readonly string[]).includes(rawGroup)) {
    return NextResponse.json({ ok: false, error: 'groupBy: provider, model, feature или company', code: 'VALIDATION' }, { status: 400 })
  }
  try {
    const summary = await spendSummary({ days, groupBy: rawGroup as Group })
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/spend', err)
  }
}
