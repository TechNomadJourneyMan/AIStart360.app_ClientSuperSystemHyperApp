import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { prisma } from '@/lib/db'
import { runCrosswatch } from '@/lib/ops/crosswatch'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DB_TIMEOUT_MS = 5_000

/** This service's own database round trip, bounded: a hung pool counts as down. */
async function checkDb(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      prisma.$queryRaw`SELECT 1`.then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), DB_TIMEOUT_MS) }),
    ])
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * GET /api/cron/ops-crosswatch — перекрёстный сторож (R4-A1, N4A-2), раз в 3 минуты на сервисе
 * агентов (lib/cron/schedule.ts, только при отдельном сервисе агентов).
 *
 * Проверяет портал (GET /api/health по PORTAL_SERVICE_URL, иначе по NEXT_PUBLIC_APP_URL) и свою
 * связь с базой; тревога — напрямую в Telegram без базы (TELEGRAM_ADMIN_CHAT_IDS), после двух
 * неудачных проверок подряд, потом не чаще раза в 6 ч, и «восстановлено». Логика — lib/ops/crosswatch.ts.
 *
 * Auth: только заголовок `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 503 ? 'cron_not_configured' : 'unauthorized' }, { status: auth.status })
  }
  try {
    const report = await runCrosswatch({ checkDb })
    return NextResponse.json({ ok: true, ...report })
  } catch (e) {
    console.error('[cron/ops-crosswatch]', e instanceof Error ? e.message.split('\n')[0].slice(0, 200) : 'error')
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
