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
import { consumeStaffLinkCode, staffByTelegramUser, STAFF_START_PREFIX } from './staff-link'

export interface TgUser { id: number; username?: string; first_name?: string }
export interface TgCallbackQuery { id: string; from: TgUser; data?: string; message?: { chat?: { id?: number | string } } }

/** First time we see this update id? (Replay protection; tolerant before migration 087.) */
export async function firstSeenUpdate(updateId: unknown): Promise<boolean> {
  if (typeof updateId !== 'number' || !Number.isSafeInteger(updateId)) return true
  try {
    const rows = await prisma.$queryRaw<Array<{ update_id: bigint }>>`
      INSERT INTO public.telegram_updates_seen (update_id) VALUES (${BigInt(updateId)})
      ON CONFLICT (update_id) DO NOTHING RETURNING update_id`
    return rows.length > 0
  } catch {
    return true
  }
}

/** Handles `/start staff_<code>`; returns false when the text is not a staff link. */
export async function handleStaffStart(text: string, from: TgUser | undefined, chatId: string, fetchImpl?: typeof fetch): Promise<boolean> {
  const m = text.trim().match(/^\/start\s+(\S+)/)
  if (!m || !m[1].startsWith(STAFF_START_PREFIX)) return false
  if (!from?.id) return true
  const code = m[1].slice(STAFF_START_PREFIX.length)
  const res = await consumeStaffLinkCode({ code, telegramUserId: from.id, chatId, username: from.username ?? null })
  await sendBotMessage(
    chatId,
    res.ok
      ? '✅ Telegram привязан к вашему аккаунту сотрудника AIStart360. Сюда будут приходить важные события платформы и запросы на одобрение действий агентов.'
      : 'Ссылка привязки недействительна или истекла. Получите новую в панели GIGA → Профиль → Telegram.',
    undefined,
    fetchImpl,
  )
  return true
}

export type CallbackOutcome =
  | 'not_ours' | 'bad_signature' | 'not_linked' | 'no_permission' | 'decided' | 'not_pending' | 'not_found'

export async function handleApprovalCallback(
  q: TgCallbackQuery,
  deps: { fetchImpl?: typeof fetch; audit?: (entry: { actorId: string; role: string; approvalId: string; decision: string; ok: boolean }) => Promise<void> } = {},
): Promise<CallbackOutcome> {
  if (!q.data?.startsWith('ap:')) return 'not_ours'
  const parsed = parseApprovalCallback(q.data)
  if (!parsed) {
    await answerCallback(q.id, 'Кнопка недействительна.', deps.fetchImpl)
    return 'bad_signature'
  }
  const staff = await staffByTelegramUser(q.from.id)
  if (!staff) {
    await answerCallback(q.id, 'Telegram не привязан к аккаунту сотрудника.', deps.fetchImpl)
    return 'not_linked'
  }
  if (!hasPermission(staff.role, 'approvals.decide')) {
    await answerCallback(q.id, 'Нет права принимать решения по действиям агентов.', deps.fetchImpl)
    return 'no_permission'
  }

  const result = await decideApproval({
    approvalId: parsed.approvalId,
    decision: parsed.action,
    actorId: staff.userId,
    via: 'telegram',
  })
  await deps.audit?.({ actorId: staff.userId, role: staff.role, approvalId: parsed.approvalId, decision: parsed.action, ok: result.ok })

  if (!result.ok) {
    await answerCallback(q.id, result.reason === 'not_pending' ? 'Решение уже принято или срок истёк.' : 'Запрос не найден.', deps.fetchImpl)
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
  await answerCallback(q.id, result.status === 'approved' ? 'Одобрено' : 'Отклонено', deps.fetchImpl)
  return 'decided'
}
