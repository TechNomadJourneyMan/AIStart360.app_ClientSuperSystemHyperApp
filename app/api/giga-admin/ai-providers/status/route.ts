import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { providerErrorResponse } from '@/lib/admin/ai-providers-http'
import { routingStatus } from '@/lib/ai/providers/overview'

export const dynamic = 'force-dynamic'

/**
 * GET /api/giga-admin/ai-providers/status — «Кто отвечает сейчас»: per
 * capability (chat per tier) the model a call would use now, the failover
 * candidates and the health of the current one on this server instance.
 * No keys in the answer. agents.view.
 */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  try {
    return NextResponse.json({ ok: true, slots: await routingStatus(), checkedAt: new Date().toISOString() })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers/status', err)
  }
}
