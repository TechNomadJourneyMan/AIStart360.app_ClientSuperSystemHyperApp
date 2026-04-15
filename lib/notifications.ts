/**
 * Unified notification helper — sends alerts to admin(s) via:
 *   1. Email (Resend) — if RESEND_API_KEY is set
 *   2. Telegram Bot — if TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set
 *
 * All calls are non-blocking (fire-and-forget).
 */

import { sendNotificationEmail } from '@/lib/email'

// ─── Types ──────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'file_uploaded'
  | 'user_registered'
  | 'survey_completed'

interface NotificationPayload {
  type: NotificationType
  userId?: string
  data: Record<string, unknown>
}

// ─── Message builders ───────────────────────────────────────────────────────

function buildSubject(type: NotificationType): string {
  switch (type) {
    case 'file_uploaded':
      return 'AIStart360: Новый документ загружен'
    case 'user_registered':
      return 'AIStart360: Новая регистрация'
    case 'survey_completed':
      return 'AIStart360: Анкета завершена'
    default:
      return 'AIStart360: Уведомление'
  }
}

function buildEmailBody(payload: NotificationPayload): { title: string; body: string } {
  const { type, userId, data } = payload

  switch (type) {
    case 'file_uploaded':
      return {
        title: 'Новый документ загружен',
        body: `Пользователь ${data.userName || data.userEmail || userId || 'N/A'} загрузил файл "${data.fileName || 'N/A'}" (тип: ${data.docType || 'N/A'}).`,
      }
    case 'user_registered':
      return {
        title: 'Новая регистрация',
        body: `Новый пользователь зарегистрирован: ${data.name || 'N/A'} (${data.email || 'N/A'}), роль: ${data.role || 'N/A'}, организация: ${data.organization || 'N/A'}.`,
      }
    case 'survey_completed':
      return {
        title: 'Анкета завершена',
        body: `Пользователь ${data.userName || data.userEmail || userId || 'N/A'} завершил прохождение анкеты (шаг ${data.step || 'финал'}).`,
      }
    default:
      return {
        title: 'Уведомление',
        body: JSON.stringify(data),
      }
  }
}

function buildTelegramMessage(payload: NotificationPayload): string {
  const { title, body } = buildEmailBody(payload)
  return `<b>${title}</b>\n\n${body}`
}

// ─── Senders ────────────────────────────────────────────────────────────────

async function sendEmailNotification(payload: NotificationPayload): Promise<void> {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL
  if (!adminEmail) {
    console.warn('[notifications] No ADMIN_NOTIFICATION_EMAIL or ADMIN_EMAIL set, skipping email')
    return
  }
  if (!process.env.RESEND_API_KEY) {
    console.warn('[notifications] RESEND_API_KEY not set, skipping email')
    return
  }

  const subject = buildSubject(payload.type)
  const { title, body } = buildEmailBody(payload)

  try {
    await sendNotificationEmail({
      to: adminEmail,
      subject,
      title,
      body,
      ctaLabel: 'Open Giga Panel',
      ctaUrl: `${process.env.AUTH_URL || 'https://aistart360.vercel.app'}/giga-admin`,
    })
  } catch (err) {
    console.error('[notifications] Email send failed:', err)
  }
}

async function sendTelegramNotification(payload: NotificationPayload): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  const message = buildTelegramMessage(payload)

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
      signal: AbortSignal.timeout(5000),
    })
  } catch (err) {
    console.error('[notifications] Telegram send failed:', err)
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Notify admins about an event. Non-blocking, fire-and-forget.
 * Tries email (Resend) and Telegram in parallel. Errors are logged but never thrown.
 */
export async function notifyAdmins(type: NotificationType, data: Record<string, unknown>, userId?: string): Promise<void> {
  const payload: NotificationPayload = { type, userId, data }

  // Fire both channels in parallel, don't await — true fire-and-forget
  Promise.allSettled([
    sendEmailNotification(payload),
    sendTelegramNotification(payload),
  ]).catch(() => {
    // Should never reach here, but just in case
  })
}
