export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { loadSlaWorkers } from '@/lib/expert-sla/store'

/**
 * GET /api/giga-admin/expert-sla/assignees — кому можно передать задачу
 * эксперта: одобренные эксперты (profiles.role = 'expert'), SuperExpert, Admin,
 * Super Admin — с числом открытых SLA-задач. Только имена, без контактов.
 */
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, ['clients.review', 'users.sensitive'])
  if (guard.response) return guard.response
  try {
    return NextResponse.json({ ok: true, data: await loadSlaWorkers(createServiceClient()) })
  } catch {
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить исполнителей' }, { status: 503 })
  }
}
