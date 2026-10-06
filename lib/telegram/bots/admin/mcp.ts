/**
 * 🔌 MCP-доступ — the staff member's OWN MCP personal access tokens
 * (lib/mcp/tokens.ts; the same rules as GIGA «MCP-доступ»):
 *   list, create, revoke            dashboard.view (any staff role); the scopes
 *                                   offered are only those the CURRENT role
 *                                   allows (lib/mcp/scopes.ts), re-checked at
 *                                   creation and on every MCP call
 *   revoke                          + confirmation
 *
 * The token is sent ONCE, in its own message, with a button that deletes
 * that message; it is never kept in the conversation state or the logs.
 * Creation writes the staff audit row first (required) — no row, no token.
 */
import { randomUUID } from 'node:crypto'
import { getSiteUrl } from '@/lib/site-url'
import { resolveMcpPrincipal } from '@/lib/mcp/principal'
import { MCP_SCOPES, scopeLabel, type McpScope } from '@/lib/mcp/scopes'
import { createPat, listPats, PAT_EXPIRY_DAYS, revokePat } from '@/lib/mcp/tokens'
import { deleteMessage } from '../registry'
import { cut, dt, esc } from '../ui'
import { auditFor, type AdminCtx, type AdminEntry, type AdminStep } from './context'

const PERM = 'dashboard.view' as const

function mcpUrl(): string {
  return getSiteUrl('/api/mcp')
}

async function allowedFor(ctx: AdminCtx): Promise<McpScope[]> {
  const p = await resolveMcpPrincipal(ctx.principal.userId)
  return p?.allowed ?? []
}

export async function showMcp(ctx: AdminCtx): Promise<void> {
  const [items, allowed] = await Promise.all([listPats(ctx.principal.userId), allowedFor(ctx)])
  const lines = ['🔌 <b>MCP-доступ</b> — подключение Claude Code / Claude Desktop к данным платформы (только чтение).', '']
  if (!allowed.length) {
    lines.push('Ваша роль не даёт доступа к данным через MCP.')
    return void (await ctx.show(lines.join('\n')))
  }
  lines.push(`Адрес сервера: <code>${esc(mcpUrl())}</code>`, '')
  if (items.length) {
    lines.push('<b>Активные токены:</b>')
    for (const t of items) {
      lines.push(`• ${esc(cut(t.name, 40))} <code>${esc(t.prefix)}…</code> — до ${dt(t.expiresAt)}, ${t.lastUsedAt ? `использован ${dt(t.lastUsedAt)}` : 'не использовался'}`)
    }
  } else {
    lines.push('Активных токенов нет.')
  }
  lines.push('', 'Вход без токена (OAuth): <code>claude mcp add --transport http aistart360 ' + esc(mcpUrl()) + '</code>, затем /mcp → Authenticate.')
  await ctx.show(lines.join('\n'), [
    [ctx.button('➕ Новый токен', 'mc.n')],
    ...items.slice(0, 10).map((t) => [ctx.button(`🗑 Отозвать «${cut(t.name, 24)}»`, 'mc.r', t.id)]),
  ])
}

function pickerText(name: string, scopes: string[]): string {
  return [
    `🔑 Новый токен <b>${esc(cut(name, 60))}</b>`,
    '',
    'Отметьте права (только права вашей роли), затем выберите срок действия — токен будет создан сразу.',
    '',
    scopes.length ? `Выбрано: ${scopes.map((s) => esc(scopeLabel(s))).join('; ')}` : 'Не выбрано ни одного права.',
  ].join('\n')
}

async function showPicker(ctx: AdminCtx, name: string, scopes: string[], allowed: McpScope[]): Promise<void> {
  await ctx.show(pickerText(name, scopes), [
    ...allowed.map((s) => [ctx.button(`${scopes.includes(s) ? '✅' : '⬜'} ${scopeLabel(s)}`, 'mc.t', MCP_SCOPES.indexOf(s))]),
    PAT_EXPIRY_DAYS.map((d) => ctx.button(`${d} дн.`, 'mc.x', d)),
    [ctx.button('✖️ Отмена', 'cx')],
  ])
}

function stateScopes(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
}

export const mcpSteps: Record<string, AdminStep> = {
  mcp_name: {
    perm: PERM,
    async run(ctx) {
      const name = ctx.text.replace(/\s+/g, ' ').trim()
      if (name.length < 1 || name.length > 80 || name.startsWith('/')) {
        return void (await ctx.reply('Название — от 1 до 80 символов. Попробуйте ещё раз или /cancel.'))
      }
      const allowed = await allowedFor(ctx)
      if (!allowed.length) {
        await ctx.clearState()
        return void (await ctx.reply('Ваша роль не даёт доступа к данным через MCP.'))
      }
      const scopes = allowed.filter((s) => s !== 'clients:pii')
      await ctx.setState({ step: 'mcp_scopes', name, scopes })
      await showPicker(ctx, name, scopes, allowed)
    },
  },
}

export const mcpEntries: Record<string, AdminEntry> = {
  'mc.v': { perm: PERM, run: (ctx) => showMcp(ctx) },
  'mc.n': {
    perm: PERM,
    async run(ctx) {
      if (!(await allowedFor(ctx)).length) return void (await ctx.show('Ваша роль не даёт доступа к данным через MCP.'))
      await ctx.setState({ step: 'mcp_name' })
      await ctx.reply('✏️ Введите название токена, например «Claude Code — ноутбук» (или /cancel).')
    },
  },
  'mc.t': {
    perm: PERM,
    async run(ctx, [idx]) {
      const state = await ctx.getState()
      if (!state || state.step !== 'mcp_scopes') return void (await ctx.toast('Создание токена устарело — начните заново.', true))
      const scope = MCP_SCOPES[Number(idx)]
      const allowed = await allowedFor(ctx)
      if (!scope || !allowed.includes(scope)) return void (await ctx.toast('Это право недоступно вашей роли.', true))
      const current = stateScopes(state.scopes).filter((s) => allowed.includes(s as McpScope))
      const scopes = current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]
      const name = String(state.name ?? '')
      await ctx.setState({ step: 'mcp_scopes', name, scopes })
      await showPicker(ctx, name, scopes, allowed)
    },
  },
  'mc.x': {
    perm: PERM,
    async run(ctx, [daysArg]) {
      const state = await ctx.getState()
      if (!state || state.step !== 'mcp_scopes') return void (await ctx.toast('Создание токена устарело — начните заново.', true))
      const principal = await resolveMcpPrincipal(ctx.principal.userId)
      if (!principal) return void (await ctx.show('⛔ Нет доступа.'))
      const days = Number(daysArg)
      const name = String(state.name ?? '')
      const scopes = stateScopes(state.scopes)
      if (!scopes.length) return void (await ctx.toast('Отметьте хотя бы одно право.', true))
      const id = randomUUID()
      // Journal first: without the audit row no token is created.
      await auditFor(ctx)({
        action: 'mcp.token.create', entityType: 'mcp_token', entityId: id, targetUserId: principal.userId,
        newValue: { name, scopes, expires_in_days: days, via: 'telegram' },
      }, { required: true })
      const res = await createPat({ principal, name, scopes, expiresInDays: days, via: 'telegram', id })
      await ctx.clearState()
      if (!res.ok) {
        const why = res.error === 'too_many' ? 'слишком много активных токенов — отзовите ненужные'
          : res.error === 'scopes_not_allowed' ? 'права роли изменились, начните заново'
            : 'некорректные данные'
        return void (await ctx.show(`⚠️ Токен не создан: ${why}.`, [[ctx.button('‹ MCP-доступ', 'mc.v')]]))
      }
      await ctx.show(`✅ Токен <b>${esc(cut(res.row.name, 60))}</b> создан, действует до ${dt(res.row.expiresAt)}. Он в следующем сообщении — скопируйте и удалите сообщение.`, [[ctx.button('‹ MCP-доступ', 'mc.v')]])
      const command = `claude mcp add --transport http aistart360 ${mcpUrl()} --header "Authorization: Bearer ${res.token}"`
      await ctx.reply(
        [
          '🔑 <b>Токен MCP</b> (показывается один раз, в базе хранится только хэш):',
          `<code>${esc(res.token)}</code>`,
          '',
          'Команда для Claude Code:',
          `<code>${esc(command)}</code>`,
          '',
          'Скопируйте и удалите это сообщение кнопкой ниже.',
        ].join('\n'),
        { inline_keyboard: [[ctx.button('🗑 Удалить это сообщение', 'mc.d')].filter((b): b is NonNullable<typeof b> => Boolean(b))] },
      )
    },
  },
  'mc.d': {
    perm: PERM,
    async run(ctx) {
      if (!ctx.messageId) return
      const r = await deleteMessage(ctx.bot, ctx.chatId, ctx.messageId, ctx.deps.fetchImpl)
      await ctx.toast(r.ok ? 'Сообщение удалено' : 'Не удалось удалить — удалите сообщение вручную', !r.ok)
    },
  },
  'mc.r': {
    perm: PERM,
    async run(ctx, [id]) {
      const t = (await listPats(ctx.principal.userId)).find((x) => x.id === id)
      if (!t) return void (await ctx.show('Токен не найден или уже отозван.', [[ctx.button('‹ MCP-доступ', 'mc.v')]]))
      await ctx.confirm(`🗑 Отозвать токен <b>${esc(cut(t.name, 60))}</b> (<code>${esc(t.prefix)}…</code>)? Он сразу перестанет работать.`, 'mc.r', [id])
    },
  },
}

export const mcpConfirmed: Record<string, AdminEntry> = {
  'mc.r': {
    perm: PERM,
    async run(ctx, [id]) {
      const done = await revokePat(ctx.principal.userId, id)
      if (done) {
        await auditFor(ctx)({ action: 'mcp.token.revoke', entityType: 'mcp_token', entityId: id, targetUserId: ctx.principal.userId }).catch(() => false)
      }
      await ctx.show(done ? '✅ Токен отозван.' : 'Токен не найден или уже отозван.', [[ctx.button('‹ MCP-доступ', 'mc.v')]])
    },
  },
}
