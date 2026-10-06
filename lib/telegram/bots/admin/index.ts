/**
 * lib/telegram/bots/admin — the admin bot (TELEGRAM_ADMIN_BOT_*): the GIGA
 * control panel in Telegram for linked staff.
 *
 * Access: only a staff member linked through GIGA → «Уведомления» →
 * «Привязать Telegram» (`/start staff_<code>`), approved and still holding a
 * staff role — re-checked on every update. Every action checks the same rbac
 * permission as the GIGA API route it mirrors (see the header of each menu
 * file and docs/platform/07-admin-control-center.md §7).
 */
import { hasPermission, STAFF_ROLE_LABELS, type Permission } from '@/lib/admin/rbac'
import { handleStaffStart } from '@/lib/telegram/staff-updates'
import { STAFF_START_PREFIX } from '@/lib/telegram/staff-link'
import type { Router } from '../dispatcher'
import { sendMessage, type ReplyMarkup } from '../registry'
import { esc } from '../ui'
import { agentConfirmed, agentEntries, agentSteps, showAgents } from './agents'
import { adminApprovalCallback, approvalEntries, showApprovals } from './approvals'
import { clientConfirmed, clientEntries, clientSteps, showClientsMenu } from './clients'
import { permLabel, resolveStaff, type AdminCtx, type AdminEntry, type StaffPrincipal } from './context'
import { mcpConfirmed, mcpEntries, mcpSteps, showMcp } from './mcp'
import { notificationEntries, showNotifications } from './notifications'
import { providerConfirmed, providerEntries, providerSteps, showProviders } from './providers'
import { reportConfirmed, reportEntries, reportSteps, showReportsMenu } from './reports'
import { spendConfirmed, spendEntries, spendSteps, showSpend } from './spend'
import { renderStatus, statusEntries } from './status'
import { showUsersMenu, userConfirmed, userEntries, userSteps } from './users'

interface MenuItem { label: string; command: string; perm: Permission | null; anyOf?: Permission[]; run(ctx: AdminCtx): Promise<void> }

export const ADMIN_MENU: MenuItem[] = [
  { label: '📊 Статус', command: 'status', perm: 'dashboard.view', run: async (ctx) => void (await ctx.show(await renderStatus(ctx), [[ctx.button('🔄 Обновить', 'st.r')]])) },
  { label: '🤖 Агенты', command: 'agents', perm: 'agents.view', run: (ctx) => showAgents(ctx, 0) },
  { label: '✅ Одобрения', command: 'approvals', perm: 'agents.view', run: (ctx) => showApprovals(ctx, 0) },
  { label: '👤 Пользователи и заявки', command: 'users', perm: 'users.view', run: (ctx) => showUsersMenu(ctx) },
  { label: '🏢 Клиенты', command: 'clients', perm: 'users.view', run: (ctx) => showClientsMenu(ctx) },
  { label: '📄 Отчёты', command: 'reports', perm: null, anyOf: ['agents.view', 'insights.moderate'], run: (ctx) => showReportsMenu(ctx) },
  { label: '🔑 Провайдеры и ключи', command: 'providers', perm: 'agents.view', run: (ctx) => showProviders(ctx) },
  { label: '💸 Расходы и лимиты', command: 'spend', perm: 'agents.view', run: (ctx) => showSpend(ctx, '1', 'p') },
  { label: '🔔 Уведомления', command: 'notifications', perm: 'dashboard.view', run: (ctx) => showNotifications(ctx) },
  { label: '🔌 MCP-доступ', command: 'mcp', perm: 'dashboard.view', run: (ctx) => showMcp(ctx) },
]

export { ADMIN_COMMANDS } from '../commands'

function visible(item: MenuItem, p: StaffPrincipal): boolean {
  if (item.perm) return hasPermission(p.role, item.perm)
  return (item.anyOf ?? []).some((perm) => hasPermission(p.role, perm))
}

export function mainKeyboard(p: StaffPrincipal): ReplyMarkup {
  const items = ADMIN_MENU.filter((m) => visible(m, p)).map((m) => ({ text: m.label }))
  const rows: Array<Array<{ text: string }>> = []
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2))
  return { keyboard: rows, resize_keyboard: true, is_persistent: true, input_field_placeholder: 'Выберите раздел' }
}

/** A lone token-looking message outside a key prompt: delete it, never keep a key in the chat. */
const LOOKS_LIKE_KEY = /^(?=.{20,4096}$)(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_\-.:]+$/

async function welcome(ctx: AdminCtx): Promise<void> {
  if (LOOKS_LIKE_KEY.test(ctx.text) && !ctx.text.startsWith('/')) {
    const deleted = await ctx.deleteIncoming()
    await ctx.reply(`🔐 Похоже на ключ доступа${deleted ? ' — сообщение удалено' : ' — удалите это сообщение вручную'}. Чтобы сохранить ключ, откройте «🔑 Провайдеры и ключи» → провайдер → «➕ Ключ».`, mainKeyboard(ctx.principal))
    return
  }
  await ctx.reply(
    `👋 Панель AIStart360. Роль: <b>${esc(STAFF_ROLE_LABELS[ctx.principal.role])}</b>.\nВыберите раздел в меню ниже. Разделы и кнопки показываются по правам вашей роли.`,
    mainKeyboard(ctx.principal),
  )
}

function menuEntry(item: MenuItem): AdminEntry {
  return {
    perm: item.perm ?? undefined,
    async run(ctx) {
      if (!visible(item, ctx.principal)) {
        await ctx.reply(`⛔ Недостаточно прав: ${(item.anyOf ?? []).map(permLabel).join(' или ')}`)
        return
      }
      await item.run(ctx)
    },
  }
}

export function adminRouter(): Router<StaffPrincipal> {
  const menu: Record<string, AdminEntry> = {}
  const commands: Record<string, AdminEntry> = {
    start: { run: welcome },
    menu: { run: welcome },
    help: { run: welcome },
  }
  for (const item of ADMIN_MENU) {
    menu[item.label] = menuEntry(item)
    commands[item.command] = menuEntry(item)
  }
  const callbacks: Record<string, AdminEntry> = {
    ...statusEntries, ...agentEntries, ...approvalEntries, ...userEntries, ...clientEntries,
    ...reportEntries, ...providerEntries, ...spendEntries, ...notificationEntries, ...mcpEntries,
  }
  return {
    bot: 'admin',
    resolve: (from) => resolveStaff(from.id),
    authorize: (p, perm) => hasPermission(p.role, perm as Permission),
    permLabel,
    async start({ payload, from, chatId, deps }) {
      if (!payload.startsWith(STAFF_START_PREFIX)) return false
      await handleStaffStart(`/start ${payload}`, from, chatId, deps.fetchImpl, 'admin')
      const p = await resolveStaff(from.id)
      if (p) await sendMessage('admin', chatId, 'Главное меню — внизу экрана.', mainKeyboard(p), deps.fetchImpl)
      return true
    },
    rawCallback: adminApprovalCallback,
    unlinkedText: '⛔ Этот бот — панель управления AIStart360 для сотрудников. Доступ только после привязки: GIGA → «Уведомления» → «Привязать Telegram».',
    welcome,
    commands,
    menu,
    callbacks,
    confirmed: { ...agentConfirmed, ...userConfirmed, ...clientConfirmed, ...reportConfirmed, ...providerConfirmed, ...spendConfirmed, ...mcpConfirmed },
    steps: { ...agentSteps, ...userSteps, ...clientSteps, ...reportSteps, ...providerSteps, ...spendSteps, ...mcpSteps },
  }
}
