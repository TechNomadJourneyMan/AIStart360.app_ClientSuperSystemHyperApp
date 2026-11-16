export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { syncTelegramPersonalInbox, telegramPersonalSyncConfigured } from '@/lib/telegram/personal-sync'
import { isBearerAuthorized } from '@/lib/security/cron-auth'
import { withDeadline } from '@/lib/runtime/deadline'

// Bearer header only (the old ?secret= fallback leaked the secret into logs).
// Vercel Cron authenticates with CRON_SECRET; a dedicated
// TELEGRAM_PERSONAL_SYNC_SECRET is accepted too for manual/external runs.
function isAuthorized(req: NextRequest): boolean {
  return isBearerAuthorized(req, [process.env.TELEGRAM_PERSONAL_SYNC_SECRET, process.env.CRON_SECRET])
}

async function handleGet(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  // The cron runs this every day on every deployment. One without a personal Telegram account has
  // nothing to sync: that is not a failure, so it is not answered with the 500 (and the error
  // line) the client's own configuration check would produce.
  if (!telegramPersonalSyncConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'not_configured' })
  }

  try {
    const result = await syncTelegramPersonalInbox()
    return NextResponse.json(result)
  } catch (error) {
    console.error('[telegram/personal-sync] route failed:', error)
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Telegram personal sync failed',
      },
      { status: 500 },
    )
  }
}

/**
 * R-015: on Railway `next start` ignores maxDuration, so the request had no time limit. After 60 s the client
 * gets 504 (DEADLINE_EXCEEDED) and the work below sees its deadline spent. ROUTE_DEADLINE_MS_TELEGRAM_PERSONAL_SYNC overrides it;
 * ROUTE_DEADLINE_DISABLED=1 turns it off.
 */
export const GET = withDeadline(handleGet, { label: 'telegram-personal-sync', ms: 60_000 })
