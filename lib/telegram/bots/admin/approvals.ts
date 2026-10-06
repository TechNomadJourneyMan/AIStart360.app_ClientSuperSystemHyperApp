/**
 * ✅ Одобрения — pending agent approvals (agents.view, as GET
 * agents/approvals) with the SAME signed buttons as the notification cards
 * («ap:…», lib/notifications/approval-callback.ts). A press is handled by
 * lib/telegram/staff-updates.ts handleApprovalCallback: linked staff with
 * approvals.decide, atomic decideApproval, cards closed, audit entry.
 */
import { listApprovals } from '@/lib/agents/admin'
import { approvalCallbackData } from '@/lib/notifications/approval-callback'
import { handleApprovalCallback } from '@/lib/telegram/staff-updates'
import type { StaffRole } from '@/lib/admin/rbac'
import type { BotDeps, TgCallbackQuery } from '../dispatcher'
import { callApi, type InlineButton } from '../registry'
import { cut, dt, esc, pageOf, pagerRow } from '../ui'
import { can, type AdminCtx, type AdminEntry } from './context'

const PAGE = 5

export async function showApprovals(ctx: AdminCtx, page = 0): Promise<void> {
  const all = await listApprovals('pending', 100)
  const live = all.filter((a) => !a.expires_at || new Date(a.expires_at as Date) > ctx.deps.now())
  const slice = live.slice(page * PAGE, (page + 1) * PAGE)
  if (!slice.length) {
    await ctx.show(page ? 'На этой странице пусто.' : '✅ Запросов на одобрение нет.', [[ctx.button('🔄 Обновить', 'ap.l', 0)]])
    return
  }
  const decide = can(ctx, 'approvals.decide')
  await ctx.show(
    `🟡 <b>Ждут решения: ${live.length}</b>${decide ? '' : '\n<i>У вашей роли нет права решать — только просмотр.</i>'}`,
    [pagerRow(ctx, 'ap.l', page, live.length > (page + 1) * PAGE), [ctx.button('🔄 Обновить', 'ap.l', page)]],
  )
  // One card per approval, so a decision closes exactly its own message.
  for (const a of slice) {
    const text = [
      `🟡 <b>${esc(cut(a.summary, 300))}</b>`,
      `Агент: ${esc(a.agent_key)}${a.company_name ? ` · ${esc(a.company_name)}` : ''}`,
      `Инструмент: ${esc(a.tool)} · право ${esc(a.permission)}`,
      `Запрошено ${dt(a.requested_at)} · истекает ${dt(a.expires_at)}`,
    ].join('\n')
    const yes = decide ? approvalCallbackData(String(a.id), 'approve') : null
    const no = decide ? approvalCallbackData(String(a.id), 'reject') : null
    const kb: InlineButton[][] = yes && no ? [[{ text: '✅ Одобрить', callback_data: yes }, { text: '❌ Отклонить', callback_data: no }]] : []
    await ctx.reply(text, kb.length ? { inline_keyboard: kb } : undefined)
  }
}

export const approvalEntries: Record<string, AdminEntry> = {
  'ap.l': { perm: 'agents.view', run: (ctx, [p]) => showApprovals(ctx, pageOf(p)) },
}

/** Approval buttons pressed in the admin bot (cards and the list above). */
export async function adminApprovalCallback(q: TgCallbackQuery, deps: BotDeps): Promise<boolean> {
  const outcome = await handleApprovalCallback(q, {
    bot: 'admin',
    fetchImpl: deps.fetchImpl,
    audit: async ({ actorId, role, approvalId, decision, ok }) => {
      await deps.audit(
        { id: actorId, kind: 'telegram', role: role as StaffRole },
        { action: 'agent.approval.decide', entityType: 'agent_approval', entityId: approvalId, newValue: { decision, applied: ok }, metadata: { via: 'telegram' } },
      )
    },
  })
  // Cards from the list are not delivery records: drop their buttons once decided.
  const chatId = q.message?.chat?.id
  if ((outcome === 'decided' || outcome === 'not_pending') && chatId != null && q.message?.message_id) {
    await callApi('admin', 'editMessageReplyMarkup', {
      chat_id: chatId, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] },
    }, deps.fetchImpl)
  }
  return true
}
