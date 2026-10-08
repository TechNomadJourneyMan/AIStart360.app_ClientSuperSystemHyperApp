export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { syncTelegramPersonalInbox } from '@/lib/telegram/personal-sync'
import { isBearerAuthorized } from '@/lib/security/cron-auth'

// Bearer header only (the old ?secret= fallback leaked the secret into logs).
// Vercel Cron authenticates with CRON_SECRET; a dedicated
// TELEGRAM_PERSONAL_SYNC_SECRET is accepted too for manual/external runs.
function isAuthorized(req: NextRequest): boolean {
  return isBearerAuthorized(req, [process.env.TELEGRAM_PERSONAL_SYNC_SECRET, process.env.CRON_SECRET])
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
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
