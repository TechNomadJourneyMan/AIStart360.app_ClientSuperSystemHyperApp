import { NextRequest, NextResponse } from 'next/server'
import { adminRouter } from '@/lib/telegram/bots/admin'
import { defaultDeps } from '@/lib/telegram/bots/dispatcher'
import { processWebhook } from '@/lib/telegram/bots/webhook'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/telegram/admin — updates of the admin bot (TELEGRAM_ADMIN_BOT_TOKEN).
 *
 * Fail closed: without TELEGRAM_ADMIN_BOT_TOKEN and TELEGRAM_ADMIN_WEBHOOK_SECRET
 * nothing is processed (503). X-Telegram-Bot-Api-Secret-Token is compared in
 * constant time (401 on mismatch); every other outcome is 200 so Telegram does
 * not retry. Replays (same update_id) are dropped. See lib/telegram/bots.
 */
export async function POST(req: NextRequest) {
  const res = await processWebhook({
    bot: 'admin',
    headers: req.headers,
    body: () => req.json(),
    router: adminRouter,
    deps: defaultDeps(),
  })
  return NextResponse.json({ ok: res.status === 200 }, { status: res.status })
}
