/**
 * Expert bot — report versions waiting for the expert (status 'in_review',
 * migration 103).
 *
 * Delivery (sendReviewDocuments): the PDF of the version («Версия N · дата»,
 * watermark «На проверке эксперта») goes with sendDocument to every linked
 * expert (telegram_bot_links bot='expert', approved, EXPERT_ROLES — the bot's
 * own gate), with two signed buttons:
 *   rr.ok <version>  «✅ Подтвердить и опубликовать» — publishes at once
 *   rr.ch <version>  «✏️ Нужны правки» — asks for a comment (dialog step
 *                    rr_comment, 30 minutes, /cancel leaves it)
 * One delivery per chat and version (telegram_bot_deliveries,
 * key report_review:<version id>).
 *
 * The buttons are signed (callback.ts) so a crafted callback cannot name
 * another version, but the signature does not authorise: every press goes
 * through decideReportReview, which re-reads the role, the approval, the 2FA
 * rule and the version status. A second press, or a press after a colleague
 * decided, changes nothing and says so.
 */
import { isExpertBotMember } from '@/lib/expert-auth'
import { prisma } from '@/lib/db'
import type { AuditWriter } from '@/lib/admin/staff-actions'
import type { ReportReviewPackage, ReportReviewRecipient } from '@/lib/reports/review-delivery'
import { DECIDE_ERRORS, REVIEW_COMMENT_MIN, decideReportReview, listInReviewVersions, reviewVersionHead, type DecideOutcome } from '@/lib/reports/review-flow'
import { REPORT_TYPE_LABELS } from '@/lib/reports/expert-list'
import { versionStamp } from '@/lib/reports/version-stamp'
import { signCallback } from '../callback'
import type { BotContext, Entry, StepEntry } from '../dispatcher'
import { callApi, sendDocument, type InlineButton, type ReplyMarkup } from '../registry'
import { cut, esc } from '../ui'
import type { ExpertPrincipal } from './link'

type Ctx = BotContext<ExpertPrincipal>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const REVIEW_COMMENT_STEP = 'rr_comment'
const COMMENT_TTL_MINUTES = 30

export function reviewKeyboard(versionId: string): ReplyMarkup | null {
  const ok = signCallback('expert', 'rr.ok', versionId)
  const ch = signCallback('expert', 'rr.ch', versionId)
  if (!ok || !ch) return null
  return { inline_keyboard: [[{ text: '✅ Подтвердить и опубликовать', callback_data: ok }], [{ text: '✏️ Нужны правки', callback_data: ch }]] }
}

export function reviewCaption(pkg: Pick<ReportReviewPackage, 'lines'>): string {
  return ['📝 <b>[AIStart360 · эксперт] Отчёт на проверке</b>', '', ...pkg.lines.map(esc)].join('\n')
}

async function claim(key: string, chatId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ chat_id: string }>>`
    INSERT INTO public.telegram_bot_deliveries (bot, dedupe_key, chat_id, status, reason)
    VALUES ('expert', ${key.slice(0, 200)}, ${chatId}, 'sent', NULL)
    ON CONFLICT (bot, dedupe_key, chat_id) DO UPDATE SET status = 'sent', reason = NULL
      WHERE public.telegram_bot_deliveries.status = 'failed'
    RETURNING chat_id`
  return rows.length > 0
}

export async function sendReviewDocuments(
  pkg: ReportReviewPackage,
  recipients: ReportReviewRecipient[],
  fetchImpl?: typeof fetch,
): Promise<Array<{ chatId: string; status: 'sent' | 'failed' | 'skipped'; reason?: string }>> {
  const markup = reviewKeyboard(pkg.versionId)
  const caption = reviewCaption(pkg)
  const key = `report_review:${pkg.versionId}`
  const out: Array<{ chatId: string; status: 'sent' | 'failed' | 'skipped'; reason?: string }> = []
  // Only people the expert bot itself admits (expert portal role or SuperExpert).
  const chats = recipients.filter((r) => r.expertBotChatId && isExpertBotMember(r.profileRole, r.staffRole))
  for (const r of chats) {
    const chatId = r.expertBotChatId as string
    if (!(await claim(key, chatId))) {
      out.push({ chatId, status: 'skipped', reason: 'duplicate' })
      continue
    }
    const res = await sendDocument('expert', chatId, { filename: pkg.filename, bytes: pkg.pdf, mime: 'application/pdf' }, caption, markup, fetchImpl)
    if (!res.ok) {
      // Marked failed: a later delivery of the same version may claim it again.
      await prisma.$executeRaw`
        UPDATE public.telegram_bot_deliveries SET status = 'failed', reason = ${res.description.slice(0, 200)}
        WHERE bot = 'expert' AND dedupe_key = ${key} AND chat_id = ${chatId}`
      out.push({ chatId, status: 'failed', reason: res.description })
    } else {
      out.push({ chatId, status: 'sent' })
    }
  }
  return out
}

// ─── Decisions in the bot ────────────────────────────────────────────────────

function auditWriter(ctx: Ctx): AuditWriter {
  const actor = { id: ctx.principal.userId, kind: 'telegram' as const, email: ctx.principal.email ?? undefined }
  return async (entry, opts) => {
    const ok = await ctx.deps.audit(actor, { ...entry, metadata: { ...(entry.metadata ?? {}), via: 'telegram', bot: 'expert' } }, opts)
    if (!ok && opts?.required) throw new Error('audit unavailable')
    return ok
  }
}

/** Drop the decision buttons under the card (the pressed one, or the card the comment belongs to). */
async function clearButtons(ctx: Ctx, cardMessageId?: number | null): Promise<void> {
  const messageId = cardMessageId ?? (ctx.isCallback ? ctx.messageId : null)
  if (!messageId) return
  await callApi('expert', 'editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }, ctx.deps.fetchImpl)
}

function outcomeText(res: DecideOutcome, label: string): string {
  if (res.ok) {
    const v = res.version
    const stamp = versionStamp(v.version, v.created_at)
    if (res.decision === 'approve') {
      return res.already
        ? `ℹ️ «${esc(label)}» (${stamp}) уже опубликован клиенту — повторное подтверждение ничего не меняет.`
        : `✅ Опубликовано клиенту: «${esc(label)}», ${stamp}. Клиент получил уведомление.`
    }
    if (res.already) return `ℹ️ Правки по «${esc(label)}» (${stamp}) уже запрошены.`
    const r = res.rerun
    const tail = !r ? ''
      : r.state === 'queued' ? ` Агент «Отчёт» пересоберёт отчёт (попытка ${r.attempt} из ${r.max}); новая версия придёт сюда же.`
        : r.state === 'cap_reached' ? ` Лимит пересборок (${r.max}) исчерпан — команда получила уведомление и поправит вручную.`
          : ' Пересборку не удалось запустить автоматически — команда получила уведомление.'
    return `✏️ Правки запрошены: «${esc(label)}», ${stamp}.${tail}`
  }
  if (res.code === 'wrong_status') {
    if (res.decided === 'approve') return 'ℹ️ Эту версию уже подтвердил коллега — она опубликована.'
    if (res.decided === 'changes_requested') return 'ℹ️ По этой версии уже запрошены правки.'
    return res.status === 'published' ? 'ℹ️ Эта версия уже опубликована.' : 'ℹ️ Версия больше не ждёт проверки (её заменила новая или её отклонили).'
  }
  return `⛔ ${esc(DECIDE_ERRORS[res.code])}`
}

async function decide(ctx: Ctx, versionId: string, decision: 'approve' | 'changes_requested', comment: string | null, cardMessageId?: number | null): Promise<void> {
  if (!UUID.test(versionId)) return
  const head = await reviewVersionHead(versionId)
  const label = head ? `${head.company_name ?? head.company_id} · ${REPORT_TYPE_LABELS[head.report_type] ?? head.report_type}` : 'отчёт'
  const res = await decideReportReview({
    versionId,
    reviewerId: ctx.principal.userId,
    decision,
    comment,
    channel: 'telegram',
    mfaVerified: false,
    audit: auditWriter(ctx),
  })
  if (res.ok || res.code === 'wrong_status') await clearButtons(ctx, cardMessageId)
  await ctx.toast(res.ok ? (decision === 'approve' ? 'Опубликовано' : 'Правки отправлены') : 'Не выполнено')
  await ctx.reply(outcomeText(res, label))
}

async function listInReview(ctx: Ctx): Promise<void> {
  const items = await listInReviewVersions(20)
  const lines = [`📝 <b>Отчёты на проверке: ${items.length}</b>`, '']
  for (const v of items.slice(0, 10)) lines.push(`• ${esc(cut(v.company_name ?? v.company_id, 30))} · ${esc(versionStamp(v.version, v.created_at))}`)
  if (!items.length) lines.push('Нет версий, которые ждут проверки.')
  const rows: InlineButton[][] = items.slice(0, 10)
    .map((v) => signCallback('expert', 'rr.pdf', v.id) ? [{ text: `📄 ${cut(v.company_name ?? '', 24)} v${v.version}`, callback_data: signCallback('expert', 'rr.pdf', v.id) as string }] : [])
    .filter((r) => r.length > 0)
  await ctx.show(lines.join('\n'), rows)
}

/** Send the PDF card of one in_review version again (for this chat only). */
async function resendCard(ctx: Ctx, versionId: string): Promise<void> {
  if (!UUID.test(versionId)) return
  const { reportReviewPackage } = await import('@/lib/reports/review-delivery')
  const pkg = await reportReviewPackage(versionId)
  if (!pkg) return void (await ctx.reply('ℹ️ Версия больше не ждёт проверки.'))
  const res = await sendDocument('expert', ctx.chatId, { filename: pkg.filename, bytes: pkg.pdf, mime: 'application/pdf' }, reviewCaption(pkg), reviewKeyboard(pkg.versionId), ctx.deps.fetchImpl)
  if (!res.ok) await ctx.reply('⚠️ Не удалось отправить PDF. Откройте версию в кабинете эксперта.')
  else await ctx.toast('PDF отправлен')
}

export const reviewCallbacks: Record<string, Entry<ExpertPrincipal>> = {
  'rr.ok': { run: (ctx, [id]) => decide(ctx, id, 'approve', null) },
  'rr.ch': {
    async run(ctx, [id]) {
      if (!UUID.test(id)) return
      const head = await reviewVersionHead(id)
      if (!head || head.status !== 'in_review') {
        await clearButtons(ctx)
        return void (await ctx.reply('ℹ️ Версия больше не ждёт проверки.'))
      }
      await ctx.setState({ step: REVIEW_COMMENT_STEP, versionId: id, cardMessageId: ctx.messageId }, COMMENT_TTL_MINUTES)
      await ctx.toast('Напишите комментарий')
      await ctx.reply(`✏️ Что поправить в отчёте «${esc(head.company_name ?? head.company_id)}» (${esc(versionStamp(head.version, head.created_at))})? Напишите одним сообщением (от ${REVIEW_COMMENT_MIN} символов) или /cancel.`)
    },
  },
  'rr.l': { run: (ctx) => listInReview(ctx) },
  'rr.pdf': { run: (ctx, [id]) => resendCard(ctx, id) },
}

export const reviewSteps: Record<string, StepEntry<ExpertPrincipal>> = {
  [REVIEW_COMMENT_STEP]: {
    async run(ctx, state) {
      const comment = ctx.text.trim().slice(0, 2000)
      if (comment.length < REVIEW_COMMENT_MIN) {
        return void (await ctx.reply(`Комментарий — от ${REVIEW_COMMENT_MIN} символов. Напишите ещё раз или /cancel.`))
      }
      await ctx.clearState()
      const card = typeof state.cardMessageId === 'number' ? state.cardMessageId : null
      await decide(ctx, String(state.versionId ?? ''), 'changes_requested', comment, card)
    },
  },
}

export { listInReview as showInReviewList }
