import { NextResponse } from 'next/server'
import { requireExpert } from '@/lib/expert-auth'
import { isBotConfigured } from '@/lib/telegram/bots/registry'
import { createExpertLinkCode, expertLinkStatus, unlinkExpertTelegram } from '@/lib/telegram/bots/expert/link'

export const dynamic = 'force-dynamic'

/**
 * Telegram of the signed-in expert in the expert bot (TELEGRAM_EXPERT_BOT_*):
 *   GET    → link status
 *   POST   → one-time deep link (15 min) to bind this account in the bot
 *   DELETE → unlink
 * Same gate as every /api/expert/* route (requireExpert).
 */
export async function GET() {
  const viewer = await requireExpert()
  if (!viewer) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  try {
    const s = await expertLinkStatus(viewer.id)
    return NextResponse.json({ ok: true, ...s, botConfigured: isBotConfigured('expert') })
  } catch {
    return NextResponse.json({ ok: true, linked: false, username: null, minLevel: 'INFO', botConfigured: false })
  }
}

export async function POST() {
  const viewer = await requireExpert()
  if (!viewer) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  if (!isBotConfigured('expert')) {
    return NextResponse.json({ ok: false, error: 'Бот экспертов не настроен: нужны TELEGRAM_EXPERT_BOT_TOKEN и TELEGRAM_EXPERT_WEBHOOK_SECRET' }, { status: 503 })
  }
  const link = await createExpertLinkCode(viewer.id)
  return NextResponse.json({ ok: true, deepLink: link.deepLink, expiresAt: link.expiresAt.toISOString() })
}

export async function DELETE() {
  const viewer = await requireExpert()
  if (!viewer) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  await unlinkExpertTelegram(viewer.id)
  return NextResponse.json({ ok: true })
}
