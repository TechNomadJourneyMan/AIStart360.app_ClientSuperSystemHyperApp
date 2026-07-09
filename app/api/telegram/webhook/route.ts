export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { sendTelegramMessage } from '@/lib/telegram'

/**
 * POST /api/telegram/webhook — приём апдейтов Telegram.
 *
 * Обрабатываем ТОЛЬКО `/start <code>`: находим профиль по одноразовому
 * telegram_link_code → записываем telegram_chat_id, очищаем код, шлём
 * подтверждение. Незнакомый/пустой код → вежливый ответ. Всегда отвечаем 200
 * (кроме проваленной проверки секрета), чтобы Telegram не ретраил бесконечно.
 *
 * Защита: если задан TELEGRAM_WEBHOOK_SECRET, требуем совпадения заголовка
 * X-Telegram-Bot-Api-Secret-Token (Telegram шлёт его, если secret_token задан
 * при setWebhook). Коды крипто-случайны (12 hex) и одноразовы.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (secret) {
    const got = req.headers.get('x-telegram-bot-api-secret-token')
    if (got !== secret) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }
  }

  let update: unknown
  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ ok: true }) // мусор — молча проглатываем
  }

  const msg = (update as { message?: { chat?: { id?: unknown }; text?: unknown } } | null)?.message
  const rawChatId = msg?.chat?.id
  const chatId =
    typeof rawChatId === 'number' || typeof rawChatId === 'string' ? String(rawChatId) : null
  const text = typeof msg?.text === 'string' ? msg.text : ''
  if (!chatId) return NextResponse.json({ ok: true })

  const m = text.trim().match(/^\/start(?:\s+(\S+))?/)
  if (!m) return NextResponse.json({ ok: true }) // не /start — игнор

  const code = m[1]
  if (!code) {
    await sendTelegramMessage(
      chatId,
      'Привет! Чтобы получать сюда напоминания, откройте ссылку из раздела «Настройки → Уведомления» в кабинете AIStart360.',
    )
    return NextResponse.json({ ok: true })
  }

  const svc = createServiceClient()
  const { data: rows } = await svc
    .from('profiles')
    .select('id')
    .eq('telegram_link_code', code)
    .limit(1)
  const profileId = (rows?.[0] as { id?: string } | undefined)?.id
  if (!profileId) {
    await sendTelegramMessage(
      chatId,
      'Код привязки не найден или уже использован. Сгенерируйте новую ссылку в настройках кабинета.',
    )
    return NextResponse.json({ ok: true })
  }

  const { error } = await svc
    .from('profiles')
    .update({ telegram_chat_id: chatId, telegram_link_code: null })
    .eq('id', profileId)
  if (error) {
    console.error('[telegram/webhook] bind failed', error)
    await sendTelegramMessage(chatId, 'Не удалось привязать чат, попробуйте позже.')
    return NextResponse.json({ ok: true })
  }

  await sendTelegramMessage(
    chatId,
    '✅ Готово! Сюда будут приходить напоминания CRM и инсайты по вашему бизнесу. Отключить можно в настройках кабинета.',
  )
  return NextResponse.json({ ok: true })
}
