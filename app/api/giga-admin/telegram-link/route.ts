import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { prisma } from '@/lib/db'
import { createStaffLinkCode, unlinkStaffTelegram } from '@/lib/telegram/staff-link'
import { staffBot, staffBotReady } from '@/lib/telegram/bots/registry'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Telegram of the signed-in staff member (notifications + approval buttons +
 * the admin bot's control panel when TELEGRAM_ADMIN_BOT_* is configured).
 *   GET    → link status
 *   POST   → one-time deep link (15 min) to bind this account in the bot
 *   DELETE → unlink
 * Break-glass sessions are not a person and cannot link a Telegram account.
 */
async function guard(req: NextRequest) {
  const g = await requireGiga(req, 'dashboard.view')
  if (g.response) return { response: g.response }
  if (!UUID.test(g.actor.id)) {
    return { response: NextResponse.json({ ok: false, error: 'Привязка доступна только для личного аккаунта сотрудника' }, { status: 403 }) }
  }
  return { actor: g.actor }
}

export async function GET(req: NextRequest) {
  const g = await guard(req)
  if (g.response) return g.response
  const rows = await prisma.$queryRaw<Array<{ linked_at: Date | null; telegram_username: string | null; min_level: string }>>`
    SELECT linked_at, telegram_username, min_level FROM public.staff_telegram_links WHERE user_id = ${g.actor.id}::uuid`
  const r = rows[0]
  return NextResponse.json({
    ok: true,
    linked: Boolean(r?.linked_at),
    username: r?.telegram_username ?? null,
    minLevel: r?.min_level ?? 'WARNING',
    botConfigured: staffBotReady(),
    bot: staffBot(),
  })
}

export async function POST(req: NextRequest) {
  const g = await guard(req)
  if (g.response) return g.response
  if (!staffBotReady()) {
    return NextResponse.json({
      ok: false,
      error: 'Бот не настроен: нужны TELEGRAM_ADMIN_BOT_TOKEN и TELEGRAM_ADMIN_WEBHOOK_SECRET (или TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET)',
    }, { status: 503 })
  }
  const link = await createStaffLinkCode(g.actor.id)
  await recordAdminAction(g.actor, { action: 'staff.telegram.link_requested', entityType: 'staff_telegram_link', entityId: g.actor.id }, req)
  return NextResponse.json({ ok: true, deepLink: link.deepLink, expiresAt: link.expiresAt.toISOString() })
}

export async function DELETE(req: NextRequest) {
  const g = await guard(req)
  if (g.response) return g.response
  await unlinkStaffTelegram(g.actor.id)
  await recordAdminAction(g.actor, { action: 'staff.telegram.unlinked', entityType: 'staff_telegram_link', entityId: g.actor.id }, req)
  return NextResponse.json({ ok: true })
}
