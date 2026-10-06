import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { listTasks } from '@/lib/agents/admin'

export const dynamic = 'force-dynamic'

const STATUSES = new Set(['queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'dead', 'cancelled'])

/** GET /api/giga-admin/agents/tasks?status=&agent=&company=&before=&limit= */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  const q = req.nextUrl.searchParams
  const status = q.get('status')
  const before = q.get('before')
  const result = await listTasks({
    status: status && STATUSES.has(status) ? status : null,
    agentKey: q.get('agent')?.slice(0, 64) || null,
    companyId: q.get('company')?.slice(0, 64) || null,
    before: before && !Number.isNaN(Date.parse(before)) ? before : null,
    limit: Number(q.get('limit') ?? 50) || 50,
  })
  return NextResponse.json({ ok: true, ...result })
}
