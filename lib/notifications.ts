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
  | 'user_login'
  | 'survey_completed'
  | 'survey_step_saved'
  | 'diagnostic_calculated'
  | 'diagnostic_recalculated'
  | 'document_approved'
  | 'document_rejected'
  | 'profile_updated'
  | 'expert_comment'
  | 'expert_comment_edited'
  | 'expert_comment_deleted'
  | 'gri_strategy_generated'
  | 'gri_report_saved'
  | 'ai_query'
  | 'admin_action'

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
    case 'file_uploaded':           return 'AIStart360: Новый документ загружен'
    case 'user_registered':         return 'AIStart360: Новая регистрация'
    case 'user_login':              return 'AIStart360: Вход пользователя'
    case 'survey_completed':        return 'AIStart360: Анкета завершена'
    case 'survey_step_saved':       return 'AIStart360: Шаг анкеты сохранён'
    case 'diagnostic_calculated':   return 'AIStart360: Диагностика рассчитана'
    case 'diagnostic_recalculated': return 'AIStart360: Диагностика пересчитана'
    case 'document_approved':       return 'AIStart360: Документ одобрен'
    case 'document_rejected':       return 'AIStart360: Документ отклонён'
    case 'profile_updated':         return 'AIStart360: Профиль обновлён'
    case 'expert_comment':          return 'AIStart360: Новый комментарий эксперта'
    case 'expert_comment_edited':   return 'AIStart360: Комментарий эксперта отредактирован'
    case 'expert_comment_deleted':  return 'AIStart360: Комментарий эксперта удалён'
    case 'gri_strategy_generated':  return 'AIStart360: GRI-стратегия сгенерирована'
    case 'gri_report_saved':        return 'AIStart360: GRI-отчёт сохранён'
    case 'ai_query':                return 'AIStart360: AI-запрос'
    case 'admin_action':            return 'AIStart360: Действие администратора'
    default:                         return 'AIStart360: Уведомление'
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
    case 'expert_comment_edited':
      return {
        title: 'Комментарий эксперта отредактирован',
        body: `${data.expertName || 'Эксперт'} изменил комментарий. Новый текст:\n\n"${String(data.preview ?? '').slice(0, 280)}"`,
      }
    case 'expert_comment_deleted':
      return {
        title: 'Комментарий эксперта удалён',
        body: `${data.expertName || 'Эксперт'} удалил свой комментарий у клиента ${data.clientId ?? 'N/A'}.`,
      }
    case 'user_login':
      return {
        title: 'Вход пользователя',
        body: `Пользователь ${data.userName || data.userEmail || userId || 'N/A'} вошёл в систему. Роль: ${data.role || 'N/A'}. IP: ${data.ip || 'N/A'}.`,
      }
    case 'survey_step_saved':
      return {
        title: 'Шаг анкеты сохранён',
        body: `Пользователь ${data.userName || data.userEmail || userId || 'N/A'} сохранил шаг "${data.step ?? 'N/A'}" анкеты (${data.stepNumber ?? '?'} / ${data.totalSteps ?? '?'}).`,
      }
    case 'diagnostic_calculated':
      return {
        title: 'Диагностика рассчитана',
        body: `Для пользователя ${data.userName || data.userEmail || userId || 'N/A'} рассчитана диагностика. Overall: ${data.overallScore ?? 'N/A'}, стадия: ${data.stage || 'N/A'}.`,
      }
    case 'diagnostic_recalculated':
      return {
        title: 'Диагностика пересчитана',
        body: `Пользователь ${data.userName || data.userEmail || userId || 'N/A'} запустил пересчёт диагностики. Новый Overall: ${data.overallScore ?? 'N/A'}.`,
      }
    case 'document_approved':
      return {
        title: 'Документ одобрен',
        body: `Документ "${data.fileName || 'N/A'}" одобрен для пользователя ${data.userName || data.userEmail || userId || 'N/A'}.`,
      }
    case 'document_rejected':
      return {
        title: 'Документ отклонён',
        body: `Документ "${data.fileName || 'N/A'}" отклонён для пользователя ${data.userName || data.userEmail || userId || 'N/A'}. Причина: ${data.reason || 'не указана'}.`,
      }
    case 'profile_updated': {
      const fields = Array.isArray(data.changedFields) ? (data.changedFields as string[]).join(', ') : (data.changedFields || 'N/A')
      return {
        title: 'Профиль обновлён',
        body: `Пользователь ${data.userName || data.userEmail || userId || 'N/A'} обновил профиль. Изменены поля: ${fields}.`,
      }
    }
    case 'gri_strategy_generated':
      return {
        title: 'GRI-стратегия сгенерирована',
        body: `Пользователь ${data.userName || data.userEmail || userId || 'N/A'} сгенерировал стратегию (${data.variant || 'action_plan'}). GRI: ${data.griScore ?? 'N/A'} → target: ${data.targetGRI ?? 'N/A'}.`,
      }
    case 'gri_report_saved':
      return {
        title: 'GRI-отчёт сохранён',
        body: `Пользователь ${data.userName || data.userEmail || userId || 'N/A'} сохранил GRI-отчёт (сессия "${data.sessionName || 'N/A'}"). Score: ${data.griScore ?? 'N/A'}.`,
      }
    case 'ai_query':
      return {
        title: 'AI-запрос',
        body: `Пользователь ${data.userName || data.userEmail || userId || 'N/A'} отправил AI-запрос. Роут: ${data.route || 'N/A'}. Промпт (начало): "${String(data.promptPreview ?? '').slice(0, 140)}".`,
      }
    case 'admin_action':
      return {
        title: 'Действие администратора',
        body: `${data.adminName || 'Администратор'} выполнил действие "${data.action || 'N/A'}" над пользователем ${data.targetUser || 'N/A'}.`,
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
// ── Rate-limit cache ──────────────────────────────────────────────────────
// In-memory dedupe: if the same (type+userId+signature) fires multiple times
// within the window, only the first goes out to admins. Prevents spam on
// bursty events (e.g. expert edits the same comment 5 times in a minute).
// Lives on the Vercel function instance — resets on cold start, which is
// fine for our purposes.
const RATE_LIMIT_WINDOW_MS = 60_000  // 1 minute
const rateLimitCache = new Map<string, number>()

function rateLimitKey(type: string, userId: string | undefined, data: Record<string, unknown>): string {
  // Include a small stable signature from data so edits of DIFFERENT entities
  // still send independently. `commentId` / `id` / `preview` cover our cases.
  const sig = (data.commentId ?? data.id ?? String(data.preview ?? '').slice(0, 40)) as string
  return `${type}|${userId ?? ''}|${sig}`
}

function isRateLimited(key: string): boolean {
  const now = Date.now()
  // Opportunistic cleanup of stale keys to keep map small
  if (rateLimitCache.size > 1000) {
    for (const [k, t] of rateLimitCache) {
      if (now - t > RATE_LIMIT_WINDOW_MS * 2) rateLimitCache.delete(k)
    }
  }
  const last = rateLimitCache.get(key)
  if (last && now - last < RATE_LIMIT_WINDOW_MS) return true
  rateLimitCache.set(key, now)
  return false
}

export async function notifyAdmins(
  type: NotificationType,
  data: Record<string, unknown>,
  userId?: string,
): Promise<void> {
  // Rate-limit duplicate notifications within 60s
  if (isRateLimited(rateLimitKey(type, userId, data))) return

  const payload: NotificationPayload = { type, userId, data }
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL

  // Multi-admin Telegram: TELEGRAM_ADMIN_CHAT_IDS="id1,id2,id3" (preferred).
  // Falls back to legacy TELEGRAM_CHAT_ID for single-admin setups.
  const rawIds = process.env.TELEGRAM_ADMIN_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || ''
  const adminChatIds = rawIds
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^-?\d+$/.test(s))

  const tasks: Array<Promise<unknown>> = [sendEmail(payload, adminEmail)]
  for (const cid of adminChatIds) tasks.push(sendTelegram(payload, cid))

  Promise.allSettled(tasks).catch(() => {})
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
