import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { createServiceClient } from '@/lib/supabase-service'
import { runDailyRollup } from '@/lib/analytics/rollup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/cron/analytics-rollup — ежедневная свёртка активности (F-066).
 *
 * Vercel Cron: 22:00 UTC = 03:00 по Алматы (vercel.json). Сворачивает вчера и
 * позавчера (поздние события), затем догоняет не свёрнутые дни за последние
 * 90 дней — в ограниченном цикле и с бюджетом времени; остаток доберёт
 * следующий запуск. Повторный запуск безопасен: день пересчитывается целиком.
 *
 * Auth: общий isAuthorizedCron (R-231) — только `Authorization: Bearer ${CRON_SECRET}`
 * (так шлёт Vercel Cron), секрет в query не принимается (оседал бы в логах); без
 * CRON_SECRET — 503, как у остальных кронов.
 */
export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req)
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.status === 503 ? 'cron_not_configured' : 'unauthorized' },
      { status: auth.status },
    )
  }

  const result = await runDailyRollup(createServiceClient(), { budgetMs: 50_000 })
  if (result.failed.length) console.error('[cron/analytics-rollup] failed days:', result.failed)
  return NextResponse.json(
    {
      ok: result.ok,
      planned: result.planned,
      rolled: result.rolled.length,
      failed: result.failed.length,
      stoppedEarly: result.stoppedEarly,
      days: result.rolled.map((r) => r.day),
    },
    // Every day failing (e.g. migration 090 not applied) is a real error for the cron log.
    { status: result.rolled.length === 0 && result.failed.length > 0 ? 500 : 200 },
  )
}
