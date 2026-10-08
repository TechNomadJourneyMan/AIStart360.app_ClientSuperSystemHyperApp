/**
 * 🤖 Агенты — the GIGA «ИИ-агенты» screen in the bot.
 *
 *   list, card, tasks, task card     agents.view   (GET agents, agents/:key, tasks, tasks/:id)
 *   enable                           agents.manage (PATCH agents/:key)
 *   disable                          agents.manage + confirmation
 *   run (company agents: pick a company by name / email)
 *                                    agents.run    (POST agents/:key/run)
 *   retry                            agents.run    (POST tasks/:id retry)
 *   retry from a notification (tk.rq) agents.run + confirmation
 *   cancel                           agents.run + confirmation
 *   ⚙️ Автоматизация                 agents.view; switches: settings.manage (automation.ts)
 * Mutations go through lib/admin/staff-actions.ts (the routes' own code) and
 * are audited with actor kind 'telegram'.
 */
import { createHash } from 'node:crypto'
import { getTaskDetail, listAgentOverviews, listTasks, type AgentOverview } from '@/lib/agents/admin'
import { listAgents } from '@/lib/agents/registry'
import { agentTaskAction, runAgentManually, updateAgentConfigAudited } from '@/lib/admin/staff-actions'
import { searchCompanies } from '../data'
import { cut, dt, esc, pageOf, pagerRow, PAGE_SIZE, pct, usd } from '../ui'
import { auditFor, can, UUID_RE, type AdminCtx, type AdminEntry, type AdminStep } from './context'

export function agentRef(key: string): string {
  return createHash('sha256').update(key).digest('base64url').slice(0, 6)
}

export function agentByRef(ref: string | undefined): { key: string; name: string; scope: 'company' | 'platform' } | null {
  if (!ref) return null
  const def = listAgents().find((a) => agentRef(a.key) === ref)
  return def ? { key: def.key, name: def.name, scope: def.scope } : null
}

const STATUS_CODES: Record<string, string> = {
  q: 'queued', r: 'running', a: 'awaiting_approval', s: 'succeeded', f: 'failed', d: 'dead', c: 'cancelled',
}
const STATUS_LABELS: Record<string, string> = {
  queued: '⏳ в очереди', running: '⚙️ выполняется', awaiting_approval: '🟡 ждёт одобрения', succeeded: '✅ успешно',
  failed: '⚠️ ошибка', dead: '💀 dead-letter', cancelled: '✖️ отменена',
}
const statusLabel = (s: unknown) => STATUS_LABELS[String(s)] ?? esc(s)

async function agentOverview(key: string): Promise<AgentOverview | null> {
  return (await listAgentOverviews()).find((a) => a.key === key) ?? null
}

export async function showAgents(ctx: AdminCtx, page = 0): Promise<void> {
  const all = await listAgentOverviews()
  const slice = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const lines = ['🤖 <b>ИИ-агенты</b> — за 7 дней: запуски / ошибки / расход', '']
  for (const a of slice) {
    lines.push(`${a.enabled ? '🟢' : '⏸'} <b>${esc(a.name)}</b> — ${a.stats.runs7d} / ${a.stats.failed7d} / ${usd(a.stats.costUsd7d)}${a.stats.dead24h ? ` · DLQ ${a.stats.dead24h}` : ''}`)
  }
  if (!all.length) lines.push('Агентов нет.')
  const rows = slice.map((a) => [ctx.button(`${a.enabled ? '🟢' : '⏸'} ${cut(a.name, 40)}`, 'ag.c', agentRef(a.key))])
  rows.push(pagerRow(ctx, 'ag.l', page, all.length > (page + 1) * PAGE_SIZE))
  rows.push([ctx.button('📋 Все задачи', 'tk.l', '-', '-', 0), ctx.button('💀 Dead-letter', 'tk.l', '-', 'd', 0)])
  rows.push([ctx.button('⚙️ Автоматизация', 'au.v')])
  await ctx.show(lines.join('\n'), rows)
}

async function showAgentCard(ctx: AdminCtx, ref: string): Promise<void> {
  const def = agentByRef(ref)
  const a = def ? await agentOverview(def.key) : null
  if (!a) {
    await ctx.show('Агент не найден.', [[ctx.button('‹ К списку', 'ag.l', 0)]])
    return
  }
  const s = a.stats
  const lines = [
    `${a.enabled ? '🟢' : '⏸'} <b>${esc(a.name)}</b> <code>${esc(a.key)}</code>`,
    esc(cut(a.description, 300)),
    '',
    `Область: ${a.scope === 'company' ? 'компания' : 'платформа'} · уровень модели: ${esc(a.tier)}${a.model ? ` · модель ${esc(a.model)}` : ''}`,
    `Запусков за 7 дней: ${s.runs7d} (успешно ${pct(s.successRate)}, ошибок ${s.failed7d})`,
    `Расход: сегодня ${usd(s.costUsdToday)}, за 7 дней ${usd(s.costUsd7d)}`,
    `Очередь: ${s.queued} · выполняются ${s.running} · ждут одобрения ${s.awaitingApproval} · DLQ 24 ч ${s.dead24h}`,
    `Лимиты: ${usd(a.limits.perRunBudgetUsd)} за запуск, ${usd(a.limits.dailyBudgetUsd)} в день, попыток ${a.limits.maxAttempts}`,
    a.triggers.events.length ? `События: ${a.triggers.events.map(esc).join(', ')}` : null,
    a.triggers.cron ? `Расписание: <code>${esc(a.triggers.cron)}</code>${a.nextRunAt ? ` (следующий ${dt(a.nextRunAt)})` : ''}` : null,
    s.lastRunAt ? `Последний запуск: ${dt(s.lastRunAt)} — ${statusLabel(s.lastRunStatus)}` : null,
  ].filter((l): l is string => l !== null)
  const actions = [
    can(ctx, 'agents.run') && a.enabled ? ctx.button('🚀 Запустить', 'ag.run', ref) : null,
    can(ctx, 'agents.manage') ? (a.enabled ? ctx.button('⏸ Выключить', 'ag.off', ref) : ctx.button('▶️ Включить', 'ag.on', ref)) : null,
  ]
  await ctx.show(lines.join('\n'), [
    actions,
    [ctx.button('📋 Задачи', 'tk.l', ref, '-', 0), ctx.button('⚠️ Ошибки', 'tk.l', ref, 'd', 0)],
    [ctx.button('‹ К списку', 'ag.l', 0)],
  ])
}

async function showTasks(ctx: AdminCtx, ref: string, code: string, page: number): Promise<void> {
  const def = ref === '-' ? null : agentByRef(ref)
  if (ref !== '-' && !def) {
    await ctx.show('Агент не найден.')
    return
  }
  const status = STATUS_CODES[code] ?? null
  // Cursor pagination of listTasks → fetch enough rows for the page.
  const { items } = await listTasks({ agentKey: def?.key ?? null, status, limit: (page + 1) * PAGE_SIZE + 1 })
  const slice = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const title = `📋 <b>Задачи</b>${def ? ` · ${esc(def.name)}` : ''}${status ? ` · ${statusLabel(status)}` : ''}`
  const lines = [title, '']
  for (const t of slice) {
    lines.push(`${statusLabel(t.status)} · ${esc(t.agent_key)}${t.company_name ? ` · ${esc(cut(t.company_name, 30))}` : ''} · ${dt(t.created_at)} · ${usd(t.cost_usd)}`)
  }
  if (!slice.length) lines.push('Задач нет.')
  const rows: Array<Array<ReturnType<AdminCtx['button']>>> = slice.map((t) => [
    ctx.button(`${String(STATUS_LABELS[String(t.status)] ?? t.status).split(' ')[0]} ${cut(t.agent_key, 24)} · ${dt(t.created_at)}`, 'tk.c', String(t.id)),
  ])
  rows.push(pagerRow(ctx, 'tk.l', page, items.length > (page + 1) * PAGE_SIZE, ref, code))
  rows.push([
    ctx.button(code === '-' ? '• Все' : 'Все', 'tk.l', ref, '-', 0),
    ctx.button(code === 'q' ? '• Очередь' : 'Очередь', 'tk.l', ref, 'q', 0),
    ctx.button(code === 'a' ? '• Ждут' : 'Ждут', 'tk.l', ref, 'a', 0),
    ctx.button(code === 'd' ? '• DLQ' : 'DLQ', 'tk.l', ref, 'd', 0),
    ctx.button(code === 'f' ? '• Ошибки' : 'Ошибки', 'tk.l', ref, 'f', 0),
  ])
  rows.push([def ? ctx.button('‹ К агенту', 'ag.c', ref) : ctx.button('‹ К агентам', 'ag.l', 0)])
  await ctx.show(lines.join('\n'), rows)
}

async function showTask(ctx: AdminCtx, id: string): Promise<void> {
  const d = UUID_RE.test(id) ? await getTaskDetail(id) : null
  if (!d) {
    await ctx.show('Задача не найдена.')
    return
  }
  const t = d.task as Record<string, unknown>
  const cost = d.runs.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  const byTool = new Map<string, { n: number; decisions: Set<string>; failed: number }>()
  for (const c of d.toolCalls) {
    const k = String(c.tool)
    const cur = byTool.get(k) ?? { n: 0, decisions: new Set<string>(), failed: 0 }
    cur.n += 1
    cur.decisions.add(String(c.decision))
    if (c.status !== 'ok') cur.failed += 1
    byTool.set(k, cur)
  }
  const lines = [
    `📋 <b>Задача</b> <code>${esc(id.slice(0, 8))}</code> · ${esc(t.agent_key)}`,
    t.company_name ? `Компания: ${esc(t.company_name)}` : null,
    `Статус: ${statusLabel(t.status)} · попыток ${esc(t.attempts)}/${esc(t.max_attempts)} · запуск: ${esc(t.trigger)}`,
    `Создана ${dt(t.created_at)}${t.finished_at ? ` · завершена ${dt(t.finished_at)}` : ''}`,
    `Стоимость: ${usd(cost)} · запусков ${d.runs.length}`,
    t.last_error_code ? `Ошибка: <code>${esc(t.last_error_code)}</code> ${esc(cut(t.last_error, 200))}` : null,
  ].filter((l): l is string => l !== null)
  if (byTool.size) {
    lines.push('', '<b>Инструменты</b> (вызовы · решение прав)')
    for (const [tool, v] of byTool) lines.push(`• ${esc(tool)} × ${v.n} · ${[...v.decisions].map(esc).join('/')}${v.failed ? ` · не выполнено ${v.failed}` : ''}`)
  }
  if (d.approvals.length) {
    lines.push('', '<b>Одобрения</b>')
    for (const a of d.approvals) lines.push(`• ${esc(cut(a.summary, 80))} — ${esc(a.status)}${a.decided_via ? ` (${esc(a.decided_via)})` : ''}`)
  }
  const status = String(t.status)
  const actions = can(ctx, 'agents.run') ? [
    ['dead', 'failed', 'cancelled'].includes(status) ? ctx.button('🔁 Повторить', 'tk.rt', id) : null,
    ['queued', 'awaiting_approval', 'failed'].includes(status) ? ctx.button('✖️ Отменить', 'tk.cn', id) : null,
  ] : []
  await ctx.show(lines.join('\n'), [actions, [ctx.button('‹ К задачам агента', 'tk.l', agentRef(String(t.agent_key)), '-', 0)]])
}

async function run(ctx: AdminCtx, key: string, companyId: string | null): Promise<void> {
  const res = await runAgentManually({ key, companyId, actorId: ctx.principal.userId, audit: auditFor(ctx) })
  if (!res.ok) {
    await ctx.show(`⚠️ ${esc(res.error)}`)
    return
  }
  await ctx.show(`🚀 Задача поставлена в очередь: <code>${esc(res.taskId.slice(0, 8))}</code>`, [[ctx.button('📋 Открыть задачу', 'tk.c', res.taskId)]])
}

/** Prompt for a company (name or email) before running a company-scoped agent. */
export async function askCompany(ctx: AdminCtx, ref: string): Promise<void> {
  await ctx.setState({ step: 'agent_company', ref })
  await ctx.reply('🏢 Введите название компании или email владельца (или /cancel).')
}

export const agentSteps: Record<string, AdminStep> = {
  agent_company: {
    perm: 'agents.run',
    async run(ctx, state) {
      const q = ctx.text.slice(0, 80)
      if (q.length < 2) {
        await ctx.reply('Нужно хотя бы 2 символа. Попробуйте ещё раз или /cancel.')
        return
      }
      const { items } = await searchCompanies(q, 0, 8)
      if (!items.length) {
        await ctx.reply('Ничего не найдено. Попробуйте другой запрос или /cancel.')
        return
      }
      await ctx.clearState()
      await ctx.reply('Выберите компанию:', {
        inline_keyboard: items
          .map((c) => ctx.button(`${cut(c.name, 36)}${c.owner_email ? ` · ${cut(c.owner_email, 24)}` : ''}`, 'ag.rc', String(state.ref), c.id))
          .filter((b): b is NonNullable<typeof b> => Boolean(b))
          .map((b) => [b]),
      })
    },
  },
}

export const agentEntries: Record<string, AdminEntry> = {
  'ag.l': { perm: 'agents.view', run: (ctx, [p]) => showAgents(ctx, pageOf(p)) },
  'ag.c': { perm: 'agents.view', run: (ctx, [ref]) => showAgentCard(ctx, ref) },
  'tk.l': { perm: 'agents.view', run: (ctx, [ref, code, p]) => showTasks(ctx, ref ?? '-', code ?? '-', pageOf(p)) },
  'tk.c': { perm: 'agents.view', run: (ctx, [id]) => showTask(ctx, id) },
  'ag.on': {
    perm: 'agents.manage',
    async run(ctx, [ref]) {
      const def = agentByRef(ref)
      if (!def) return void (await ctx.show('Агент не найден.'))
      const res = await updateAgentConfigAudited({ key: def.key, patch: { enabled: true }, actorId: ctx.principal.userId, audit: auditFor(ctx) })
      await ctx.toast(res.ok ? 'Агент включён' : res.error)
      await showAgentCard(ctx, ref)
    },
  },
  'ag.off': {
    perm: 'agents.manage',
    async run(ctx, [ref]) {
      const def = agentByRef(ref)
      if (!def) return void (await ctx.show('Агент не найден.'))
      await ctx.confirm(`⏸ Выключить агента <b>${esc(def.name)}</b>? Новые задачи не будут запускаться, пока его снова не включат.`, 'ag.off', [ref])
    },
  },
  'ag.run': {
    perm: 'agents.run',
    async run(ctx, [ref]) {
      const def = agentByRef(ref)
      if (!def) return void (await ctx.show('Агент не найден.'))
      if (def.scope === 'company') return askCompany(ctx, ref)
      await run(ctx, def.key, null)
    },
  },
  'ag.rc': {
    perm: 'agents.run',
    async run(ctx, [ref, companyId]) {
      const def = agentByRef(ref)
      if (!def) return void (await ctx.show('Агент не найден.'))
      await run(ctx, def.key, companyId ?? null)
    },
  },
  'tk.rt': {
    perm: 'agents.run',
    async run(ctx, [id]) {
      if (!UUID_RE.test(id)) return
      const res = await agentTaskAction({ taskId: id, action: 'retry', actorId: ctx.principal.userId, audit: auditFor(ctx) })
      await ctx.toast(res.ok ? 'Задача снова в очереди' : res.error, !res.ok)
      await showTask(ctx, id)
    },
  },
  'tk.cn': {
    perm: 'agents.run',
    async run(ctx, [id]) {
      if (!UUID_RE.test(id)) return
      await ctx.confirm(`✖️ Отменить задачу <code>${esc(id.slice(0, 8))}</code>?`, 'tk.cn', [id])
    },
  },
  // «Повторить» under a lifecycle notification (lib/agents/lifecycle.ts): asks first.
  'tk.rq': {
    perm: 'agents.run',
    async run(ctx, [id]) {
      if (!UUID_RE.test(id)) return
      await ctx.confirm(`🔁 Повторить задачу <code>${esc(id.slice(0, 8))}</code>? Она снова встанет в очередь с одной дополнительной попыткой.`, 'tk.rq', [id])
    },
  },
}

/** Reached only through the confirmation button. */
export const agentConfirmed: Record<string, AdminEntry> = {
  'ag.off': {
    perm: 'agents.manage',
    async run(ctx, [ref]) {
      const def = agentByRef(ref)
      if (!def) return void (await ctx.show('Агент не найден.'))
      const res = await updateAgentConfigAudited({ key: def.key, patch: { enabled: false }, actorId: ctx.principal.userId, audit: auditFor(ctx) })
      await ctx.toast(res.ok ? 'Агент выключен' : res.error, !res.ok)
      await showAgentCard(ctx, ref)
    },
  },
  'tk.cn': {
    perm: 'agents.run',
    async run(ctx, [id]) {
      const res = await agentTaskAction({ taskId: id, action: 'cancel', actorId: ctx.principal.userId, audit: auditFor(ctx) })
      await ctx.toast(res.ok ? 'Задача отменена' : res.error, !res.ok)
      await showTask(ctx, id)
    },
  },
  'tk.rq': {
    perm: 'agents.run',
    async run(ctx, [id]) {
      if (!UUID_RE.test(id)) return
      const res = await agentTaskAction({ taskId: id, action: 'retry', actorId: ctx.principal.userId, audit: auditFor(ctx) })
      await ctx.toast(res.ok ? 'Задача снова в очереди' : res.error, !res.ok)
      await showTask(ctx, id)
    },
  },
}
