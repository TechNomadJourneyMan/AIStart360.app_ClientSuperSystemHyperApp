export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { guardClientAccess } from '@/lib/admin/client-scope'
import { createServiceClient } from '@/lib/supabase-service'
import { explicitPulseMetrics } from '@/lib/admin/expert-client-data'

/**
 * GET /api/giga-admin/users/:id/pulse — Пульс клиента.
 *
 * Источник — еженедельные чек-ины GRI Pulse (`gri_pulse_responses`, миграция
 * 027) и, если есть, явные метрики `diagnostics.ai_analysis.pulse`. Старый
 * портал выдавал «100 − балл Точки А» за риск и дату диагностики за «последний
 * заказ» — здесь такого нет: нет данных, значит пусто.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied

  const sb = createServiceClient()
  const [pulseRes, diagRes] = await Promise.all([
    sb.from('gri_pulse_responses').select('id, week_start, scores, pulse_index, note, created_at').eq('user_id', params.id).order('week_start', { ascending: false }).limit(26),
    sb.from('diagnostics').select('ai_analysis').eq('user_id', params.id).eq('is_current', true).limit(1),
  ])
  if (pulseRes.error) {
    console.warn('[giga-admin/users/pulse]', pulseRes.error.message)
  }

  const responses = ((pulseRes.data ?? []) as Array<{ id: string; week_start: string; scores: Record<string, number> | null; pulse_index: number | string; note: string | null; created_at: string }>)
    .map((r) => ({ id: r.id, weekStart: r.week_start, scores: r.scores ?? {}, index: Number(r.pulse_index), note: r.note, createdAt: r.created_at }))

  const latest = responses[0] ?? null
  const previous = responses[1] ?? null
  return NextResponse.json({
    ok: true,
    data: {
      responses,
      latest,
      delta: latest && previous ? Math.round((latest.index - previous.index) * 100) / 100 : null,
      explicit: explicitPulseMetrics(((diagRes.data ?? [])[0] as { ai_analysis?: unknown } | undefined)?.ai_analysis ?? null),
      unavailable: !!pulseRes.error,
    },
  })
}
