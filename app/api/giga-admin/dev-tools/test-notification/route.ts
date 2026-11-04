export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { createNotification } from '@/lib/notifications/create'
import { sendBotMessage, tgEscape } from '@/lib/telegram/bot-api'
import { isBotConfigured, staffBot } from '@/lib/telegram/bots/registry'

/**
 * POST /api/giga-admin/dev-tools/test-notification — тестовое уведомление
 * ТОЛЬКО СЕБЕ: запись в ленту в кабинете (app_notifications) и, если Telegram
 * привязан к аккаунту (staff_telegram_links), сообщение в этот чат.
 * Общая лента персонала (notifyStaff) не используется — она ушла бы всем.
 */
export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, 'devtools.use')
  if (guard.response) return guard.response
  const actor = guard.actor
  if (await isRateLimitedKey(actor.id, 'devtools-test-notify', { max: 10, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Не чаще 10 тестовых уведомлений за 10 минут' }, { status: 429 })
  }

  const at = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })
  const inApp = await createNotification({
    userId: actor.id,
    title: 'Тестовое уведомление',
    body: `Отправлено из Dev-tools ${at}. Если вы его видите — уведомления в кабинете работают.`,
    category: 'system',
    priority: 'low',
    link: '/admin-giga-panel/dev-tools',
    metadata: { test: true, source: 'devtools' },
  })

  let telegram: { status: 'sent' | 'failed' | 'not_linked' | 'bot_not_configured'; error?: string } = { status: 'not_linked' }
  try {
    const { data } = await createServiceClient()
      .from('staff_telegram_links').select('chat_id, linked_at').eq('user_id', actor.id).maybeSingle()
    const link = data as { chat_id?: string | null; linked_at?: string | null } | null
    if (link?.chat_id && link.linked_at) {
      const bot = staffBot()
      if (!isBotConfigured(bot)) {
        telegram = { status: 'bot_not_configured' }
      } else {
        const res = await sendBotMessage(link.chat_id, `🧪 <b>[AIStart360] Тестовое уведомление</b>\n\nОтправлено из Dev-tools ${tgEscape(at)}.`, undefined, undefined, bot)
        telegram = res.ok ? { status: 'sent' } : { status: 'failed', error: res.description }
      }
    }
  } catch (e) {
    telegram = { status: 'failed', error: e instanceof Error ? e.message : 'error' }
  }

  await recordAdminAction(actor, {
    action: 'devtools.test_notification',
    entityType: 'devtools', entityId: actor.id, targetUserId: actor.id,
    metadata: { inApp, telegram: telegram.status },
  }, req).catch(() => false)

  return NextResponse.json({ ok: true, inApp, telegram })
}
