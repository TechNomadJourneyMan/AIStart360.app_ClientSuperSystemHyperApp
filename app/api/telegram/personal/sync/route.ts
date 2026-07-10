export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { safeCompareTelegramSecret } from '@/lib/telegram/private-bot'
import { syncTelegramPersonalInbox } from '@/lib/telegram/personal-sync'

function requestToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim()
  return req.nextUrl.searchParams.get('secret')
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.TELEGRAM_PERSONAL_SYNC_SECRET || process.env.CRON_SECRET
  if (!secret) return false
  return safeCompareTelegramSecret(secret, requestToken(req))
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
