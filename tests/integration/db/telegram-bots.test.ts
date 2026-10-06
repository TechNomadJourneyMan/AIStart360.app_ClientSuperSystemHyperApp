/**
 * Telegram bots on the real database (095 + 087):
 *   • 095 tables: RLS on, nothing for anon / authenticated, service role works;
 *   • per-bot update dedupe, conversation state with expiry;
 *   • expert linking (one-time code, role gate, one Telegram ↔ one expert);
 *   • expert notifications: level / quiet hours / dedupe;
 *   • admin bot end to end over the real read models (status, client card,
 *     users, registrations, notification settings) and staff notifications
 *     routed to the admin bot once it is configured.
 * The Bot API is a recording fetch; nothing leaves the box.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'

interface TgCall { url: string; method: string; body: Record<string, any> }

describe.skipIf(!dbTestsEnabled)('telegram bots (095)', async () => {
  const { prisma } = await import('@/lib/db')
  const { inRollback, asUser, asService, pgErrorCode, seedUser, closeTestPool } = await import('../../helpers/pg-rls')
  const { dbStateStore, firstSeenBotUpdate } = await import('@/lib/telegram/bots/store')
  const { createExpertLinkCode, consumeExpertLinkCode, expertByTelegramUser } = await import('@/lib/telegram/bots/expert/link')
  const { notifyExperts } = await import('@/lib/telegram/bots/expert/notify')
  const { createStaffLinkCode, consumeStaffLinkCode } = await import('@/lib/telegram/staff-link')
  const { handleUpdate } = await import('@/lib/telegram/bots/dispatcher')
  const { adminRouter } = await import('@/lib/telegram/bots/admin')
  const { signCallback } = await import('@/lib/telegram/bots/callback')
  const { memoryStateStore } = await import('@/lib/telegram/bots/store')
  const { companyCard } = await import('@/lib/telegram/bots/data')
  const { notifyStaff } = await import('@/lib/notifications/staff')

  const calls: TgCall[] = []
  let mid = 500
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, method: u.split('/').pop()!, body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify({ ok: true, result: u.endsWith('/sendMessage') ? { message_id: ++mid } : true }), { status: 200 })
  }) as unknown as typeof fetch
  const lastText = () => String([...calls].reverse().find((c) => c.method === 'sendMessage' || c.method === 'editMessageText')?.body.text ?? '')

  const tgBase = 800_000_000 + Math.floor(Math.random() * 1e6)
  const staff = { id: randomUUID(), tg: tgBase }
  const expert = { id: randomUUID(), tg: tgBase + 1 }
  const client = { id: randomUUID(), tg: tgBase + 2 }
  const pending = { id: randomUUID() }
  const companyId = randomUUID()
  const tag = `tgbots${Date.now()}`
  const env: Record<string, string | undefined> = {}
  const ENV = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_ADMIN_BOT_TOKEN', 'TELEGRAM_ADMIN_WEBHOOK_SECRET', 'TELEGRAM_EXPERT_BOT_TOKEN',
    'TELEGRAM_EXPERT_WEBHOOK_SECRET', 'TELEGRAM_EXPERT_BOT_USERNAME', 'NOTIFY_QUIET_HOURS', 'TELEGRAM_ADMIN_CHAT_IDS', 'TELEGRAM_CHAT_ID', 'ADMIN_NOTIFICATION_EMAIL', 'ADMIN_EMAIL', 'TELEGRAM_CALLBACK_SECRET']

  async function user(id: string, email: string, role: string, status = 'approved') {
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${id}::uuid, ${email})`
    await prisma.$executeRaw`UPDATE public.profiles SET role = ${role}, status = ${status}, full_name = ${`Имя ${email}`} WHERE id = ${id}::uuid`
  }

  beforeAll(async () => {
    for (const k of ENV) env[k] = process.env[k]
    process.env.TELEGRAM_BOT_TOKEN = 'client-token'
    process.env.TELEGRAM_WEBHOOK_SECRET = 'client-secret'
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = 'admin-token'
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    process.env.TELEGRAM_EXPERT_BOT_TOKEN = 'expert-token'
    process.env.TELEGRAM_EXPERT_WEBHOOK_SECRET = 'expert-secret'
    process.env.TELEGRAM_EXPERT_BOT_USERNAME = 'aist360notificationbot'
    process.env.NOTIFY_QUIET_HOURS = ''
    process.env.TELEGRAM_ADMIN_CHAT_IDS = ''
    delete process.env.TELEGRAM_CHAT_ID
    delete process.env.ADMIN_NOTIFICATION_EMAIL
    delete process.env.ADMIN_EMAIL
    delete process.env.TELEGRAM_CALLBACK_SECRET

    await user(staff.id, `${tag}.admin@staff.local`, 'client')
    await prisma.$executeRaw`INSERT INTO public.staff_roles (user_id, role) VALUES (${staff.id}::uuid, 'admin')`
    await user(expert.id, `${tag}.expert@staff.local`, 'expert')
    await user(client.id, `${tag}.client@corp.local`, 'client')
    await user(pending.id, `${tag}.pending@corp.local`, 'client', 'pending_approval')
    await prisma.$executeRaw`INSERT INTO public.companies (id, name, user_id, "updatedAt") VALUES (${companyId}, ${`Ромашка ${tag}`}, ${client.id}::uuid, now())`
    const [sess] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.diagnostic_sessions (company_id, status, stage, completeness, completed_at)
      VALUES (${companyId}, 'ready', 'recommendation', 0.82, now()) RETURNING id::text`
    await prisma.$executeRaw`
      INSERT INTO public.diagnostics (user_id, company_id, overall_score, health_index, stage, data_gaps, is_current, session_id)
      VALUES (${client.id}::uuid, ${companyId}, 64, 58, 'growth', '["выручка по месяцам", "маржа"]'::jsonb, true, ${sess.id}::uuid)`
    await prisma.$executeRaw`
      INSERT INTO public.diagnostic_findings (company_id, session_id, kind, area, title, severity, provenance_type, confidence, produced_by, visible_to_client)
      VALUES (${companyId}, ${sess.id}::uuid, 'risk', 'finance', 'Кассовый разрыв', 'critical', 'CALCULATED', 0.9, 'engine:test', true),
             (${companyId}, ${sess.id}::uuid, 'risk', 'sales', 'Гипотеза: отток клиентов', 'high', 'AI_HYPOTHESIS', 0.6, 'agent:diagnostic', false)`
  })

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM public.notification_events WHERE type LIKE 'test.tgbots%'`
    await prisma.$executeRaw`DELETE FROM public.telegram_bot_deliveries WHERE dedupe_key LIKE ${`${tag}%`}`
    await prisma.$executeRaw`DELETE FROM public.companies WHERE id = ${companyId}`
    await prisma.$executeRaw`DELETE FROM auth.users WHERE id IN (${staff.id}::uuid, ${expert.id}::uuid, ${client.id}::uuid, ${pending.id}::uuid)`
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    await closeTestPool()
    await prisma.$disconnect()
  })

  it('095 tables: RLS on, closed to anon and authenticated, open to the service role', async () => {
    const tables = ['telegram_bot_state', 'telegram_bot_updates_seen', 'telegram_bot_links', 'telegram_bot_deliveries']
    const rls = await prisma.$queryRaw<Array<{ relname: string; relrowsecurity: boolean }>>`
      SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY(${tables}::text[]) AND relnamespace = 'public'::regnamespace`
    expect(rls.map((r) => [r.relname, r.relrowsecurity]).sort()).toEqual(tables.map((t) => [t, true]).sort())

    await inRollback(async (db) => {
      const someone = await seedUser(db, { status: 'approved' })
      for (const t of tables) {
        for (const who of [null, someone]) {
          expect(await pgErrorCode(asUser(db, who, () => db.query(`SELECT * FROM public.${t} LIMIT 1`)))).toBe('42501')
        }
      }
      expect(await pgErrorCode(asUser(db, someone, () => db.query(
        `INSERT INTO public.telegram_bot_links (bot, user_id, telegram_user_id, chat_id, linked_at) VALUES ('expert', $1, 1, '1', now())`, [someone],
      )))).toBe('42501')
      expect(await pgErrorCode(asUser(db, someone, () => db.query(
        `INSERT INTO public.telegram_bot_state (bot, chat_id, state, expires_at) VALUES ('admin', '1', '{}', now() + interval '1 hour')`,
      )))).toBe('42501')
      await asService(db, async () => {
        await db.query(`INSERT INTO public.telegram_bot_state (bot, chat_id, state, expires_at) VALUES ('admin', 'svc', '{"step":"x"}', now() + interval '1 hour')`)
        const { rows } = await db.query(`SELECT state FROM public.telegram_bot_state WHERE chat_id = 'svc'`)
        expect(rows[0].state).toEqual({ step: 'x' })
      })
    })
  })

  it('dedupes updates per bot and keeps conversation state with an expiry', async () => {
    const id = Math.floor(Math.random() * 1e9)
    expect(await firstSeenBotUpdate('admin', id)).toBe(true)
    expect(await firstSeenBotUpdate('admin', id)).toBe(false)
    expect(await firstSeenBotUpdate('expert', id)).toBe(true) // ids are per bot
    expect(await firstSeenBotUpdate('expert', id)).toBe(false)

    const chat = `c${id}`
    await dbStateStore.set('admin', chat, staff.id, { step: 'client_search', page: 2 })
    expect(await dbStateStore.get('admin', chat)).toEqual({ step: 'client_search', page: 2 })
    expect(await dbStateStore.get('expert', chat)).toBeNull()
    await prisma.$executeRaw`UPDATE public.telegram_bot_state SET expires_at = now() - interval '1 second' WHERE bot = 'admin' AND chat_id = ${chat}`
    expect(await dbStateStore.get('admin', chat)).toBeNull()
    await dbStateStore.set('admin', chat, null, { step: 'x' })
    await dbStateStore.clear('admin', chat)
    expect(await dbStateStore.get('admin', chat)).toBeNull()
  })

  it('links an expert with a one-time code; non-experts and expired codes get nothing', async () => {
    const a = await createExpertLinkCode(expert.id)
    expect(a.deepLink).toMatch(/^https:\/\/t\.me\/aist360notificationbot\?start=expert_/)
    expect(await consumeExpertLinkCode({ code: a.code, telegramUserId: expert.tg, chatId: String(expert.tg) })).toEqual({ ok: true, userId: expert.id })
    expect((await consumeExpertLinkCode({ code: a.code, telegramUserId: expert.tg, chatId: String(expert.tg) })).ok).toBe(false)
    expect(await expertByTelegramUser(expert.tg)).toMatchObject({ userId: expert.id, role: 'expert' })

    // A client who somehow gets a code is still not an expert.
    const c = await createExpertLinkCode(client.id)
    expect((await consumeExpertLinkCode({ code: c.code, telegramUserId: client.tg, chatId: String(client.tg) })).ok).toBe(true)
    expect(await expertByTelegramUser(client.tg)).toBeNull()

    const e = await createExpertLinkCode(client.id)
    await prisma.$executeRaw`UPDATE public.telegram_bot_links SET link_code_expires_at = now() - interval '1 minute' WHERE bot = 'expert' AND user_id = ${client.id}::uuid`
    expect((await consumeExpertLinkCode({ code: e.code, telegramUserId: client.tg, chatId: String(client.tg) })).ok).toBe(false)
  })

  it('expert notifications: once per key, personal level and quiet hours respected', async () => {
    calls.length = 0
    const n = { kind: 'diagnostic.completed' as const, dedupeKey: `${tag}:diag`, companyId, lines: ['Клиент: Ромашка', 'Точка А: 64/100'] }
    const first = await notifyExperts(n, { fetchImpl: fakeFetch })
    expect(first.filter((d) => d.status === 'sent').map((d) => d.chatId)).toEqual([String(expert.tg)])
    expect(calls[0].url).toContain('/botexpert-token/sendMessage')
    expect(calls[0].body.text).toContain('Диагностика завершена')
    expect(JSON.stringify(calls[0].body.reply_markup)).toContain('callback_data')
    const again = await notifyExperts(n, { fetchImpl: fakeFetch })
    expect(again.every((d) => d.status === 'skipped' && d.reason === 'duplicate')).toBe(true)

    await prisma.$executeRaw`UPDATE public.telegram_bot_links SET min_level = 'WARNING' WHERE bot = 'expert' AND user_id = ${expert.id}::uuid`
    const low = await notifyExperts({ ...n, dedupeKey: `${tag}:low` }, { fetchImpl: fakeFetch })
    expect(low.find((d) => d.chatId === String(expert.tg))?.reason).toBe('below_personal_level')
    await prisma.$executeRaw`UPDATE public.telegram_bot_links SET min_level = 'INFO' WHERE bot = 'expert' AND user_id = ${expert.id}::uuid`

    process.env.NOTIFY_QUIET_HOURS = '23-8'
    try {
      const night = await notifyExperts({ ...n, dedupeKey: `${tag}:night` }, { fetchImpl: fakeFetch, now: new Date('2026-10-06T20:30:00Z') })
      expect(night.find((d) => d.chatId === String(expert.tg))?.reason).toBe('quiet_hours')
    } finally {
      process.env.NOTIFY_QUIET_HOURS = ''
    }
  })

  it('company card reads the real schema; unreviewed AI hypotheses only when asked for', async () => {
    const withAi = await companyCard(companyId, { includeUnreviewedHypotheses: true })
    expect(withAi).toMatchObject({ name: `Ромашка ${tag}`, criticalCount: 1, pendingHypotheses: 1 })
    expect(withAi?.diagnostic).toMatchObject({ score: 64, dataGaps: ['выручка по месяцам', 'маржа'] })
    expect(withAi?.session).toMatchObject({ status: 'ready', completeness: 0.82 })
    expect(withAi?.findings.map((f) => f.title)).toEqual(['Кассовый разрыв', 'Гипотеза: отток клиентов'])
    const reviewedOnly = await companyCard(companyId, { includeUnreviewedHypotheses: false })
    expect(reviewedOnly?.findings.map((f) => f.title)).toEqual(['Кассовый разрыв'])
  })

  it('admin bot end to end: linked staff, status, client card, users, registrations, notification level', async () => {
    const link = await createStaffLinkCode(staff.id)
    expect((await consumeStaffLinkCode({ code: link.code, telegramUserId: staff.tg, chatId: String(staff.tg) })).ok).toBe(true)
    const audit = vi.fn(async () => true)
    const deps = { fetchImpl: fakeFetch, state: memoryStateStore(), audit, rateLimit: async () => false, now: () => new Date() }
    const from = { id: staff.tg, username: 'adm' }
    let uid = Math.floor(Math.random() * 1e9)
    const text = (t: string) => handleUpdate(adminRouter(), { update_id: uid++, message: { message_id: uid, chat: { id: staff.tg, type: 'private' }, from, text: t } }, deps)
    const press = (data: string | null) => handleUpdate(adminRouter(), { update_id: uid++, callback_query: { id: `q${uid}`, from, data: data!, message: { message_id: 1, chat: { id: staff.tg } } } }, deps)

    calls.length = 0
    expect(await text('📊 Статус')).toBe('menu')
    expect(calls[0].url).toContain('/botadmin-token/')
    expect(lastText()).toContain('Очередь агентов')
    expect(lastText()).not.toContain('База данных') // admin has no settings.manage

    expect(await press(signCallback('admin', 'cl.c', companyId))).toBe('callback')
    expect(lastText()).toContain('Точка А: <b>64</b>/100')
    expect(lastText()).toContain('полнота 82%')
    expect(lastText()).toContain('гипотеза ИИ, не проверена') // admin holds insights.moderate

    expect(await press(signCallback('admin', 'cl.l', 0))).toBe('callback')
    expect(await press(signCallback('admin', 'ds.l', '-', 0))).toBe('callback')
    expect(lastText()).toContain('Диагностики')
    expect(await press(signCallback('admin', 'ds.l', companyId, 0))).toBe('callback')
    expect(lastText()).toContain('готова')

    expect(await press(signCallback('admin', 'rg.l', 0))).toBe('callback')
    expect(lastText()).toContain(`${tag}.pending@corp.local`)

    expect(await press(signCallback('admin', 'us.s'))).toBe('callback')
    expect(await text(`${tag}.client`)).toBe('step')
    expect(JSON.stringify(calls[calls.length - 1].body.reply_markup)).toContain('callback_data')

    expect(await press(signCallback('admin', 'nt.lv', 'c'))).toBe('callback')
    const [lvl] = await prisma.$queryRaw<Array<{ min_level: string }>>`SELECT min_level FROM public.staff_telegram_links WHERE user_id = ${staff.id}::uuid`
    expect(lvl.min_level).toBe('CRITICAL')
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ id: staff.id, kind: 'telegram', role: 'admin' }), expect.objectContaining({ action: 'staff.telegram.level' }), { required: true })
    await prisma.$executeRaw`UPDATE public.staff_telegram_links SET min_level = 'WARNING' WHERE user_id = ${staff.id}::uuid`
  })

  it('expert bot end to end over the real read models', async () => {
    const { expertRouter } = await import('@/lib/telegram/bots/expert')
    const deps = { fetchImpl: fakeFetch, state: memoryStateStore(), audit: vi.fn(async () => true), rateLimit: async () => false, now: () => new Date() }
    const from = { id: expert.tg }
    let uid = Math.floor(Math.random() * 1e9)
    const press = (data: string | null) => handleUpdate(expertRouter(), { update_id: uid++, callback_query: { id: `q${uid}`, from, data: data!, message: { message_id: 1, chat: { id: expert.tg } } } }, deps)
    const text = (t: string) => handleUpdate(expertRouter(), { update_id: uid++, message: { message_id: uid, chat: { id: expert.tg, type: 'private' }, from, text: t } }, deps)
    calls.length = 0
    expect(await press(signCallback('expert', 'cl.c', companyId))).toBe('callback')
    expect(lastText()).toContain(`Ромашка ${tag}`)
    expect(lastText()).toContain('гипотеза ИИ, не проверена')
    expect(await text('📄 Отчёты')).toBe('menu')
    expect(lastText()).toContain('Опубликованные отчёты')
    expect(await text('🩺 Диагностики')).toBe('menu')
    expect(await press(signCallback('expert', 'cl.s'))).toBe('callback')
    expect(await text(`Ромашка ${tag}`)).toBe('step')
    expect(JSON.stringify(calls[calls.length - 1].body.reply_markup)).toContain('callback_data')
    expect(await text('🔔 Уведомления')).toBe('menu')
    expect(lastText()).toContain('Мой уровень')
    // A client linked in the expert bot is refused.
    expect(await handleUpdate(expertRouter(), { update_id: uid++, message: { message_id: 1, chat: { id: client.tg, type: 'private' }, from: { id: client.tg }, text: '👥 Клиенты' } }, deps)).toBe('not_linked')
  })

  it('staff notifications travel through the admin bot once it is configured', async () => {
    calls.length = 0
    const r = await notifyStaff({ level: 'CRITICAL', type: `test.tgbots${Date.now()}`, title: 'Проверка маршрута' }, { fetchImpl: fakeFetch })
    const mine = r.deliveries.find((d) => d.target === String(staff.tg))
    expect(mine?.status).toBe('sent')
    const sent = calls.filter((c) => c.method === 'sendMessage')
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every((c) => c.url.includes('/botadmin-token/'))).toBe(true)

    delete process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET
    try {
      calls.length = 0
      await notifyStaff({ level: 'CRITICAL', type: `test.tgbots${Date.now()}b`, title: 'Без админ-бота' }, { fetchImpl: fakeFetch })
      expect(calls.filter((c) => c.method === 'sendMessage').every((c) => c.url.includes('/botclient-token/'))).toBe(true)
    } finally {
      process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    }
  })
})
