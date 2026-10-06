export const dynamic = 'force-dynamic'

import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { sendTelegramMessage } from '@/lib/telegram'
import { recordAdminAction } from '@/lib/admin/audit'
import { firstSeenUpdate, handleApprovalCallback, handleStaffStart, type TgCallbackQuery, type TgUser } from '@/lib/telegram/staff-updates'
import { answerCallback } from '@/lib/telegram/bot-api'
import type { StaffRole } from '@/lib/admin/rbac'

/**
 * POST /api/telegram/webhook — приём апдейтов Telegram.
 *
 *   /start <code>          — привязка чата клиента (profiles.telegram_chat_id)
 *   /start staff_<code>    — привязка Telegram сотрудника (staff_telegram_links)
 *   callback «ap:…»        — решение по действию ИИ-агента (кнопки Одобрить / Отклонить)
 *
 * Защита: заголовок X-Telegram-Bot-Api-Secret-Token сравнивается с
 * TELEGRAM_WEBHOOK_SECRET за постоянное время. Привязка сотрудников и
 * одобрения работают ТОЛЬКО при заданном секрете (fail closed); без секрета
 * обрабатывается лишь клиентский /start, как раньше, чтобы не ломать прод до
 * настройки (см. docs/platform/README.md, BLOCKED). Повтор апдейта с тем же
 * update_id игнорируется. Всегда 200 (кроме неверного секрета), чтобы Telegram
 * не ретраил бесконечно.
 */
function secretMatches(expected: string, got: string | null): boolean {
  if (!got) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(got)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null
  if (secret && !secretMatches(secret, req.headers.get('x-telegram-bot-api-secret-token'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const staffFeaturesEnabled = Boolean(secret)

  let update: Record<string, unknown> | null
  try {
    update = (await req.json()) as Record<string, unknown> | null
  } catch {
    return NextResponse.json({ ok: true }) // мусор — молча проглатываем
  }
  if (!update || typeof update !== 'object') return NextResponse.json({ ok: true })
  if (!(await firstSeenUpdate(update.update_id))) return NextResponse.json({ ok: true })

  // ── Кнопки одобрения ──
  const callback = update.callback_query as TgCallbackQuery | undefined
  if (callback?.id) {
    if (!staffFeaturesEnabled) {
      await answerCallback(callback.id, 'Одобрения через Telegram не настроены.')
      return NextResponse.json({ ok: true })
    }
    await handleApprovalCallback(callback, {
      audit: async ({ actorId, role, approvalId, decision, ok }) => {
        await recordAdminAction(
          { id: actorId, kind: 'session', role: role as StaffRole },
          {
            action: 'agent.approval.decide',
            entityType: 'agent_approval',
            entityId: approvalId,
            newValue: { decision, applied: ok },
            metadata: { via: 'telegram' },
          },
          req,
        )
      },
    })
    return NextResponse.json({ ok: true })
  }

  const msg = update.message as { chat?: { id?: unknown }; text?: unknown; from?: TgUser } | undefined
  const rawChatId = msg?.chat?.id
  const chatId = typeof rawChatId === 'number' || typeof rawChatId === 'string' ? String(rawChatId) : null
  const text = typeof msg?.text === 'string' ? msg.text : ''
  if (!chatId) return NextResponse.json({ ok: true })

  // ── Привязка сотрудника ──
  if (staffFeaturesEnabled && (await handleStaffStart(text, msg?.from, chatId))) {
    return NextResponse.json({ ok: true })
  }

  // ── Привязка клиента (как раньше) ──
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
