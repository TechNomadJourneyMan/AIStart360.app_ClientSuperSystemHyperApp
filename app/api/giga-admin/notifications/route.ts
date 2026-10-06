import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { staffFeed } from '@/lib/agents/admin'

export const dynamic = 'force-dynamic'

/** GET /api/giga-admin/notifications?min=INFO|WARNING|CRITICAL&limit= — staff notification feed. */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'dashboard.view')
  if (g.response) return g.response
  const q = req.nextUrl.searchParams
  try {
    const items = await staffFeed({ minLevel: q.get('min'), limit: Number(q.get('limit') ?? 50) || 50 })
    return NextResponse.json({ ok: true, items })
  } catch (err) {
    console.error('[giga-admin/notifications] feed failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Лента уведомлений недоступна (применена ли миграция 087?)' }, { status: 500 })
  }
}
