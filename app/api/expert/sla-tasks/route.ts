export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { expertBlockResponse, resolveExpert } from '@/lib/expert-auth'
import { visibleClientIds } from '@/lib/access/actor'
import { createServiceClient } from '@/lib/supabase-service'
import { decorate, loadSlaTasks, summarize } from '@/lib/expert-sla/store'

/**
 * GET /api/expert/sla-tasks — очередь эксперта с таймером «осталось N ч» (R2-B).
 *
 * Эксперт видит задачи своих клиентов (user_assignments — правило 140 / RLS
 * 146): задачи следуют за ответственным, бывший исполнитель их не видит.
 * Staff Admin / Super Admin в экспертном кабинете видят задачи, где они
 * исполнители; общая очередь — в ГИГА «SLA экспертов».
 */
export async function GET() {
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  const viewer = auth.viewer

  let clientIds: string[] = []
  if (viewer.role === 'expert') {
    const visible = await visibleClientIds({
      id: viewer.id, kind: 'expert', profileRole: 'expert', status: 'approved', approved: true,
      staffRole: null, activeExpert: true, clientScope: 'assigned',
    })
    if (!visible || 'all' in visible) return NextResponse.json({ ok: false, error: 'Не удалось загрузить очередь' }, { status: 503 })
    clientIds = visible.ids
  }

  const sb = createServiceClient()
  const now = new Date()
  try {
    // An expert: tasks of his clients only (RLS 146 — «assigned to me» alone gives nothing);
    // a staff Admin / Super Admin: tasks he holds (every client is visible to him anyway).
    const open = await loadSlaTasks(sb, viewer.role === 'expert' ? { clientIds } : { assigneeId: viewer.id })
    return NextResponse.json({ ok: true, data: await decorate(sb, open, now), summary: summarize(open, viewer.id, now) })
  } catch (err) {
    console.warn('[expert/sla-tasks]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Очередь недоступна' }, { status: 503 })
  }
}
