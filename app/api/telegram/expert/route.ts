import { NextRequest, NextResponse } from 'next/server'
import { expertRouter } from '@/lib/telegram/bots/expert'
import { deferOrAwait } from '@/lib/telegram/bots/defer'
import { defaultDeps } from '@/lib/telegram/bots/dispatcher'
import { processWebhook } from '@/lib/telegram/bots/webhook'

export const dynamic = 'force-dynamic'
// The update is processed after the 200 (waitUntil): assistant answers with
// tools, voice and documents may take minutes.
export const maxDuration = 300

/**
 * POST /api/telegram/expert — updates of the expert bot (TELEGRAM_EXPERT_BOT_TOKEN).
 *
 * Fail closed: without TELEGRAM_EXPERT_BOT_TOKEN and TELEGRAM_EXPERT_WEBHOOK_SECRET
 * nothing is processed (503). X-Telegram-Bot-Api-Secret-Token is compared in
 * constant time (401 on mismatch); every other outcome is 200. Replays are
 * dropped. After those checks the update is handled in the background
 * (lib/telegram/bots/defer.ts) and 200 is returned at once.
 */
export async function POST(req: NextRequest) {
  const res = await processWebhook({
    bot: 'expert',
    headers: req.headers,
    body: () => req.json(),
    router: expertRouter,
    deps: defaultDeps(),
    defer: deferOrAwait,
  })
  return NextResponse.json({ ok: res.status === 200 }, { status: res.status })
}
