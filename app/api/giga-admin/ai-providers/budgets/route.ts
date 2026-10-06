import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { providerErrorResponse, readBody, toProviderActor } from '@/lib/admin/ai-providers-http'
import { budgetsInputSchema, getBudgets, setBudgets } from '@/lib/ai/providers/service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/giga-admin/ai-providers/budgets — daily USD budgets of the platform,
 * of one company and of each provider, with their source (БД / env) and
 * today's spend per provider. agents.view.
 */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  try {
    return NextResponse.json({ ok: true, budgets: await getBudgets() })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/budgets', err)
  }
}

/** PUT /api/giga-admin/ai-providers/budgets — omitted fields stay, null clears. settings.manage. */
export async function PUT(req: NextRequest) {
  const g = await requireGiga(req, 'settings.manage')
  if (g.response) return g.response
  const body = await readBody(req, budgetsInputSchema)
  if (!body.ok) return body.response
  try {
    return NextResponse.json({ ok: true, budgets: await setBudgets(toProviderActor(g.actor, req), body.data) })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/budgets', err)
  }
}
