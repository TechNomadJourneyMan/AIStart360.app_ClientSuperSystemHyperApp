import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
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
 * Auth: только заголовок `Authorization: Bearer ${CRON_SECRET}` (так шлёт
 * Vercel Cron); секрет в query не принимается — он оседал бы в логах.
 */
function authorized(req: NextRequest, secret: string): boolean {
  const got = Buffer.from(req.headers.get('authorization') ?? '', 'utf8')
  const want = Buffer.from(`Bearer ${secret}`, 'utf8')
  return got.length === want.length && timingSafeEqual(got, want)
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  if (!authorized(req, secret)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

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
