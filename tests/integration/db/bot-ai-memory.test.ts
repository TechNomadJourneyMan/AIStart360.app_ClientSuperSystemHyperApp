/**
 * Bot assistant memory on the real database (109):
 *   • bot_ai_messages: RLS on, closed to anon / authenticated, service role works;
 *   • dbBrainMemory: window of the last MEMORY_MESSAGES messages, 24 h age,
 *     prune on write, remembered files (file_id only) by id and «last», /new;
 *   • the bots' housekeeping drops rows older than 24 h; the read tools'
 *     SQL (stuck on survey, staff tasks, cases, events) runs on the schema.
 * Run: TEST_DATABASE_URL=… npx vitest run tests/integration/db/bot-ai-memory.test.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'

describe.skipIf(!dbTestsEnabled)('bot assistant memory (109)', async () => {
  const { prisma } = await import('@/lib/db')
  const { inRollback, asUser, asService, pgErrorCode, seedUser, closeTestPool } = await import('../../helpers/pg-rls')
  const { dbBrainMemory, MEMORY_MESSAGES } = await import('@/lib/telegram/brain/memory')
  const { purgeBotHousekeeping } = await import('@/lib/telegram/bots/store')
  const { findStuckOnSurvey, ADMIN_READ_TOOLS } = await import('@/lib/telegram/brain/tools-read')
  const chat = `t${Date.now()}`.slice(0, 20)

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM public.bot_ai_messages WHERE chat_id LIKE ${`${chat}%`}`
    await closeTestPool()
  })

  it('RLS on, closed to anon and authenticated, open to the service role', async () => {
    const rls = await prisma.$queryRaw<Array<{ relrowsecurity: boolean }>>`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'bot_ai_messages' AND relnamespace = 'public'::regnamespace`
    expect(rls[0]?.relrowsecurity).toBe(true)
    await inRollback(async (db) => {
      const someone = await seedUser(db, { status: 'approved' })
      for (const who of [null, someone]) {
        expect(await pgErrorCode(asUser(db, who, () => db.query('SELECT * FROM public.bot_ai_messages LIMIT 1')))).toBe('42501')
      }
      expect(await pgErrorCode(asUser(db, someone, () => db.query(
        `INSERT INTO public.bot_ai_messages (bot, chat_id, role, content) VALUES ('admin', '1', 'user', 'x')`,
      )))).toBe('42501')
      await asService(db, async () => {
        await db.query(`INSERT INTO public.bot_ai_messages (bot, chat_id, role, content) VALUES ('admin', 'svc', 'user', 'x')`)
        const { rows } = await db.query(`SELECT content FROM public.bot_ai_messages WHERE chat_id = 'svc'`)
        expect(rows[0].content).toBe('x')
      })
      expect(await pgErrorCode(db.query(`INSERT INTO public.bot_ai_messages (bot, chat_id, role, content) VALUES ('client', '1', 'user', 'x')`))).toBe('23514')
    })
  })

  it('window, prune on write, files, reset', async () => {
    const c = `${chat}a`
    for (let i = 0; i < MEMORY_MESSAGES + 6; i++) {
      await dbBrainMemory.append('admin', c, null, [{ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }])
    }
    const window = await dbBrainMemory.load('admin', c)
    expect(window).toHaveLength(MEMORY_MESSAGES)
    expect(window[0].content).toBe('m6')
    expect(window.at(-1)!.content).toBe(`m${MEMORY_MESSAGES + 5}`)
    const stored = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM public.bot_ai_messages WHERE chat_id = ${c}`
    expect(Number(stored[0].n)).toBe(MEMORY_MESSAGES)

    const id = await dbBrainMemory.rememberFile('admin', c, null, { fileId: 'AgAD-file', fileName: 'отчёт.pdf', mime: 'application/pdf', size: 1234, kind: 'document' })
    expect(id).toMatch(/^\d+$/)
    expect(await dbBrainMemory.lastFile('admin', c)).toMatchObject({ id, fileId: 'AgAD-file', fileName: 'отчёт.pdf', kind: 'document' })
    expect(await dbBrainMemory.fileById('admin', c, id!)).toMatchObject({ fileId: 'AgAD-file' })
    expect(await dbBrainMemory.fileById('expert', c, id!)).toBeNull()
    expect(await dbBrainMemory.fileById('admin', `${chat}other`, id!)).toBeNull()
    // Files never enter the replayed window.
    expect((await dbBrainMemory.load('admin', c)).some((m) => m.content.includes('отчёт'))).toBe(false)

    await dbBrainMemory.reset('admin', c)
    expect(await dbBrainMemory.load('admin', c)).toEqual([])
    expect(await dbBrainMemory.lastFile('admin', c)).toBeNull()
  })

  it('older than 24 h: not replayed, pruned by housekeeping', async () => {
    const c = `${chat}b`
    await prisma.$executeRaw`
      INSERT INTO public.bot_ai_messages (bot, chat_id, role, content, created_at)
      VALUES ('expert', ${c}, 'user', 'old', now() - interval '25 hours')`
    expect(await dbBrainMemory.load('expert', c)).toEqual([])
    await purgeBotHousekeeping()
    const left = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM public.bot_ai_messages WHERE chat_id = ${c}`
    expect(Number(left[0].n)).toBe(0)
  })

  it('the read tools\' SQL runs on the schema', async () => {
    expect(Array.isArray(await findStuckOnSurvey(3))).toBe(true)
    const role = { bot: 'admin' as const, userId: '00000000-0000-4000-8000-000000000001', email: null, staffRole: 'super_admin' as const }
    const t = { role, scope: { kind: 'all' as const }, pii: true, mcpScopes: [], now: new Date(), ctx: {} as never, deps: {} as never, turn: { proposed: false, file: null } }
    const inputs: Record<string, unknown> = {
      list_staff_tasks: { assignee: 'all', overdue_only: true },
      list_cases: { overdue_only: true },
      list_platform_events: { hours: 48, name: 'FILE_UPLOADED' },
    }
    for (const [name, raw] of Object.entries(inputs)) {
      const tool = ADMIN_READ_TOOLS.find((x) => x.name === name)!
      const args = tool.input.parse(raw)
      const res = await tool.run(args, t)
      expect(Array.isArray(res.items)).toBe(true)
    }
  })
})
