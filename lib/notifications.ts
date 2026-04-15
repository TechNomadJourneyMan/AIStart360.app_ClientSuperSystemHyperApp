/**
 * Unified notification helper — sends alerts via:
 *   1. Email (Resend) — if RESEND_API_KEY is set
 *   2. Telegram Bot — if TELEGRAM_BOT_TOKEN + chat id (per-user or admin) are set
 *
 * All calls are non-blocking (fire-and-forget).
 */

import { sendNotificationEmail } from '@/lib/email'
import { createServerClient } from '@/lib/supabase-server'

// ─── Types ──────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'file_uploaded'
  | 'user_registered'
  | 'survey_completed'
  | 'expert_comment'

interface NotificationPayload {
  type: NotificationType
  userId?: string
  data: Record<string, unknown>
}

interface Recipient {
  email?: string | null
  telegramChatId?: string | null
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
    case 'expert_comment':
      return 'AIStart360: Новый комментарий эксперта'
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
    case 'expert_comment': {
      const expert = data.expertName || 'Эксперт'
      const title = data.expertTitle ? ` (${data.expertTitle})` : ''
      const block = data.blockKey ? ` · блок "${data.blockKey}"` : ''
      const preview = (data.preview as string) || ''
      return {
        title: 'Новый комментарий эксперта',
        body: `${expert}${title} оставил(а) комментарий${block}:\n\n"${preview.slice(0, 280)}${preview.length > 280 ? '…' : ''}"`,
      }
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

function buildCta(type: NotificationType): { label: string; url: string } {
  const base = process.env.AUTH_URL || 'https://aistart360.vercel.app'
  if (type === 'expert_comment') {
    return { label: 'Открыть дашборд', url: `${base}/client/dashboard` }
  }
  return { label: 'Open Giga Panel', url: `${base}/admin-giga-panel` }
}

// ─── Senders ────────────────────────────────────────────────────────────────

async function sendEmail(payload: NotificationPayload, to: string | null | undefined): Promise<void> {
  if (!to) return
  if (!process.env.RESEND_API_KEY) return

  const subject = buildSubject(payload.type)
  const { title, body } = buildEmailBody(payload)
  const cta = buildCta(payload.type)

  try {
    await sendNotificationEmail({
      to,
      subject,
      title,
      body,
      ctaLabel: cta.label,
      ctaUrl: cta.url,
    })
  } catch (err) {
    console.error('[notifications] Email send failed:', err)
  }
}

async function sendTelegram(payload: NotificationPayload, chatId: string | null | undefined): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
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

/** Look up a user's notification channels from their profile. */
async function getRecipient(userId: string): Promise<Recipient> {
  try {
    const sb = createServerClient()
    const { data } = await sb
      .from('profiles')
      .select('email, telegram_chat_id')
      .eq('id', userId)
      .maybeSingle()
    return {
      email: (data as { email?: string | null } | null)?.email ?? null,
      telegramChatId:
        (data as { telegram_chat_id?: string | null } | null)?.telegram_chat_id ?? null,
    }
  } catch {
    return {}
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Notify admins about an event. Non-blocking, fire-and-forget.
 * Tries email (Resend) and Telegram in parallel. Errors are logged, never thrown.
 */
export async function notifyAdmins(
  type: NotificationType,
  data: Record<string, unknown>,
  userId?: string,
): Promise<void> {
  const payload: NotificationPayload = { type, userId, data }
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL
  const adminChatId = process.env.TELEGRAM_CHAT_ID

  Promise.allSettled([sendEmail(payload, adminEmail), sendTelegram(payload, adminChatId)]).catch(
    () => {},
  )
}

/**
 * Notify a specific user (by their Supabase user id). Uses the email +
 * telegram_chat_id stored on their profile row. Non-blocking.
 *
 * Falls back to admin channels if the user has neither.
 */
export async function notifyUser(
  userId: string,
  type: NotificationType,
  data: Record<string, unknown>,
): Promise<void> {
  const payload: NotificationPayload = { type, userId, data }
  const recipient = await getRecipient(userId)

  const hasAnyChannel = recipient.email || recipient.telegramChatId
  if (!hasAnyChannel) {
    // User has no channels — still notify admins so the message is not lost
    notifyAdmins(type, { ...data, note: 'user has no email/telegram' }, userId)
    return
  }

  Promise.allSettled([
    sendEmail(payload, recipient.email),
    sendTelegram(payload, recipient.telegramChatId),
  ]).catch(() => {})
}
