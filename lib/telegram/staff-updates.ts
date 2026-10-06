/**
 * Staff-side handling of Telegram bot updates:
 *   /start staff_<code>   → bind the Telegram account to a staff user
 *   callback "ap:…"        → decide an agent approval (signed button)
 * Client-side /start <code> linking stays in the webhook route.
 */
import { prisma } from '@/lib/db'
import { hasPermission } from '@/lib/admin/rbac'
import { decideApproval } from '@/lib/agents/approvals'
import { closeApprovalCards } from '@/lib/notifications/approval-cards'
import { parseApprovalCallback } from '@/lib/notifications/approval-callback'
import { answerCallback, sendBotMessage } from './bot-api'
import type { BotId } from './bots/registry'
import { consumeStaffLinkCode, staffByTelegramUser, STAFF_START_PREFIX } from './staff-link'

export interface TgUser { id: number; username?: string; first_name?: string }
export interface TgCallbackQuery { id: string; from: TgUser; data?: string; message?: { chat?: { id?: number | string } } }

/** How long a seen update id is kept: Telegram retries an update for ~24 h at most. */
const SEEN_RETENTION = '2 days'
/** Prune old ids on roughly one insert in this many (update ids are sequential). */
const PRUNE_EVERY = 200

/**
 * First time we see this update id? (Replay protection; tolerant before
 * migration 087.) Only meaningful for authenticated updates — the webhook
 * calls it only when TELEGRAM_WEBHOOK_SECRET is set. Old ids are pruned
 * opportunistically so the table does not grow without bound.
 */
export async function firstSeenUpdate(updateId: unknown): Promise<boolean> {
  if (typeof updateId !== 'number' || !Number.isSafeInteger(updateId)) return true
  try {
    const rows = await prisma.$queryRaw<Array<{ update_id: bigint }>>`
      INSERT INTO public.telegram_updates_seen (update_id) VALUES (${BigInt(updateId)})
      ON CONFLICT (update_id) DO NOTHING RETURNING update_id`
    if (rows.length > 0 && updateId % PRUNE_EVERY === 0) await pruneSeenUpdates()
    return rows.length > 0
  } catch {
    return true
  }
}

/** Delete seen update ids older than the retention window. Never throws. */
export async function pruneSeenUpdates(): Promise<number> {
  try {
    return await prisma.$executeRaw`
      DELETE FROM public.telegram_updates_seen WHERE received_at < now() - ${SEEN_RETENTION}::interval`
  } catch (err) {
    console.error('[telegram] prune of telegram_updates_seen failed:', err instanceof Error ? err.message : err)
    return 0
  }
}

/**
 * Handling of an update failed after it was marked seen: forget it, so that
 * Telegram's retry of the same update_id is processed instead of dropped.
 */
export async function forgetUpdate(updateId: unknown): Promise<void> {
  if (typeof updateId !== 'number' || !Number.isSafeInteger(updateId)) return
  try {
    await prisma.$executeRaw`DELETE FROM public.telegram_updates_seen WHERE update_id = ${BigInt(updateId)}`
  } catch (err) {
    console.error('[telegram] could not forget update', updateId, err instanceof Error ? err.message : err)
  }
}

/**
 * Handles `/start staff_<code>`; returns false when the text is not a staff
 * link. `bot` — the bot that received it (client by default; the admin bot
 * once configured).
 *
 * Linking works only in the private chat with the bot (chat id = the user's
 * id): bound to a group, every staff alert and approval card would reach all
 * of its members. The code is not consumed when refused.
 */
export async function handleStaffStart(text: string, from: TgUser | undefined, chatId: string, fetchImpl?: typeof fetch, bot: BotId = 'client'): Promise<boolean> {
  const m = text.trim().match(/^\/start\s+(\S+)/)
  if (!m || !m[1].startsWith(STAFF_START_PREFIX)) return false
  if (!from?.id) return true
  if (String(from.id) !== String(chatId)) {
    await sendBotMessage(chatId, 'Привязка Telegram сотрудника работает только в личном чате с ботом. Откройте ссылку из панели GIGA в личных сообщениях.', undefined, fetchImpl, bot)
    return true
  }
  const code = m[1].slice(STAFF_START_PREFIX.length)
  const res = await consumeStaffLinkCode({ code, telegramUserId: from.id, chatId, username: from.username ?? null })
  await sendBotMessage(
    chatId,
    res.ok
      ? '✅ Telegram привязан к вашему аккаунту сотрудника AIStart360. Сюда будут приходить важные события платформы и запросы на одобрение действий агентов.'
      : 'Ссылка привязки недействительна или истекла. Получите новую в панели GIGA → Профиль → Telegram.',
    undefined,
    fetchImpl,
    bot,
  )
  return true
}

export type CallbackOutcome =
  | 'not_ours' | 'bad_signature' | 'not_linked' | 'no_permission' | 'audit_unavailable' | 'decided' | 'not_pending' | 'not_found'

/**
 * Journal entry written BEFORE the decision (like the panel route). It must
 * throw when the entry cannot be written — the decision is then not taken.
 */
export type ApprovalAudit = (entry: { actorId: string; role: string; approvalId: string; decision: string }) => Promise<void>

export async function handleApprovalCallback(
  q: TgCallbackQuery,
  deps: {
    fetchImpl?: typeof fetch
    audit: ApprovalAudit
    /** Bot that received the press (client by default). */
    bot?: BotId
  },
): Promise<CallbackOutcome> {
  const bot = deps.bot ?? 'client'
  if (!q.data?.startsWith('ap:')) return 'not_ours'
  const parsed = parseApprovalCallback(q.data)
  if (!parsed) {
    await answerCallback(q.id, 'Кнопка недействительна.', deps.fetchImpl, bot)
    return 'bad_signature'
  }
  const staff = await staffByTelegramUser(q.from.id)
  if (!staff) {
    await answerCallback(q.id, 'Telegram не привязан к аккаунту сотрудника.', deps.fetchImpl, bot)
    return 'not_linked'
  }
  if (!hasPermission(staff.role, 'approvals.decide')) {
    await answerCallback(q.id, 'Нет права принимать решения по действиям агентов.', deps.fetchImpl, bot)
    return 'no_permission'
  }

  try {
    await deps.audit({ actorId: staff.userId, role: staff.role, approvalId: parsed.approvalId, decision: parsed.action })
  } catch (err) {
    console.error('[telegram] approval refused, audit unavailable:', err instanceof Error ? err.message : err)
    await answerCallback(q.id, 'Журнал аудита недоступен — решение не принято. Попробуйте позже.', deps.fetchImpl, bot)
    return 'audit_unavailable'
  }

  const result = await decideApproval({
    approvalId: parsed.approvalId,
    decision: parsed.action,
    actorId: staff.userId,
    via: 'telegram',
  })

  if (!result.ok) {
    await answerCallback(q.id, result.reason === 'not_pending' ? 'Решение уже принято или срок истёк.' : 'Запрос не найден.', deps.fetchImpl, bot)
    return result.reason === 'not_pending' ? 'not_pending' : 'not_found'
  }
  await closeApprovalCards({
    approvalId: parsed.approvalId,
    status: result.status!,
    decidedBy: staff.email ?? staff.userId,
    via: 'telegram',
    summary: result.summary,
    fetchImpl: deps.fetchImpl,
  })
  await answerCallback(q.id, result.status === 'approved' ? 'Одобрено' : 'Отклонено', deps.fetchImpl, bot)
  return 'decided'
}
