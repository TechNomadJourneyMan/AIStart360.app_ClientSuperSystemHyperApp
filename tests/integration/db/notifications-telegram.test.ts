/**
 * Staff notifications and Telegram approvals on the real database (087):
 * staff linking, level routing, dedupe, cooldown, quiet hours, approval buttons
 * only for approvers, signed callbacks, decision → task re-queued → cards closed.
 * The Telegram Bot API is replaced by a recording fetch; nothing leaves the box.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'

interface TgCall { method: string; body: Record<string, any> }

describe.skipIf(!dbTestsEnabled)('notifications + Telegram approvals', async () => {
  const { prisma } = await import('@/lib/db')
  const { createStaffLinkCode, consumeStaffLinkCode } = await import('@/lib/telegram/staff-link')
  const { notifyStaff } = await import('@/lib/notifications/staff')
  const { handleApprovalCallback } = await import('@/lib/telegram/staff-updates')
  const { approvalCallbackData } = await import('@/lib/notifications/approval-callback')
  const { notificationForEvent } = await import('@/lib/notifications/event-router')
  const { formatTelegram } = await import('@/lib/notifications/staff')

  const calls: TgCall[] = []
  let messageId = 100
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const method = String(url).split('/').pop()!
    const body = JSON.parse(String(init?.body ?? '{}'))
    calls.push({ method, body })
    const result = method === 'sendMessage' ? { message_id: ++messageId } : true
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 })
  }) as unknown as typeof fetch

  const admin = { id: randomUUID(), tg: 900_000_000 + Math.floor(Math.random() * 1e6) }
  const analyst = { id: randomUUID(), tg: admin.tg + 1 }
  const type = `test.t${Date.now()}`
  const env: Record<string, string | undefined> = {}

  async function staffUser(id: string, role: string) {
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${id}::uuid, ${`${id}@staff.local`})`
    await prisma.$executeRaw`UPDATE public.profiles SET status = 'approved' WHERE id = ${id}::uuid`
    await prisma.$executeRaw`INSERT INTO public.staff_roles (user_id, role) VALUES (${id}::uuid, ${role})`
  }

  beforeAll(async () => {
    for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'NOTIFY_QUIET_HOURS', 'TELEGRAM_ADMIN_CHAT_IDS', 'TELEGRAM_CHAT_ID', 'AGENT_INLINE_EXECUTION', 'ADMIN_NOTIFICATION_EMAIL', 'ADMIN_EMAIL']) env[k] = process.env[k]
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret'
    process.env.NOTIFY_QUIET_HOURS = ''
    process.env.TELEGRAM_ADMIN_CHAT_IDS = ''
    delete process.env.TELEGRAM_CHAT_ID
    delete process.env.ADMIN_NOTIFICATION_EMAIL
    delete process.env.ADMIN_EMAIL
    process.env.AGENT_INLINE_EXECUTION = 'false'
    await staffUser(admin.id, 'admin')
    await staffUser(analyst.id, 'analyst')
  })

  beforeEach(() => {
    calls.length = 0
  })

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM public.notification_events WHERE type LIKE 'test.%' OR type = 'agent.approval'`
    await prisma.$executeRaw`DELETE FROM auth.users WHERE id IN (${admin.id}::uuid, ${analyst.id}::uuid)`
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    await prisma.$disconnect()
  })

  it('links a Telegram account to a staff user with a one-time code', async () => {
    const a = await createStaffLinkCode(admin.id)
    expect(await consumeStaffLinkCode({ code: a.code, telegramUserId: admin.tg, chatId: String(admin.tg) })).toEqual({ ok: true, userId: admin.id })
    expect(await consumeStaffLinkCode({ code: a.code, telegramUserId: admin.tg, chatId: String(admin.tg) })).toEqual({ ok: false, reason: 'invalid_or_expired' })

    const b = await createStaffLinkCode(analyst.id)
    await prisma.$executeRaw`UPDATE public.staff_telegram_links SET link_code_expires_at = now() - interval '1 minute' WHERE user_id = ${analyst.id}::uuid`
    expect((await consumeStaffLinkCode({ code: b.code, telegramUserId: analyst.tg, chatId: String(analyst.tg) })).ok).toBe(false)
    const c = await createStaffLinkCode(analyst.id)
    expect((await consumeStaffLinkCode({ code: c.code, telegramUserId: analyst.tg, chatId: String(analyst.tg) })).ok).toBe(true)
  })

  it('routes by level: WARNING to linked staff, INFO only to the feed, duplicates once', async () => {
    const warn = await notifyStaff({ level: 'WARNING', type, title: 'Очередь растёт', lines: ['20 задач ждут'], dedupeKey: `${type}:w1` }, { fetchImpl: fakeFetch })
    expect(warn.deliveries.filter((d) => d.status === 'sent').map((d) => d.target).sort()).toEqual([String(admin.tg), String(analyst.tg)].sort())
    expect(calls[0].body.text).toContain('[AIStart360]')
    expect(calls[0].body.reply_markup).toBeUndefined()

    const info = await notifyStaff({ level: 'INFO', type: `${type}.info`, title: 'Файл загружен' }, { fetchImpl: fakeFetch })
    expect(info.deliveries.every((d) => d.status === 'skipped' && d.reason === 'below_platform_level')).toBe(true)

    const dup = await notifyStaff({ level: 'WARNING', type, title: 'Очередь растёт', dedupeKey: `${type}:w1` }, { fetchImpl: fakeFetch })
    expect(dup).toEqual({ eventId: null, duplicate: true, deliveries: [] })
  })

  it('cools down repeated warnings of the same type but always delivers CRITICAL', async () => {
    const again = await notifyStaff({ level: 'WARNING', type, title: 'Очередь всё ещё растёт' }, { fetchImpl: fakeFetch })
    expect(again.deliveries.every((d) => d.reason === 'cooldown')).toBe(true)
    const crit = await notifyStaff({ level: 'CRITICAL', type, title: 'Очередь стоит' }, { fetchImpl: fakeFetch })
    expect(crit.deliveries.filter((d) => d.status === 'sent')).toHaveLength(2)
  })

  it('holds back warnings at night (Asia/Almaty) but not critical alerts', async () => {
    process.env.NOTIFY_QUIET_HOURS = '23-8'
    try {
      const night = new Date('2026-10-06T20:30:00Z') // 01:30 in Almaty (UTC+5)
      const w = await notifyStaff({ level: 'WARNING', type: `${type}.night`, title: 'Ночью' }, { fetchImpl: fakeFetch, now: night })
      expect(w.deliveries.every((d) => d.reason === 'quiet_hours')).toBe(true)
      const c = await notifyStaff({ level: 'CRITICAL', type: `${type}.night2`, title: 'Ночью критично' }, { fetchImpl: fakeFetch, now: night })
      expect(c.deliveries.some((d) => d.status === 'sent')).toBe(true)
    } finally {
      process.env.NOTIFY_QUIET_HOURS = ''
    }
  })

  it('formats a completed diagnostic the way the team reads it', async () => {
    const companyId = randomUUID()
    await prisma.$executeRaw`INSERT INTO public.companies (id, name, "updatedAt") VALUES (${companyId}, 'Company X', now())`
    try {
      const n = await notificationForEvent({
        id: 1, name: 'DIAGNOSTIC_COMPLETED', company_id: companyId, subject_type: 'diagnostic_session', subject_id: 's1', actor: 'agent:diagnostic_orchestrator',
        payload: { score: 64, critical_findings: 3, files_processed: 12, metrics_calculated: 87, report_generated: true, agent_name: 'Diagnostic Agent' },
      })
      expect(n?.level).toBe('SUCCESS')
      expect(formatTelegram(n!)).toBe([
        '✅ <b>[AIStart360]</b> Готово',
        '',
        '<b>Диагностика завершена</b>',
        'Клиент: Company X',
        'Score: 64/100',
        'Критических выводов: 3',
        'Файлов обработано: 12',
        'Метрик рассчитано: 87',
        'Отчёт сформирован.',
        'Агент: Diagnostic Agent',
      ].join('\n'))
    } finally {
      await prisma.$executeRaw`DELETE FROM public.companies WHERE id = ${companyId}`
    }
  })

  it('approval: buttons only for approvers, signed, decided once, card closed, task re-queued', async () => {
    const [task] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.agent_tasks (agent_key, trigger, status, attempts) VALUES ('test_mailer', 'manual', 'awaiting_approval', 1)
      RETURNING id`
    const [approval] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.agent_approvals (task_id, agent_key, tool, permission, summary, payload, payload_hash)
      VALUES (${task.id}::uuid, 'test_mailer', 'send_email', 'SEND_EMAIL', 'Отправить письмо клиенту', '{}', 'h')
      RETURNING id`

    const sent = await notifyStaff({ level: 'APPROVAL_REQUIRED', type: 'agent.approval', title: 'Агент просит одобрения', approvalId: approval.id }, { fetchImpl: fakeFetch })
    expect(sent.deliveries.map((d) => d.target)).toEqual([String(admin.tg)]) // analyst has no approvals.decide
    const keyboard = calls[0].body.reply_markup.inline_keyboard[0]
    expect(keyboard.map((b: { text: string }) => b.text)).toEqual(['✅ Одобрить', '❌ Отклонить'])
    const approveData = keyboard[0].callback_data as string
    expect(approveData).toBe(approvalCallbackData(approval.id, 'approve'))
    expect(approveData.length).toBeLessThanOrEqual(64)

    const press = (from: number, data: string) =>
      handleApprovalCallback({ id: `cb-${Math.random()}`, from: { id: from }, data }, { fetchImpl: fakeFetch })

    expect(await press(admin.tg, approveData.replace(/:a:/, ':r:'))).toBe('bad_signature') // flipped action, old signature
    expect(await press(123456, approveData)).toBe('not_linked')
    expect(await press(analyst.tg, approveData)).toBe('no_permission')

    calls.length = 0
    expect(await press(admin.tg, approveData)).toBe('decided')
    const [row] = await prisma.$queryRaw<Array<{ status: string; decided_via: string; decided_by: string }>>`
      SELECT status, decided_via, decided_by FROM public.agent_approvals WHERE id = ${approval.id}::uuid`
    expect(row).toEqual({ status: 'approved', decided_via: 'telegram', decided_by: admin.id })
    const [t] = await prisma.$queryRaw<Array<{ status: string; trigger: string }>>`SELECT status, trigger FROM public.agent_tasks WHERE id = ${task.id}::uuid`
    expect(t).toEqual({ status: 'queued', trigger: 'approval' })
    const edit = calls.find((c) => c.method === 'editMessageText')
    expect(edit?.body.text).toContain('Одобрено')
    expect(edit?.body.reply_markup).toEqual({ inline_keyboard: [] })

    expect(await press(admin.tg, approveData)).toBe('not_pending')
    await prisma.$executeRaw`DELETE FROM public.agent_tasks WHERE id = ${task.id}::uuid`
  })
})
