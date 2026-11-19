export const dynamic = 'force-dynamic'

import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { sendTelegramMessage } from '@/lib/telegram'
import { recordAdminAction } from '@/lib/admin/audit'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { firstSeenUpdate, forgetUpdate, handleApprovalCallback, handleStaffStart, type TgCallbackQuery, type TgUser } from '@/lib/telegram/staff-updates'
import type { StaffRole } from '@/lib/admin/rbac'
import { handleTelegramInbound } from '@/lib/comm/inbound'
import { forwardUnlinkedClientBotUpdate } from '@/lib/omnichannel/telegram-client-bot'

/**
 * POST /api/telegram/webhook — приём апдейтов Telegram.
 *
 *   /start <code>          — привязка чата клиента (profiles.telegram_chat_id)
 *   /start staff_<code>    — привязка Telegram сотрудника (staff_telegram_links)
 *   callback «ap:…»        — решение по действию ИИ-агента (кнопки Одобрить / Отклонить)
 *   свободный текст        — из чата, привязанного к профилю, → входящее сообщение
 *                            в диалог пользователя (lib/comm/inbound.ts, раздел
 *                            GIGA «Сообщения»); короткая квитанция не чаще раза
 *                            в 6 ч. Только при заданном секрете: без него апдейт
 *                            можно подделать, а сообщение попало бы в чужой диалог.
 *                            Чат без привязки → единый inbox GIGA (канал
 *                            Telegram, источник «Бот AIStart360»; только черновики),
 *                            lib/omnichannel/telegram-client-bot.ts.
 *
 * Защита (R-139, как у ботов персонала /api/telegram/admin и /expert): без
 * TELEGRAM_WEBHOOK_SECRET не обрабатывается НИЧЕГО — 503 (fail closed); заголовок
 * X-Telegram-Bot-Api-Secret-Token сравнивается с секретом за постоянное время
 * (401 при несовпадении). Вебхук регистрируется с этим секретом:
 * `npx tsx scripts/telegram/set-webhooks.ts https://<домен> --bots client`
 * (docs/deploy/runbook.md). Повтор апдейта с тем же update_id игнорируется.
 * Если обработка упала, отметка «видели» снимается и отвечаем 500, чтобы повтор
 * Telegram не потерялся. Иначе всегда 200.
 *
 * Код привязки /start <code> живёт 15 минут (profiles.telegram_link_code_expires_at,
 * миграция 158; выдаёт POST /api/v1/settings/telegram) и срабатывает один раз:
 * привязка — условная запись «код всё ещё этот». Код без срока (выдан до 158) не
 * принимается. Лимит /start — 10 за 10 минут на чат: chat.id приходит в теле, но
 * тело уже подтверждено секретом, то есть это настоящий чат Telegram.
 *
 * Решение по одобрению: запись в журнал аудита ДО решения и обязательная
 * (как в панели); журнал недоступен → решение не принимается.
 */
function secretMatches(expected: string, got: string | null): boolean {
  if (!got) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(got)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null
  if (!secret) return NextResponse.json({ ok: false }, { status: 503 })
  if (!secretMatches(secret, req.headers.get('x-telegram-bot-api-secret-token'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let update: Record<string, unknown> | null
  try {
    update = (await req.json()) as Record<string, unknown> | null
  } catch {
    return NextResponse.json({ ok: true }) // мусор — молча проглатываем
  }
  if (!update || typeof update !== 'object') return NextResponse.json({ ok: true })
  if (!(await firstSeenUpdate(update.update_id))) return NextResponse.json({ ok: true })

  try {
    return await handleUpdate(req, update)
  } catch (err) {
    console.error('[telegram/webhook] update failed', err instanceof Error ? err.message : err)
    await forgetUpdate(update.update_id)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

async function handleUpdate(req: NextRequest, update: Record<string, unknown>): Promise<NextResponse> {
  // ── Кнопки одобрения ──
  const callback = update.callback_query as TgCallbackQuery | undefined
  if (callback?.id) {
    await handleApprovalCallback(callback, {
      audit: async ({ actorId, role, approvalId, decision }) => {
        await recordAdminAction(
          { id: actorId, kind: 'telegram', role: role as StaffRole },
          {
            action: 'agent.approval.decide',
            entityType: 'agent_approval',
            entityId: approvalId,
            newValue: { decision },
            metadata: { via: 'telegram' },
          },
          req,
          { required: true },
        )
      },
    })
    return NextResponse.json({ ok: true })
  }

  const msg = update.message as { chat?: { id?: unknown }; text?: unknown; caption?: unknown; message_id?: unknown; date?: unknown; from?: TgUser } | undefined
  const rawChatId = msg?.chat?.id
  const chatId = typeof rawChatId === 'number' || typeof rawChatId === 'string' ? String(rawChatId) : null
  const text = typeof msg?.text === 'string' ? msg.text : ''
  if (!chatId) return NextResponse.json({ ok: true })
  // Link codes are guessable only by brute force: 10 /start per chat per 10 min.
  if (/^\/start\b/.test(text.trim()) && (await isRateLimitedKey(chatId, 'telegram-link', { max: 10, windowMs: 10 * 60_000 }))) return NextResponse.json({ ok: true })

  // ── Привязка сотрудника ──
  if (await handleStaffStart(text, msg?.from, chatId)) {
    return NextResponse.json({ ok: true })
  }

  // ── Привязка клиента (как раньше) ──
  const m = text.trim().match(/^\/start(?:\s+(\S+))?/)
  if (!m) {
    // Свободный текст (или подпись к фото) от привязанного чата → диалог пользователя.
    const free = text || (typeof msg?.caption === 'string' ? msg.caption : '')
    if (free.trim()) {
      const linked = await handleTelegramInbound({
        chatId,
        text: free,
        messageId: typeof msg?.message_id === 'number' || typeof msg?.message_id === 'string' ? msg.message_id : null,
        date: typeof msg?.date === 'number' ? msg.date : null,
      })
      // Чат без привязки к профилю → единый inbox (GIGA, «Бот AIStart360»).
      // Fail-soft, никогда не роняет webhook.
      if (!linked) await forwardUnlinkedClientBotUpdate(update, { linkChecked: !free.trim().startsWith('/') })
    }
    return NextResponse.json({ ok: true })
  }

  const code = m[1]
  if (!code) {
    await sendTelegramMessage(
      chatId,
      'Привет! Чтобы получать сюда напоминания, откройте ссылку из раздела «Настройки → Уведомления» в кабинете AIStart360.',
    )
    return NextResponse.json({ ok: true })
  }

  const NOT_FOUND = 'Код привязки не найден, устарел или уже использован. Сгенерируйте новую ссылку в настройках кабинета.'
  const svc = createServiceClient()
  // Only a code that has not expired (a code without an expiry — issued before 158 — never matches).
  const { data: rows } = await svc
    .from('profiles')
    .select('id')
    .eq('telegram_link_code', code)
    .gt('telegram_link_code_expires_at', new Date().toISOString())
    .limit(1)
  const profileId = (rows?.[0] as { id?: string } | undefined)?.id
  if (!profileId) {
    await sendTelegramMessage(chatId, NOT_FOUND)
    return NextResponse.json({ ok: true })
  }

  // Single use: the bind happens only while the profile still holds this code.
  const { data: bound, error } = await svc
    .from('profiles')
    .update({ telegram_chat_id: chatId, telegram_link_code: null, telegram_link_code_expires_at: null })
    .eq('id', profileId)
    .eq('telegram_link_code', code)
    .select('id')
  if (error) {
    console.error('[telegram/webhook] bind failed', error.message)
    await sendTelegramMessage(chatId, 'Не удалось привязать чат, попробуйте позже.')
    return NextResponse.json({ ok: true })
  }
  if (!bound || (bound as unknown[]).length === 0) {
    await sendTelegramMessage(chatId, NOT_FOUND)
    return NextResponse.json({ ok: true })
  }

  await sendTelegramMessage(
    chatId,
    '✅ Готово! Сюда будут приходить напоминания CRM и инсайты по вашему бизнесу. Отключить можно в настройках кабинета.',
  )
  return NextResponse.json({ ok: true })
}
