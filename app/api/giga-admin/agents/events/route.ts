import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { listPlatformEvents } from '@/lib/agents/admin'
import { isPlatformEventName, PLATFORM_EVENT_LABELS } from '@/lib/events/platform-names'

export const dynamic = 'force-dynamic'

/** GET /api/giga-admin/agents/events?name=&company=&limit= — platform event outbox. */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  const q = req.nextUrl.searchParams
  const name = q.get('name')
  const items = await listPlatformEvents({
    name: name && isPlatformEventName(name) ? name : null,
    companyId: q.get('company')?.slice(0, 64) || null,
    limit: Number(q.get('limit') ?? 100) || 100,
  })
  return NextResponse.json({ ok: true, items, labels: PLATFORM_EVENT_LABELS })
}
