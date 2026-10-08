/**
 * lib/telegram/bots/expert — the expert bot (TELEGRAM_EXPERT_BOT_*).
 *
 * Who: a person linked from the expert cabinet (/expert/profile → «Привязать
 * Telegram», `/start expert_<code>`) whose approved profile role is in
 * EXPERT_ROLES — the same gate as /api/expert/** (lib/expert-auth.ts).
 * Scope: the same as those routes — experts are platform staff and read every
 * client company (no expert↔client assignment exists, see
 * lib/reports/expert-list.ts); reports: published versions, plus versions
 * waiting for the expert (status 'in_review', 103 — ./review.ts). Model
 * hypotheses not yet reviewed are shown because platform staff (incl.
 * 'expert') may read them under RLS 085 — always labelled as unreviewed.
 * Writes: their own notification level / mute, and the decision on a report
 * waiting for review («✅ Подтвердить и опубликовать» / «✏️ Нужны правки»),
 * re-verified on the server by lib/reports/review-flow.ts.
 */
import { getSiteUrl } from '@/lib/site-url'
import { LEVEL_LABELS } from '@/lib/notifications/levels'
import { REPORT_TYPE_LABELS } from '@/lib/reports/expert-list'
import { listReportVersions } from '@/lib/reports/versions'
import { renderCompanyCard, sessionLine } from '../cards'
import { companyCard, recentSessions, searchCompanies } from '../data'
import type { BotContext, BrainInput, Entry, Router, StepEntry } from '../dispatcher'
import { LEVEL_CODES, muteUntil, readSettings, renderSettings, writeLevel, writeMute } from '../notify-settings'
import { sendMessage, type InlineButton, type ReplyMarkup } from '../registry'
import { cut, dt, esc, pageOf, pagerRow, PAGE_SIZE } from '../ui'
import { consumeExpertLinkCode, expertByTelegramUser, EXPERT_START_PREFIX, type ExpertPrincipal } from './link'
import { reviewCallbacks, reviewSteps, showInReviewList } from './review'

type Ctx = BotContext<ExpertPrincipal>
type E = Entry<ExpertPrincipal>

export const EXPERT_MENU = ['👥 Клиенты', '🩺 Диагностики', '📄 Отчёты', '🔔 Уведомления'] as const

export { EXPERT_COMMANDS } from '../commands'

export function expertKeyboard(): ReplyMarkup {
  return {
    keyboard: [[{ text: EXPERT_MENU[0] }, { text: EXPERT_MENU[1] }], [{ text: EXPERT_MENU[2] }, { text: EXPERT_MENU[3] }]],
    resize_keyboard: true,
    is_persistent: true,
  }
}

async function welcome(ctx: Ctx): Promise<void> {
  await ctx.reply(`👋 ${esc(ctx.principal.name ?? 'Эксперт')}, это бот экспертов AIStart360: клиенты, диагностики и отчёты. Выберите раздел ниже.\n\n🤖 Можно просто написать вопрос, прислать голосовое, фото или файл — ассистент разберёт клиента, перескажет отчёт на проверке или подготовит черновик комментария. /new — начать разговор заново.`, expertKeyboard())
}

/** Free text, voice, photos and files → the assistant (lib/telegram/brain), client tools only. */
async function brain(ctx: Ctx, input: BrainInput): Promise<void> {
  const { runExpertBrain } = await import('@/lib/telegram/brain')
  await runExpertBrain(ctx, input)
}

async function clientsMenu(ctx: Ctx): Promise<void> {
  await ctx.show('👥 <b>Клиенты</b>', [[ctx.button('🔎 Найти', 'cl.s')], [ctx.button('🕘 Недавние', 'cl.l', 0)]])
}

async function listClients(ctx: Ctx, page: number): Promise<void> {
  const { items, hasMore } = await searchCompanies(null, page, PAGE_SIZE)
  const rows = items.map((c) => [ctx.button(`${cut(c.name, 34)}${c.score != null ? ` · ${Math.round(c.score)}` : ''}`, 'cl.c', c.id)])
  rows.push(pagerRow(ctx, 'cl.l', page, hasMore))
  await ctx.show(items.length ? '🕘 <b>Клиенты</b> (балл Точки А)' : 'Клиентов пока нет.', rows)
}

async function showClient(ctx: Ctx, id: string): Promise<void> {
  const card = await companyCard(id, { includeUnreviewedHypotheses: true })
  if (!card) return void (await ctx.show('Компания не найдена.'))
  await ctx.show(renderCompanyCard(card, { showContacts: true }), [
    [ctx.button('🩺 Диагностики', 'ds.l', card.id, 0), ctx.button('📄 Отчёты', 'rp.l', card.id, 0)],
  ])
}

async function listSessions(ctx: Ctx, companyId: string, page: number): Promise<void> {
  const { items, hasMore } = await recentSessions(page, PAGE_SIZE, companyId === '-' ? null : companyId)
  const lines = ['🩺 <b>Диагностики</b>', '', ...items.map(sessionLine)]
  if (!items.length) lines.push('Сессий нет.')
  const rows = companyId === '-' ? items.map((s) => [ctx.button(cut(s.company_name ?? s.company_id, 40), 'cl.c', s.company_id)]) : [[ctx.button('‹ К клиенту', 'cl.c', companyId)]]
  rows.push(pagerRow(ctx, 'ds.l', page, hasMore, companyId))
  await ctx.show(lines.join('\n'), rows)
}

async function listReports(ctx: Ctx, companyId: string, page: number): Promise<void> {
  // Published only — drafts and ready versions are reviewed in GIGA, not here.
  const all = (await listReportVersions({ companyId: companyId === '-' ? null : companyId, status: 'published', limit: 200 }))
    .filter((v) => v.status === 'published')
  const slice = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const lines = ['📄 <b>Опубликованные отчёты</b>', '']
  for (const v of slice) lines.push(`• ${esc(cut(v.company_name ?? v.company_id, 30))} · ${esc(REPORT_TYPE_LABELS[v.report_type] ?? v.report_type)} v${v.version} · ${dt(v.published_at)}`)
  if (!slice.length) lines.push('Опубликованных отчётов нет.')
  lines.push('', '<i>PDF открывается в браузере, где вы вошли в кабинет эксперта.</i>')
  const rows: Array<Array<InlineButton | null>> = slice.map((v) => [{ text: `📄 ${cut(v.company_name ?? '', 22)} v${v.version}`, url: getSiteUrl(`/api/v1/reports/${v.id}/pdf`) }, ctx.button('🏢', 'cl.c', v.company_id)])
  rows.push(pagerRow(ctx, 'rp.l', page, all.length > (page + 1) * PAGE_SIZE, companyId))
  rows.push([ctx.button('📝 На проверке', 'rr.l')])
  await ctx.show(lines.join('\n'), rows)
}

async function showNotifications(ctx: Ctx): Promise<void> {
  const s = await readSettings('expert', ctx.principal.userId)
  if (!s) return void (await ctx.show('Telegram не привязан.'))
  const { text, kb } = renderSettings(ctx, s, 'en', 'Сюда приходят: отчёты на проверке (PDF с кнопками), завершённые диагностики, опубликованные отчёты, одобренные клиенты.')
  await ctx.show(text, kb)
}

function audit(ctx: Ctx, action: string, value: unknown) {
  return ctx.deps.audit(
    { id: ctx.principal.userId, kind: 'telegram', email: ctx.principal.email ?? undefined },
    { action, entityType: 'expert_telegram_link', entityId: ctx.principal.userId, newValue: value, metadata: { via: 'telegram', bot: 'expert' } },
  )
}

const menuRuns: Record<string, (ctx: Ctx) => Promise<void>> = {
  [EXPERT_MENU[0]]: clientsMenu,
  [EXPERT_MENU[1]]: (ctx) => listSessions(ctx, '-', 0),
  [EXPERT_MENU[2]]: (ctx) => listReports(ctx, '-', 0),
  [EXPERT_MENU[3]]: showNotifications,
}

const steps: Record<string, StepEntry<ExpertPrincipal>> = {
  ...reviewSteps,
  ex_search: {
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

const callbacks: Record<string, E> = {
  'cl.s': {
    async run(ctx) {
      await ctx.setState({ step: 'ex_search' })
      await ctx.reply('🔎 Введите название компании, имя или email владельца (или /cancel).')
    },
  },
  'cl.l': { run: (ctx, [p]) => listClients(ctx, pageOf(p)) },
  'cl.c': { run: (ctx, [id]) => showClient(ctx, id) },
  'ds.l': { run: (ctx, [companyId, p]) => listSessions(ctx, companyId ?? '-', pageOf(p)) },
  'rp.l': { run: (ctx, [companyId, p]) => listReports(ctx, companyId ?? '-', pageOf(p)) },
  'en.v': { run: (ctx) => showNotifications(ctx) },
  ...reviewCallbacks,
  'en.lv': {
    async run(ctx, [code]) {
      const level = LEVEL_CODES[code]
      if (!level) return
      await audit(ctx, 'expert.telegram.level', { minLevel: level })
      await writeLevel('expert', ctx.principal.userId, level)
      await ctx.toast(`Уровень: ${LEVEL_LABELS[level]}`)
      await showNotifications(ctx)
    },
  },
  'en.mu': {
    async run(ctx, [h]) {
      const until = muteUntil(ctx.deps.now(), Number(h) || 0)
      await audit(ctx, 'expert.telegram.mute', { mutedUntil: until?.toISOString() ?? null })
      await writeMute('expert', ctx.principal.userId, until)
      await ctx.toast(until ? 'Без звука' : 'Звук включён')
      await showNotifications(ctx)
    },
  },
}

export function expertRouter(): Router<ExpertPrincipal> {
  const menu: Record<string, E> = {}
  for (const [label, run] of Object.entries(menuRuns)) menu[label] = { run: (ctx) => run(ctx) }
  return {
    bot: 'expert',
    resolve: (from) => expertByTelegramUser(from.id),
    authorize: () => true,
    async start({ payload, from, chatId, deps }) {
      if (!payload.startsWith(EXPERT_START_PREFIX)) return false
      const res = await consumeExpertLinkCode({ code: payload.slice(EXPERT_START_PREFIX.length), telegramUserId: from.id, chatId, username: from.username ?? null })
      const expert = res.ok ? await expertByTelegramUser(from.id) : null
      await sendMessage('expert', chatId, expert
        ? '✅ Telegram привязан к кабинету эксперта AIStart360. Сюда будут приходить отчёты на проверку (PDF с кнопками «Подтвердить» / «Нужны правки»), завершённые диагностики, опубликованные отчёты и новые клиенты.'
        : 'Ссылка привязки недействительна или истекла. Получите новую в кабинете эксперта → Профиль → «Привязать Telegram».',
      expert ? expertKeyboard() : undefined, deps.fetchImpl)
      return true
    },
    unlinkedText: '⛔ Этот бот — для экспертов AIStart360. Привяжите Telegram в кабинете эксперта → Профиль → «Привязать Telegram».',
    welcome,
    brain,
    commands: {
      start: { run: welcome },
      new: { run: async (ctx) => (await import('@/lib/telegram/brain')).resetBrainMemory(ctx) },
      menu: { run: welcome },
      help: { run: welcome },
      clients: { run: clientsMenu },
      diagnostics: { run: (ctx) => listSessions(ctx, '-', 0) },
      reports: { run: (ctx) => listReports(ctx, '-', 0) },
      review: { run: showInReviewList },
      notifications: { run: showNotifications },
    },
    menu,
    callbacks,
    confirmed: {},
    steps,
  }
}
