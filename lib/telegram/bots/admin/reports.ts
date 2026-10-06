/**
 * 📄 Отчёты.
 *
 *   AI review queue, item card               insights.moderate (GET ai-review)
 *   show to the client                       insights.moderate (POST ai-review approve)
 *   hide (dismiss) with a reason             insights.moderate + confirmation
 *   report versions, version card            agents.view       (GET reports)
 *   publish a ready version                  reports.publish + confirmation
 * Decisions go through lib/admin/staff-actions.ts (reviewAiItem,
 * transitionReportVersion — the routes' code; audit written first).
 */
import { REPORT_TYPE_LABELS } from '@/lib/reports/expert-list'
import { listReviewQueue, type ReviewItem, type ReviewKind } from '@/lib/reports/review'
import { getReportVersion, listReportVersions } from '@/lib/reports/versions'
import { reviewAiItem, transitionReportVersion, REPORT_WRONG_STATUS } from '@/lib/admin/staff-actions'
import { cut, dt, esc, pageOf, pagerRow, pct, PAGE_SIZE } from '../ui'
import { auditFor, can, UUID_RE, type AdminCtx, type AdminEntry, type AdminStep } from './context'

const KIND: Record<string, ReviewKind> = { f: 'finding', r: 'recommendation' }
const KIND_CODE: Record<ReviewKind, string> = { finding: 'f', recommendation: 'r' }
const VERSION_STATUS: Record<string, string> = {
  draft: '📝 черновик', ready: '🟡 готов к проверке', published: '✅ опубликован', superseded: '🗄 заменён',
}

export async function showReportsMenu(ctx: AdminCtx): Promise<void> {
  const rows = [
    can(ctx, 'insights.moderate') ? [ctx.button('🧪 Проверка выводов ИИ', 'rw.l', 0)] : [],
    can(ctx, 'agents.view') ? [ctx.button('🟡 Готовы к публикации', 'rv.l', '-', 0)] : [],
  ]
  if (!rows.some((r) => r.length)) return void (await ctx.show('⛔ Недостаточно прав: отчёты и проверка выводов ИИ недоступны вашей роли.'))
  await ctx.show('📄 <b>Отчёты</b>', rows)
}

async function reviewQueue(): Promise<ReviewItem[]> {
  return listReviewQueue({ limit: 200 })
}

async function showReviewQueue(ctx: AdminCtx, page: number): Promise<void> {
  const items = await reviewQueue()
  const slice = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const lines = [`🧪 <b>Выводы ИИ на проверке: ${items.length}</b>`, 'Пока человек не проверил, клиент их не видит.']
  const rows = slice.map((i) => [ctx.button(`${i.kind === 'finding' ? (i.severity === 'critical' ? '🚨' : '🔎') : '💡'} ${cut(i.title, 30)} · ${cut(i.company_name ?? '', 14)}`, 'rw.c', KIND_CODE[i.kind], i.id)])
  rows.push(pagerRow(ctx, 'rw.l', page, items.length > (page + 1) * PAGE_SIZE))
  await ctx.show(lines.join('\n'), rows)
}

async function showReviewItem(ctx: AdminCtx, code: string, id: string): Promise<void> {
  const kind = KIND[code]
  const item = kind && UUID_RE.test(id) ? (await reviewQueue()).find((i) => i.kind === kind && i.id === id) : null
  if (!item) return void (await ctx.show('Элемент уже проверен или не найден.', [[ctx.button('‹ К очереди', 'rw.l', 0)]]))
  const lines = [
    `${item.kind === 'finding' ? '🔎 Гипотеза ИИ' : '💡 Рекомендация модели'} · ${esc(item.company_name ?? item.company_id)}`,
    `<b>${esc(cut(item.title, 300))}</b>`,
    item.body ? esc(cut(item.body, 900)) : null,
    '',
    `Область: ${esc(item.area_label)}${item.severity ? ` · важность ${esc(item.severity)}` : ''} · уверенность ${pct(item.confidence)}`,
    `Источник: ${esc(item.produced_by)}${item.model ? ` · ${esc(item.model)}` : ''} · ${dt(item.created_at)}`,
    item.evidence.length ? `Доказательств: ${item.evidence.length}` : 'Доказательств нет',
    ...item.evidence.slice(0, 3).map((e) => `  • ${esc(cut(e.label ?? e.quote ?? `${e.type}: ${e.field ?? e.ref}`, 120))}`),
  ].filter((l): l is string => l !== null)
  await ctx.show(lines.join('\n'), [
    [ctx.button('✅ Показать клиенту', 'rw.ok', code, id), ctx.button('🙈 Скрыть', 'rw.no', code, id)],
    [ctx.button('‹ К очереди', 'rw.l', 0)],
  ])
}

async function review(ctx: AdminCtx, code: string, id: string, decision: 'approve' | 'dismiss', reason: string | null): Promise<void> {
  const kind = KIND[code]
  if (!kind || !UUID_RE.test(id)) return
  const res = await reviewAiItem({ kind, id, decision, reason, actorId: ctx.principal.userId, audit: auditFor(ctx) })
  const text = res.ok
    ? (decision === 'approve' ? '✅ Показано клиенту — войдёт в следующую версию отчёта.' : '🙈 Скрыто.')
    : res.code === 'already_reviewed' ? 'Решение по этому элементу уже принято.'
      : res.code === 'not_found' ? 'Элемент не найден.'
        : res.code === 'audit_unavailable' ? '⚠️ Журнал аудита недоступен — решение не сохранено.'
          : '⚠️ Не удалось сохранить решение.'
  await ctx.show(text, [[ctx.button('‹ К очереди', 'rw.l', 0)]])
}

async function showVersions(ctx: AdminCtx, companyId: string, page: number): Promise<void> {
  const all = await listReportVersions({ companyId: companyId === '-' ? null : companyId, status: companyId === '-' ? 'ready' : null, limit: 200 })
  const slice = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const head = companyId === '-' ? `🟡 <b>Версии, готовые к публикации: ${all.length}</b>` : `📄 <b>Версии отчётов</b>${all[0]?.company_name ? ` · ${esc(all[0].company_name)}` : ''}`
  const rows = slice.map((v) => [ctx.button(`${(VERSION_STATUS[v.status] ?? v.status).split(' ')[0]} ${cut(v.company_name ?? '', 20)} · ${REPORT_TYPE_LABELS[v.report_type] ?? v.report_type} v${v.version}`, 'rv.c', v.id)])
  rows.push(pagerRow(ctx, 'rv.l', page, all.length > (page + 1) * PAGE_SIZE, companyId))
  await ctx.show(all.length ? head : `${head}\nНет версий.`, rows)
}

async function showVersion(ctx: AdminCtx, id: string): Promise<void> {
  const v = UUID_RE.test(id) ? await getReportVersion(id) : null
  if (!v) return void (await ctx.show('Версия отчёта не найдена.'))
  const lines = [
    `📄 <b>${esc(v.title)}</b>`,
    `${esc(v.company_name ?? v.company_id)} · ${esc(REPORT_TYPE_LABELS[v.report_type] ?? v.report_type)} · версия ${v.version}`,
    `Статус: ${VERSION_STATUS[v.status] ?? esc(v.status)}${v.published_at ? ` · опубликован ${dt(v.published_at)}` : ''}`,
    `Выводов ${v.findings}, рекомендаций ${v.recommendations}${v.confidence != null ? ` · уверенность ${pct(v.confidence)}` : ''}`,
    (v.hidden_hypotheses ?? 0) + (v.unreviewed_model_recommendations ?? 0) > 0
      ? `🧪 Выводов ИИ на проверке (в отчёт не вошли): ${(v.hidden_hypotheses ?? 0) + (v.unreviewed_model_recommendations ?? 0)}`
      : null,
    `Сформирован ${dt(v.created_at)}${v.agent_key ? ` агентом ${esc(v.agent_key)}` : ''}${v.model ? ` (${esc(v.model)})` : ''}`,
  ].filter((l): l is string => l !== null)
  await ctx.show(lines.join('\n'), [
    can(ctx, 'reports.publish') && v.status === 'ready' ? [ctx.button('🚀 Опубликовать клиенту', 'rv.pub', v.id)] : [],
    [ctx.button('🏢 Компания', 'cl.c', v.company_id), ctx.button('‹ Версии', 'rv.l', v.company_id, 0)],
  ])
}

export const reportSteps: Record<string, AdminStep> = {
  review_reason: {
    perm: 'insights.moderate',
    async run(ctx, state) {
      const reason = ctx.text.slice(0, 500)
      if (reason.length < 3) return void (await ctx.reply('Причина — от 3 символов. Напишите ещё раз или /cancel.'))
      await ctx.confirm(`🙈 Скрыть вывод ИИ с причиной «${esc(cut(reason, 200))}»? Клиент его не увидит.`, 'rw.no', [String(state.code), String(state.id), reason])
    },
  },
}

export const reportEntries: Record<string, AdminEntry> = {
  'rw.l': { perm: 'insights.moderate', run: (ctx, [p]) => showReviewQueue(ctx, pageOf(p)) },
  'rw.c': { perm: 'insights.moderate', run: (ctx, [code, id]) => showReviewItem(ctx, code, id) },
  'rw.ok': { perm: 'insights.moderate', run: (ctx, [code, id]) => review(ctx, code, id, 'approve', null) },
  'rw.no': {
    perm: 'insights.moderate',
    async run(ctx, [code, id]) {
      if (!KIND[code] || !UUID_RE.test(id)) return
      await ctx.setState({ step: 'review_reason', code, id })
      await ctx.show('🙈 Напишите причину одним сообщением (от 3 символов) или /cancel.')
    },
  },
  'rv.l': { perm: 'agents.view', run: (ctx, [companyId, p]) => showVersions(ctx, companyId ?? '-', pageOf(p)) },
  'rv.c': { perm: 'agents.view', run: (ctx, [id]) => showVersion(ctx, id) },
  'rv.pub': {
    perm: 'reports.publish',
    async run(ctx, [id]) {
      const v = UUID_RE.test(id) ? await getReportVersion(id) : null
      if (!v) return void (await ctx.show('Версия отчёта не найдена.'))
      await ctx.confirm(`🚀 Опубликовать клиенту «${esc(v.title)}» (версия ${v.version}, ${esc(v.company_name ?? v.company_id)})? Предыдущая опубликованная версия будет заменена.`, 'rv.pub', [id])
    },
  },
}

export const reportConfirmed: Record<string, AdminEntry> = {
  'rw.no': { perm: 'insights.moderate', run: (ctx, [code, id, reason]) => review(ctx, code, id, 'dismiss', reason ?? null) },
  'rv.pub': {
    perm: 'reports.publish',
    async run(ctx, [id]) {
      const res = await transitionReportVersion({ id, action: 'publish', reason: null, actorId: ctx.principal.userId, audit: auditFor(ctx) })
      const text = res.ok
        ? `✅ Опубликовано: «${esc(res.title)}», версия ${res.version}.`
        : res.code === 'not_found' ? 'Версия отчёта не найдена.'
          : res.code === 'wrong_status' ? REPORT_WRONG_STATUS.publish
            : res.code === 'audit_unavailable' ? '⚠️ Журнал аудита недоступен — действие не выполнено.'
              : '⚠️ Не удалось изменить статус версии.'
      await ctx.show(text, [[ctx.button('‹ Готовы к публикации', 'rv.l', '-', 0)]])
    },
  },
}
