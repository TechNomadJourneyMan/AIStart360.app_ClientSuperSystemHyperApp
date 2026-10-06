/**
 * 🏢 Клиенты — search and the company card.
 *
 *   search, recent, card, sessions     users.view (GET giga-admin/clients)
 *   contacts unmasked                  users.sensitive
 *   unreviewed AI hypotheses listed    insights.moderate (GIGA «Проверка выводов ИИ»)
 *   «Запустить диагностику»            agents.run + confirmation — runs the
 *                                      diagnostic orchestrator for the company
 *                                      (POST agents/diagnostic_orchestrator/run)
 */
import { runAgentManually } from '@/lib/admin/staff-actions'
import { ORCHESTRATOR_KEY } from '@/lib/diagnostics/pipeline'
import { renderCompanyCard, sessionLine } from '../cards'
import { companyCard, recentSessions, searchCompanies } from '../data'
import { cut, esc, pageOf, pagerRow, PAGE_SIZE } from '../ui'
import { auditFor, can, type AdminCtx, type AdminEntry, type AdminStep } from './context'

export async function showClientsMenu(ctx: AdminCtx): Promise<void> {
  await ctx.show('🏢 <b>Клиенты</b>', [
    [ctx.button('🔎 Найти компанию', 'cl.s')],
    [ctx.button('🕘 Недавние', 'cl.l', 0)],
    [ctx.button('🩺 Последние диагностики', 'ds.l', '-', 0)],
  ])
}

async function listCompanies(ctx: AdminCtx, page: number): Promise<void> {
  const { items, hasMore } = await searchCompanies(null, page, PAGE_SIZE)
  const rows = items.map((c) => [ctx.button(`${cut(c.name, 34)}${c.score != null ? ` · ${Math.round(c.score)}` : ''}`, 'cl.c', c.id)])
  rows.push(pagerRow(ctx, 'cl.l', page, hasMore))
  await ctx.show(items.length ? '🕘 <b>Недавние компании</b> (балл Точки А)' : 'Компаний пока нет.', rows)
}

export async function showCompany(ctx: AdminCtx, id: string): Promise<void> {
  const card = await companyCard(id, { includeUnreviewedHypotheses: can(ctx, 'insights.moderate') })
  if (!card) return void (await ctx.show('Компания не найдена.'))
  await ctx.show(renderCompanyCard(card, { showContacts: can(ctx, 'users.sensitive') }), [
    can(ctx, 'agents.run') ? [ctx.button('🩺 Запустить диагностику', 'cl.dg', card.id)] : [],
    [ctx.button('🩺 Сессии', 'ds.l', card.id, 0), card.owner ? ctx.button('👤 Владелец', 'us.c', card.owner.id) : null],
    can(ctx, 'agents.view') ? [ctx.button('📄 Версии отчётов', 'rv.l', card.id, 0)] : [],
  ])
}

async function listSessions(ctx: AdminCtx, companyId: string, page: number): Promise<void> {
  const { items, hasMore } = await recentSessions(page, PAGE_SIZE, companyId === '-' ? null : companyId)
  const lines = ['🩺 <b>Диагностики</b>', '', ...items.map(sessionLine)]
  if (!items.length) lines.push('Сессий нет.')
  const rows = companyId === '-' ? items.map((s) => [ctx.button(cut(s.company_name ?? s.company_id, 40), 'cl.c', s.company_id)]) : []
  rows.push(pagerRow(ctx, 'ds.l', page, hasMore, companyId))
  if (companyId !== '-') rows.push([ctx.button('‹ К компании', 'cl.c', companyId)])
  await ctx.show(lines.join('\n'), rows)
}

export const clientSteps: Record<string, AdminStep> = {
  client_search: {
    perm: 'users.view',
    async run(ctx) {
      const q = ctx.text.slice(0, 80)
      if (q.length < 2) return void (await ctx.reply('Нужно хотя бы 2 символа. Попробуйте ещё раз или /cancel.'))
      await ctx.clearState()
      const { items, hasMore } = await searchCompanies(q, 0, PAGE_SIZE)
      if (!items.length) return void (await ctx.reply('Ничего не найдено.'))
      await ctx.reply(`Найдено: ${items.length}${hasMore ? '+' : ''}`, {
        inline_keyboard: items
          .map((c) => ctx.button(`${cut(c.name, 34)}${c.score != null ? ` · ${Math.round(c.score)}` : ''}`, 'cl.c', c.id))
          .filter((b): b is NonNullable<typeof b> => Boolean(b))
          .map((b) => [b]),
      })
    },
  },
}

export const clientEntries: Record<string, AdminEntry> = {
  'cl.s': {
    perm: 'users.view',
    async run(ctx) {
      await ctx.setState({ step: 'client_search' })
      await ctx.reply('🔎 Введите название компании, имя или email владельца (или /cancel).')
    },
  },
  'cl.l': { perm: 'users.view', run: (ctx, [p]) => listCompanies(ctx, pageOf(p)) },
  'cl.c': { perm: 'users.view', run: (ctx, [id]) => showCompany(ctx, id) },
  'ds.l': { perm: 'users.view', run: (ctx, [companyId, p]) => listSessions(ctx, companyId ?? '-', pageOf(p)) },
  'cl.dg': {
    perm: ['users.view', 'agents.run'],
    async run(ctx, [id]) {
      const card = await companyCard(id, { includeUnreviewedHypotheses: false })
      if (!card) return void (await ctx.show('Компания не найдена.'))
      await ctx.confirm(`🩺 Запустить диагностику компании <b>${esc(card.name)}</b>? Пройдут все этапы конвейера; этапы с ИИ расходуют бюджет.`, 'cl.dg', [id])
    },
  },
}

export const clientConfirmed: Record<string, AdminEntry> = {
  'cl.dg': {
    perm: ['users.view', 'agents.run'],
    async run(ctx, [id]) {
      const res = await runAgentManually({ key: ORCHESTRATOR_KEY, companyId: id, input: {}, actorId: ctx.principal.userId, audit: auditFor(ctx) })
      if (!res.ok) return void (await ctx.show(`⚠️ ${esc(res.error)}`, [[ctx.button('‹ К компании', 'cl.c', id)]]))
      await ctx.show(`🩺 Диагностика запущена. Задача <code>${esc(res.taskId.slice(0, 8))}</code>.`, [
        can(ctx, 'agents.view') ? [ctx.button('📋 Задача', 'tk.c', res.taskId)] : [],
        [ctx.button('‹ К компании', 'cl.c', id)],
      ])
    },
  },
}
