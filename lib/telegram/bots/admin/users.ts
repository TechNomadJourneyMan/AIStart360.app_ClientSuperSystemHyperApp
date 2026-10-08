/**
 * 👤 Пользователи и заявки.
 *
 *   pending registrations, user search, user card   users.view    (GET requests, users)
 *   contacts unmasked                               users.sensitive (as GET users)
 *   approve a registration                          users.approve (PATCH requests/:id)
 *   reject a registration                           users.approve + confirmation
 * The decision is lib/users/access-requests.ts decideAccessRequest — the
 * route's own code (profiles.status via service role, affected-row check,
 * e-mail to the user, audit).
 */
import { prisma } from '@/lib/db'
import { maskEmail, maskPhone } from '@/lib/admin/mask'
import { createServiceClient } from '@/lib/supabase-service'
import { decideAccessRequest } from '@/lib/users/access-requests'
import { pendingRegistrations, searchUsers, userCard } from '../data'
import { cut, dt, esc, pageOf, pagerRow, PAGE_SIZE } from '../ui'
import { auditFor, can, UUID_RE, type AdminCtx, type AdminEntry, type AdminStep } from './context'

const STATUS: Record<string, string> = {
  pending_approval: '🕓 ждёт решения', approved: '✅ одобрен', rejected: '❌ отклонён',
  requires_clarification: '❔ нужно уточнение', blocked: '⛔ заблокирован', archived: '🗄 в архиве',
}

const contact = (ctx: AdminCtx, email: string | null) => (can(ctx, 'users.sensitive') ? email : maskEmail(email))

export async function showUsersMenu(ctx: AdminCtx): Promise<void> {
  const pending = await pendingRegistrations(0, 1).catch(() => null)
  await ctx.show('👤 <b>Пользователи и заявки</b>', [
    [ctx.button(`🕓 Заявки на доступ${pending?.items.length ? '' : ' (нет)'}`, 'rg.l', 0)],
    [ctx.button('🔎 Найти пользователя', 'us.s')],
  ])
}

async function showRegistrations(ctx: AdminCtx, page: number): Promise<void> {
  const { items, hasMore } = await pendingRegistrations(page, PAGE_SIZE)
  const lines = ['🕓 <b>Заявки на доступ</b>', '']
  for (const r of items) lines.push(`• ${esc(r.full_name ?? '—')} · ${esc(contact(ctx, r.email))}${r.organization ? ` · ${esc(cut(r.organization, 40))}` : ''} · ${dt(r.created_at)}`)
  if (!items.length) lines.push(page ? 'На этой странице пусто.' : 'Новых заявок нет.')
  const rows = items.map((r) => [ctx.button(`${cut(r.full_name ?? r.email ?? '—', 40)}`, 'us.c', r.user_id)])
  rows.push(pagerRow(ctx, 'rg.l', page, hasMore))
  await ctx.show(lines.join('\n'), rows)
}

async function showUser(ctx: AdminCtx, id: string): Promise<void> {
  const u = await userCard(id)
  if (!u) return void (await ctx.show('Пользователь не найден.'))
  const sensitive = can(ctx, 'users.sensitive')
  const lines = [
    `👤 <b>${esc(u.full_name ?? '—')}</b>`,
    `Email: ${esc(sensitive ? u.email : maskEmail(u.email))}${u.phone ? ` · тел. ${esc(sensitive ? u.phone : maskPhone(u.phone))}` : ''}`,
    `Роль: ${esc(u.role)}${u.staff_role ? ` · сотрудник: ${esc(u.staff_role)}` : ''}`,
    `Статус: ${STATUS[u.status] ?? esc(u.status)}`,
    u.organization ? `Организация: ${esc(u.organization)}` : null,
    u.company_name ? `Компания: ${esc(u.company_name)}` : null,
    `Регистрация: ${dt(u.created_at)}${u.last_seen_at ? ` · был(а) ${dt(u.last_seen_at)}` : ''}`,
  ].filter((l): l is string => l !== null)
  const decide = can(ctx, 'users.approve') && u.status === 'pending_approval'
  await ctx.show(lines.join('\n'), [
    decide ? [ctx.button('✅ Одобрить доступ', 'rg.ok', u.id), ctx.button('❌ Отклонить', 'rg.no', u.id)] : [],
    u.company_id ? [ctx.button('🏢 Карточка компании', 'cl.c', u.company_id)] : [],
    [ctx.button('‹ Заявки', 'rg.l', 0)],
  ])
}

/** admin_requests id of the user's request when one exists, else the profile id (orphaned registration). */
export async function requestIdFor(userId: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM public.admin_requests WHERE "userId" = ${userId} ORDER BY "createdAt" DESC LIMIT 1`.catch(() => [])
  return rows[0]?.id ?? userId
}

async function decide(ctx: AdminCtx, userId: string, action: 'approve' | 'reject', reason?: string): Promise<void> {
  if (!UUID_RE.test(userId)) return
  const audit = auditFor(ctx)
  // The bot's own audit entry (actor kind 'telegram') in admin_audit_log, before the change.
  await audit({ action: `request.${action === 'approve' ? 'approve' : 'reject'}`, entityType: 'user', entityId: userId, targetUserId: userId, newValue: { action, reason: reason ?? null } }, { required: true })
  const res = await decideAccessRequest(createServiceClient(), {
    requestId: await requestIdFor(userId),
    action,
    reason,
    actor: { id: ctx.principal.userId, kind: 'telegram' },
  })
  await ctx.toast(res.ok ? (action === 'approve' ? 'Доступ открыт' : 'Заявка отклонена') : 'Профиль не найден — статус не изменён', !res.ok)
  await showUser(ctx, userId)
}

export const userSteps: Record<string, AdminStep> = {
  user_search: {
    perm: 'users.view',
    async run(ctx) {
      const q = ctx.text.slice(0, 80)
      if (q.length < 2) return void (await ctx.reply('Нужно хотя бы 2 символа. Попробуйте ещё раз или /cancel.'))
      await ctx.clearState()
      const { items } = await searchUsers(q, 0, PAGE_SIZE)
      if (!items.length) return void (await ctx.reply('Никого не нашлось.'))
      await ctx.reply(`Найдено: ${items.length}${items.length === PAGE_SIZE ? '+' : ''}`, {
        inline_keyboard: items
          .map((u) => ctx.button(`${STATUS[u.status]?.split(' ')[0] ?? ''} ${cut(u.full_name ?? '—', 28)} · ${cut(contact(ctx, u.email) ?? '', 26)}`, 'us.c', u.id))
          .filter((b): b is NonNullable<typeof b> => Boolean(b))
          .map((b) => [b]),
      })
    },
  },
  reject_reason: {
    perm: 'users.approve',
    async run(ctx, state) {
      const reason = ctx.text.slice(0, 500)
      await ctx.confirm(`❌ Отклонить заявку с причиной «${esc(cut(reason, 200))}»? Пользователь получит письмо.`, 'rg.no', [String(state.userId), reason.slice(0, 300)])
    },
  },
}

export const userEntries: Record<string, AdminEntry> = {
  'rg.l': { perm: 'users.view', run: (ctx, [p]) => showRegistrations(ctx, pageOf(p)) },
  'us.c': { perm: 'users.view', run: (ctx, [id]) => showUser(ctx, id) },
  'us.s': {
    perm: 'users.view',
    async run(ctx) {
      await ctx.setState({ step: 'user_search' })
      await ctx.reply('🔎 Введите email, имя или организацию (или /cancel).')
    },
  },
  'rg.ok': { perm: 'users.approve', run: (ctx, [id]) => decide(ctx, id, 'approve') },
  'rg.no': {
    perm: 'users.approve',
    async run(ctx, [id]) {
      if (!UUID_RE.test(id)) return
      await ctx.setState({ step: 'reject_reason', userId: id })
      await ctx.show('❌ Напишите причину отказа одним сообщением (она уйдёт пользователю в письме) или /cancel.', [[ctx.button('Без причины', 'rg.nr', id)]])
    },
  },
  'rg.nr': {
    perm: 'users.approve',
    async run(ctx, [id]) {
      if (!UUID_RE.test(id)) return
      await ctx.confirm('❌ Отклонить заявку без указания причины? Пользователь получит письмо.', 'rg.no', [id])
    },
  },
}

export const userConfirmed: Record<string, AdminEntry> = {
  'rg.no': { perm: 'users.approve', run: (ctx, [id, reason]) => decide(ctx, id, 'reject', reason || undefined) },
}
