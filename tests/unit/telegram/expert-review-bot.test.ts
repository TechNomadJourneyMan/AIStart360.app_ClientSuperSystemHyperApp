/**
 * Expert bot — a report version waiting for the expert (103):
 *   • the PDF goes out with sendDocument and two signed buttons, once per chat;
 *   • «✅ Подтвердить и опубликовать» → decideReportReview(approve, telegram,
 *     mfaVerified=false) for THIS expert, buttons removed, outcome told;
 *   • «✏️ Нужны правки» → a comment step; the comment → changes_requested;
 *     /cancel leaves the step without a decision; a too short comment is asked again;
 *   • a crafted / other-bot callback never reaches the decision;
 *   • the server answer (already decided by a colleague, no right, 2FA) is shown as is.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buttonData, msg, press, recordingFetch, testDeps } from './_bot-harness'

const VID = '7b0c4e2a-1d3f-4a5b-8c6d-9e0f1a2b3c4d'
const EXPERT = 'e0e0e0e0-0000-4000-8000-000000000001'
const s = vi.hoisted(() => ({ claimed: new Set<string>() }))

vi.mock('@/lib/telegram/bots/expert/link', () => ({
  EXPERT_START_PREFIX: 'expert_',
  consumeExpertLinkCode: vi.fn(),
  expertByTelegramUser: async () => ({ userId: 'e0e0e0e0-0000-4000-8000-000000000001', role: 'expert', email: 'exp@aistart360.test', name: 'Эксперт' }),
}))
vi.mock('@/lib/telegram/bots/data', () => ({ companyCard: vi.fn(), searchCompanies: vi.fn(), recentSessions: vi.fn() }))
vi.mock('@/lib/reports/versions', () => ({ listReportVersions: vi.fn(async () => []) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    // telegram_bot_deliveries claim: first insert per (key, chat) wins.
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('telegram_bot_deliveries')) {
        const k = `${values[0]}|${values[1]}`
        if (s.claimed.has(k)) return []
        s.claimed.add(k)
        return [{ chat_id: values[1] }]
      }
      return []
    }),
    $executeRaw: vi.fn(async () => 1),
  },
}))

const head = { id: VID, company_id: 'co-1', company_name: 'ТОО Ромашка', session_id: null, report_type: 'point_a', version: 3, status: 'in_review', title: 'Точка А', data_hash: 'h', created_at: '2026-10-05T20:30:00.000Z', published_at: null }
const flow = vi.hoisted(() => ({
  decideReportReview: vi.fn(),
  reviewVersionHead: vi.fn(),
  listInReviewVersions: vi.fn(async () => []),
}))
vi.mock('@/lib/reports/review-flow', async () => {
  const real = await vi.importActual<typeof import('@/lib/reports/review-flow')>('@/lib/reports/review-flow')
  return { ...real, decideReportReview: flow.decideReportReview, reviewVersionHead: flow.reviewVersionHead, listInReviewVersions: flow.listInReviewVersions }
})

const { expertRouter } = await import('@/lib/telegram/bots/expert')
const { handleUpdate } = await import('@/lib/telegram/bots/dispatcher')
const { signCallback } = await import('@/lib/telegram/bots/callback')
const { sendReviewDocuments, reviewKeyboard } = await import('@/lib/telegram/bots/expert/review')

const ENV = ['TELEGRAM_EXPERT_BOT_TOKEN', 'TELEGRAM_EXPERT_WEBHOOK_SECRET', 'TELEGRAM_ADMIN_WEBHOOK_SECRET', 'TELEGRAM_CALLBACK_SECRET']
const saved: Record<string, string | undefined> = {}

const ok = (decision: 'approve' | 'changes_requested', extra: Record<string, unknown> = {}) => ({
  ok: true, decision, already: false, reviewId: 'r1', version: { ...head, status: decision === 'approve' ? 'published' : 'superseded' }, superseded: [], rerun: null, ...extra,
})

describe('expert bot: report review', () => {
  let tg = recordingFetch()
  let h = testDeps(tg.fetchImpl)
  const run = (u: Parameters<typeof handleUpdate>[1]) => handleUpdate(expertRouter(), u, h.deps)

  beforeAll(() => {
    for (const k of ENV) saved[k] = process.env[k]
    process.env.TELEGRAM_EXPERT_BOT_TOKEN = 'expert-token'
    process.env.TELEGRAM_EXPERT_WEBHOOK_SECRET = 'expert-secret'
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    delete process.env.TELEGRAM_CALLBACK_SECRET
  })
  afterAll(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  })
  beforeEach(() => {
    tg = recordingFetch()
    h = testDeps(tg.fetchImpl)
    flow.decideReportReview.mockReset()
    flow.reviewVersionHead.mockReset().mockResolvedValue(head)
    s.claimed.clear()
  })

  it('sends the PDF once per chat with the two signed buttons', async () => {
    const pkg = {
      versionId: VID, companyId: 'co-1', companyName: 'ТОО Ромашка', version: 3, title: 'Точка А', stamp: 'Версия 3 · 06.10.2026',
      pdf: Buffer.from('%PDF-1.7 x'), filename: 'aistart360-point_a-v3-2026-10-06-review.pdf',
      lines: ['Клиент: ТОО Ромашка', 'Точка А — Версия 3 · 06.10.2026'], expertUrl: 'https://x/expert', gigaUrl: 'https://x/giga',
    }
    const recipients = [
      { userId: EXPERT, name: 'Эксперт', email: null, phone: null, profileRole: 'expert', staffRole: null, expertBotChatId: '555000111', isExpert: true },
      // A SuperExpert (staff role, profile 'client') is an expert-bot member too.
      { userId: 'u2', name: 'SE', email: null, phone: null, profileRole: 'client', staffRole: 'super_expert', expertBotChatId: '999', isExpert: true },
      // An admin-staff person without an expert role is not.
      { userId: 'u4', name: 'CRM', email: null, phone: null, profileRole: 'client', staffRole: 'crm_manager', expertBotChatId: '777', isExpert: false },
      { userId: 'u3', name: 'Нет бота', email: null, phone: null, profileRole: 'expert', staffRole: null, expertBotChatId: null, isExpert: true },
    ]
    expect(await sendReviewDocuments(pkg, recipients, tg.fetchImpl)).toEqual([{ chatId: '555000111', status: 'sent' }, { chatId: '999', status: 'sent' }])
    const call = tg.calls.find((c) => c.method === 'sendDocument')!
    expect(call.body).toMatchObject({ chat_id: '555000111', parse_mode: 'HTML', document: { name: pkg.filename, type: 'application/pdf' } })
    expect(call.body.caption).toContain('Отчёт на проверке')
    expect(call.body.caption).toContain('Версия 3 · 06.10.2026')
    const buttons = call.body.reply_markup.inline_keyboard.flat()
    expect(buttons.map((b: { text: string }) => b.text)).toEqual(['✅ Подтвердить и опубликовать', '✏️ Нужны правки'])
    // Again: deduplicated.
    expect(await sendReviewDocuments(pkg, recipients, tg.fetchImpl)).toEqual([
      { chatId: '555000111', status: 'skipped', reason: 'duplicate' },
      { chatId: '999', status: 'skipped', reason: 'duplicate' },
    ])
    expect(tg.calls.filter((c) => c.method === 'sendDocument')).toHaveLength(2)
  })

  it('«Подтвердить» decides as this expert over Telegram (no web 2FA proof) and removes the buttons', async () => {
    flow.decideReportReview.mockResolvedValue(ok('approve'))
    const kb = reviewKeyboard(VID) as { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> }
    const data = buttonData(kb.inline_keyboard.flat(), 'Подтвердить')
    expect(await run(press(data))).toBe('callback')
    expect(flow.decideReportReview).toHaveBeenCalledTimes(1)
    expect(flow.decideReportReview.mock.calls[0][0]).toMatchObject({ versionId: VID, reviewerId: EXPERT, decision: 'approve', channel: 'telegram', mfaVerified: false, comment: null })
    expect(tg.calls.some((c) => c.method === 'editMessageReplyMarkup' && c.body.message_id === 4242)).toBe(true)
    expect(tg.lastText()).toContain('Опубликовано клиенту')
    expect(tg.lastText()).toContain('Версия 3 · 06.10.2026')
  })

  it('a second press after a colleague decided changes nothing and says so', async () => {
    flow.decideReportReview.mockResolvedValue({ ok: false, code: 'wrong_status', status: 'published', decided: 'approve' })
    await run(press(signCallback('expert', 'rr.ok', VID)))
    expect(tg.lastText()).toContain('уже подтвердил коллега')
  })

  it('refusals from the server are shown: 2FA required, no right', async () => {
    flow.decideReportReview.mockResolvedValue({ ok: false, code: 'mfa_required' })
    await run(press(signCallback('expert', 'rr.ok', VID)))
    expect(tg.lastText()).toContain('двухфакторную')
    flow.decideReportReview.mockResolvedValue({ ok: false, code: 'forbidden' })
    await run(press(signCallback('expert', 'rr.ok', VID)))
    expect(tg.lastText()).toContain('Нет права')
  })

  it('«Нужны правки» asks for a comment; the comment requests changes; the card buttons are removed', async () => {
    flow.decideReportReview.mockResolvedValue(ok('changes_requested', { rerun: { state: 'queued', taskId: 't1', attempt: 1, max: 3 } }))
    expect(await run(press(signCallback('expert', 'rr.ch', VID), undefined, 9001))).toBe('callback')
    expect(flow.decideReportReview).not.toHaveBeenCalled()
    expect(tg.lastText()).toContain('Что поправить')
    expect(h.state.dump().get('expert:555000111')).toMatchObject({ step: 'rr_comment', versionId: VID, cardMessageId: 9001 })

    expect(await run(msg('ок'))).toBe('step') // too short
    expect(flow.decideReportReview).not.toHaveBeenCalled()
    expect(tg.lastText()).toContain('от 3 символов')

    expect(await run(msg('Выручка в выводе по финансам не совпадает с P&L'))).toBe('step')
    expect(flow.decideReportReview.mock.calls[0][0]).toMatchObject({ versionId: VID, decision: 'changes_requested', comment: 'Выручка в выводе по финансам не совпадает с P&L', channel: 'telegram', mfaVerified: false })
    expect(tg.calls.some((c) => c.method === 'editMessageReplyMarkup' && c.body.message_id === 9001)).toBe(true)
    expect(tg.lastText()).toContain('попытка 1 из 3')
    expect(h.state.dump().size).toBe(0)
  })

  it('/cancel leaves the comment step without a decision', async () => {
    await run(press(signCallback('expert', 'rr.ch', VID)))
    expect(await run(msg('/cancel'))).toBe('cancelled')
    // No pending step any more: free text is a question to the assistant, not a comment.
    expect(await run(msg('Теперь это просто текст'))).toBe('brain')
    expect(flow.decideReportReview).not.toHaveBeenCalled()
  })

  it('«Нужны правки» on a version no longer in review does not start the dialog', async () => {
    flow.reviewVersionHead.mockResolvedValue({ ...head, status: 'published' })
    await run(press(signCallback('expert', 'rr.ch', VID)))
    expect(h.state.dump().size).toBe(0)
    expect(tg.lastText()).toContain('больше не ждёт проверки')
  })

  it('crafted, unsigned or admin-bot buttons never reach the decision', async () => {
    expect(await run(press(`rr.ok|~${Buffer.from(VID.replace(/-/g, ''), 'hex').toString('base64url')}|AAAAAAAAAAAA`))).toBe('bad_signature')
    expect(await run(press(signCallback('admin', 'rr.ok', VID)))).toBe('bad_signature')
    expect(flow.decideReportReview).not.toHaveBeenCalled()
  })
})
