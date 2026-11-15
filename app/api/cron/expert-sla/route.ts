import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { runExpertSla, SLA_RUN_BUDGET_MS } from '@/lib/expert-sla/run'
import { createServiceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/expert-sla — проход SLA экспертов (R2-B, lib/expert-sla/run.ts) раз в 5 минут
 * (lib/cron/schedule.ts): синхронизация задач эксперта, авто-назначение, пороги 24 ч (эскалация)
 * и 48 ч (просрочка). Без ИИ, бюджет прохода 30 с, проход идемпотентен (пороги захватываются в базе).
 *
 * Почему крон портала, а не Inngest: на Railway Inngest Cloud не вызывает /api/inngest (за двое
 * суток после выкатки — ни одного вызова по расписанию), поэтому функция `expert-sla-watch` не
 * запускалась ни разу. Один источник запуска — этот маршрут; из Inngest функция снята
 * (lib/functions/registry.ts), чтобы после починки Inngest проходы не шли вдвое.
 *
 * Auth: только заголовок `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 503 ? 'cron_not_configured' : 'unauthorized' }, { status: auth.status })
  }
  try {
    const report = await runExpertSla({ sb: createServiceClient(), budgetMs: SLA_RUN_BUDGET_MS })
    return NextResponse.json({ ok: true, ...report })
  } catch (e) {
    console.error('[cron/expert-sla]', e instanceof Error ? e.message : 'error')
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
