import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../helpers/db-env'
import { pgPostgrest } from '../helpers/pg-postgrest'
import { closeTestPool, inRollback, seedCompany, seedStaff, seedUser, type Db } from '../helpers/pg-rls'

// /api/pulse authenticates via the Supabase session (the old forgeable
// `aistart360_role` cookie path was removed as a security fix). The route's
// session client (createServerClient → cookies()) only exists inside a Next
// request, so the test hands the route the same client over the disposable
// test DB: the caller's own RLS (pgPostgrest as that user) plus the session
// user GoTrue would return. Everything the route reads — profiles, companies,
// diagnostics, Point A snapshots — comes from rows seeded here, inside a
// rolled-back transaction.
const h = vi.hoisted(() => ({
  client: null as unknown,
  getDailyBriefing: vi.fn(),
  uncached: { tag: 'UNCACHED_BRIEFING_DEPS' },
}))

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => h.client }))
// The daily briefing is its own module (rate limit, cache, model call); here
// only the hand-off is checked, deterministically, with or without a model key.
vi.mock('@/lib/ai/openrouter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/openrouter')>()),
  hasOpenRouterKey: () => true,
}))
vi.mock('@/lib/pulse/briefing', () => ({ getDailyBriefing: h.getDailyBriefing, UNCACHED_BRIEFING_DEPS: h.uncached }))

const { GET } = await import('../../app/api/pulse/route')

// A platform client carries only what is known: no official Point A score → no risk (null), never a
// stand-in number; no revenue figures on the platform → avgCheck / volumeChange / orderCycle are null.
type Client = {
  id: string; name: string; sector: string; daysSince: number | null; avgCheck: number | null; volumeChange: number | null
  riskScore: number | null; churnProb: number | null; churnLevel: string | null; comment: string | null; action: string
  history: number[]; orderCycle: number | null
}
type Payload = {
  stats: {
    revenueAtRisk: number | null; highRisk: number; mediumRisk: number; noScore: number
    totalClients: number; processedToday: number; dailyTarget: number
  }
  todayClients: Client[]
  aiBriefing: string | null
}

function sessionClient(db: Db, user: { id: string; email: string }) {
  return Object.assign(pgPostgrest(db, user.id), {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  })
}

/** The Point A snapshot that wrote the diagnostic (v4 on): what the official reader goes by. */
type Snapshot = { overall: number | null; v4: Record<string, unknown> }
const PRELIMINARY: Snapshot = { overall: null, v4: { assessment: 'preliminary' } }
const TOO_LITTLE_DATA: Snapshot = { overall: null, v4: { assessment: 'full' } }

/**
 * An approved client with a company and (optionally) a current Point A diagnostic of raw
 * `health_index` — and, optionally, the snapshot that wrote it. Without a snapshot the diagnostics row
 * is the official Point A (legacy rows, before migration 111).
 */
async function client(db: Db, name: string, industry: string, diag?: { health: number | null; daysAgo: number }, snap?: Snapshot) {
  const id = await seedUser(db, { status: 'approved' })
  const company = await seedCompany(db, id, name)
  await db.query(`UPDATE public.companies SET industry = $2 WHERE id = $1`, [company, industry])
  if (diag) {
    const { rows } = await db.query(
      `INSERT INTO public.diagnostics (user_id, company_id, overall_score, health_index, calculated_at)
       VALUES ($1, $2, $3, $3, now() - make_interval(days => $4)) RETURNING id`,
      [id, company, diag.health, diag.daysAgo],
    )
    if (snap) {
      await db.query(
        `INSERT INTO public.point_a_snapshots (company_id, diagnostic_id, engine, overall, blocks, v4, inputs_hash, config_version)
         VALUES ($1, $2, 'v4', $3, '[]'::jsonb, $4::jsonb, 'h', 'base@1/r1|v4')`,
        [company, rows[0].id, snap.overall, JSON.stringify(snap.v4)],
      )
    }
  }
  return id
}

const scored = (c: Client) => c.riskScore !== null

describe.skipIf(!dbTestsEnabled)('pulse api', () => {
  afterAll(closeTestPool)
  beforeEach(() => {
    h.getDailyBriefing.mockReset()
    h.getDailyBriefing.mockResolvedValue({ text: 'Позвоните «Риск» первым.' })
  })

  it('without a session → 401, nothing is read', () =>
    inRollback(async (db) => {
      h.client = Object.assign(pgPostgrest(db, null), {
        auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      })
      const res = await GET()
      expect(res.status).toBe(401)
    }))

  it('risk only from the official Point A score; «нет оценки» with its reason otherwise', () =>
    inRollback(async (db) => {
      const admin = await seedStaff(db, 'super_admin')
      // Seeded least risky first (the read returns them in this order), so the riskiest-first order
      // of the answer is the route's own sorting, not the seeding.
      // no diagnostic → «Анкета не заполнена»
      const noSurvey = await client(db, 'Без анкеты Co', 'Производство')
      // the full questionnaire not sent (prod 2026-11-17: 11 of 24 current rows, health_index NULL)
      const preliminary = await client(db, 'Предварительная Co', 'Логистика', { health: null, daysAgo: 2 }, PRELIMINARY)
      // …the same with a number left in diagnostics.health_index: still no score (it used to be ranked)
      const staleNumber = await client(db, 'Старый балл Co', 'Логистика', { health: 80, daysAgo: 4 }, PRELIMINARY)
      // sent, but v4 found too little data for an overall score
      const littleData = await client(db, 'Мало данных Co', 'Услуги', { health: 75, daysAgo: 1 }, TOO_LITTLE_DATA)
      // legacy row, no snapshot: the diagnostics row is official — health 85 → risk 15, low, «monitor»
      const healthy = await client(db, 'Здоровая Co', 'IT', { health: 85, daysAgo: 0 })
      // v4 scored: the health is the snapshot's (62), not the raw column (10) → risk 38, low, «message»
      const v4 = await client(db, 'V4 Co', 'IT', { health: 10, daysAgo: 0 }, { overall: 60, v4: { assessment: 'full', health_index: 62 } })
      // health 55 → risk 45, medium, «message»
      const middle = await client(db, 'Средняя Co', 'Услуги', { health: 55, daysAgo: 1 })
      // health 30 → risk 70, high, «call»
      const risky = await client(db, 'Риск Co', 'Ритейл', { health: 30, daysAgo: 3 })
      // …and an older calculation of it kept as history (not current), dated later: only the current
      // row counts (the read used to take every row, history included, and the newest by date)
      await db.query(
        `INSERT INTO public.diagnostics (user_id, overall_score, health_index, calculated_at, is_current)
         VALUES ($1, 90, 90, now(), false)`, [risky])
      // (the versioning trigger demotes the current row on every insert: put the state back — the
      // calculation of 3 days ago is current, the later-dated one is history)
      await db.query(`UPDATE public.diagnostics SET is_current = (calculated_at < now() - interval '1 day') WHERE user_id = $1`, [risky])
      // not in the pulse: a client still waiting for approval, an expert with a company
      const pending = await seedUser(db, { status: 'pending_approval' })
      await seedCompany(db, pending, 'Ждёт одобрения Co')
      const expert = await seedUser(db, { status: 'approved', role: 'expert' })
      await seedCompany(db, expert, 'Экспертная Co')

      h.client = sessionClient(db, { id: admin, email: 'admin@test.local' })
      const res = await GET()
      expect(res.status).toBe(200)
      const payload = await res.json() as Payload

      const seeded = new Set([noSurvey, preliminary, staleNumber, littleData, healthy, v4, middle, risky])
      const byId = new Map(payload.todayClients.map((c) => [c.id, c]))
      expect(payload.todayClients.length).toBeGreaterThanOrEqual(seeded.size)
      expect(byId.has(pending)).toBe(false)
      expect(byId.has(expert)).toBe(false)

      // No revenue data on the platform: no check, no volume change, no order cycle (they used to be
      // finance score × 10 000 ₸, sales score − 50 and 30 days); the sparkline is the one real point.
      expect(byId.get(risky)).toEqual({
        id: risky, name: 'Риск Co', sector: 'Ритейл', forbes: null, lastOrder: expect.any(String), daysSince: 3,
        avgCheck: null, volumeChange: null, riskScore: 70, churnProb: 70, churnLevel: 'high',
        comment: 'Требует внимания', action: 'call', orderCycle: null, history: [30],
      })
      expect(byId.get(middle)).toMatchObject({ daysSince: 1, riskScore: 45, churnLevel: 'medium', comment: null, action: 'message' })
      expect(byId.get(v4)).toMatchObject({ riskScore: 38, churnLevel: 'low', comment: null, action: 'message', history: [62] })
      expect(byId.get(healthy)).toMatchObject({ daysSince: 0, riskScore: 15, churnLevel: 'low', comment: null, action: 'monitor' })

      const noScore = (comment: string, daysSince: number | null) => ({
        avgCheck: null, volumeChange: null, riskScore: null, churnProb: null, churnLevel: null,
        comment, action: 'message', orderCycle: null, history: [], daysSince,
      })
      expect(byId.get(noSurvey)).toEqual({
        id: noSurvey, name: 'Без анкеты Co', sector: 'Производство', forbes: null, lastOrder: null,
        ...noScore('Анкета не заполнена', null),
      })
      expect(byId.get(preliminary)).toEqual({
        id: preliminary, name: 'Предварительная Co', sector: 'Логистика', forbes: null, lastOrder: expect.any(String),
        ...noScore('Нет оценки: анкета не завершена', 2),
      })
      expect(byId.get(staleNumber)).toMatchObject(noScore('Нет оценки: анкета не завершена', 4))
      expect(byId.get(littleData)).toMatchObject(noScore('Нет оценки: мало данных для оценки', 1))

      // Rows committed by other suites (none on a clean DB) are counted the same way.
      const others = payload.todayClients.filter((c) => !seeded.has(c.id))
      const n = (f: (c: Client) => boolean) => others.filter(f).length
      expect(payload.stats).toEqual({
        processedToday: 7 + n((c) => c.action !== 'monitor'), // all but the healthy one
        totalClients: 8 + others.length,
        highRisk: 1 + n((c) => c.churnLevel === 'high'),
        mediumRisk: 1 + n((c) => c.churnLevel === 'medium'), // the clients without a score are not «medium»
        noScore: 4 + n((c) => !scored(c)),
        // a high-risk client with no known check, and clients whose risk nobody knows → unknown, not 0
        revenueAtRisk: null,
        dailyTarget: 6,
      })

      // Riskiest first, the clients without a score after every scored one.
      const order = payload.todayClients.map((c) => c.riskScore)
      const firstUnscored = order.indexOf(null)
      expect(order.slice(firstUnscored).every((r) => r === null)).toBe(true)
      const ranked = order.slice(0, firstUnscored) as number[]
      expect(ranked).toEqual([...ranked].sort((a, b) => b - a))

      // The briefing gets the highest-risk client first, by name, for this user — not through the
      // daily cache of the «Пульс» page.
      expect(h.getDailyBriefing).toHaveBeenCalledTimes(1)
      const [briefUser, prompt, deps] = h.getDailyBriefing.mock.calls[0] as [string, string, unknown]
      expect(briefUser).toBe(admin)
      expect(deps).toBe(h.uncached)
      // The briefing lists the five riskiest scored clients of the whole platform: other test files may
      // commit clients of their own, so the check is the rule itself — the risks in the prompt are the
      // five highest of the answer — and «Риск Co» is there whenever fewer than five others are as risky.
      const risks = [...prompt.matchAll(/^\d+\. ".+?" — риск (\d+)\/100/gm)].map((m) => Number(m[1]))
      expect(risks).toEqual(ranked.slice(0, 5))
      if (others.filter((c) => (c.riskScore ?? -1) >= 70).length < 5) expect(prompt).toContain('"Риск Co"')
      // …never a client without a score, and no made-up money
      for (const name of ['Без анкеты Co', 'Предварительная Co', 'Старый балл Co', 'Мало данных Co']) {
        expect(prompt).not.toContain(`"${name}"`)
      }
      expect(prompt).not.toContain('₸')
      expect(prompt).toContain(`- Без оценки (риск неизвестен): ${payload.stats.noScore}`)
      expect(prompt).toContain('- Выручка под угрозой: нет данных')
      expect(payload.aiBriefing).toBe('Позвоните «Риск» первым.')
    }))

  it('a client sees only their own row', () =>
    inRollback(async (db) => {
      const me = await client(db, 'Моя Co', 'Ритейл', { health: 30, daysAgo: 2 })
      await client(db, 'Чужая Co', 'IT', { health: 20, daysAgo: 2 })

      h.client = sessionClient(db, { id: me, email: 'me@test.local' })
      const payload = await (await GET()).json() as Payload

      expect(payload.todayClients.map((c) => c.name)).toEqual(['Моя Co'])
      // high risk, check unknown → the money at risk is unknown
      expect(payload.stats).toMatchObject({ totalClients: 1, processedToday: 1, highRisk: 1, noScore: 0, revenueAtRisk: null })
    }))

  it('money at risk is 0 only when it is known: every client scored, none at high risk', () =>
    inRollback(async (db) => {
      const me = await client(db, 'Моя Co', 'Ритейл', { health: 75, daysAgo: 2 })

      h.client = sessionClient(db, { id: me, email: 'me@test.local' })
      const payload = await (await GET()).json() as Payload

      expect(payload.stats).toEqual({
        revenueAtRisk: 0, highRisk: 0, mediumRisk: 0, noScore: 0, totalClients: 1, processedToday: 0, dailyTarget: 6,
      })
    }))

  it('nothing scored → no risk counts, money at risk unknown, no briefing (it would rank clients by a risk nobody has)', () =>
    inRollback(async (db) => {
      const me = await client(db, 'Моя Co', 'Ритейл', { health: null, daysAgo: 1 }, PRELIMINARY)

      h.client = sessionClient(db, { id: me, email: 'me@test.local' })
      const payload = await (await GET()).json() as Payload

      expect(payload.todayClients).toEqual([expect.objectContaining({
        name: 'Моя Co', riskScore: null, churnLevel: null, comment: 'Нет оценки: анкета не завершена',
      })])
      expect(payload.stats).toEqual({
        revenueAtRisk: null, highRisk: 0, mediumRisk: 0, noScore: 1, totalClients: 1, processedToday: 1, dailyTarget: 6,
      })
      expect(h.getDailyBriefing).not.toHaveBeenCalled()
      expect(payload.aiBriefing).toBeNull()
    }))

  it('scored without a health index → «Нет оценки здоровья», nothing to ask the client for', () =>
    inRollback(async (db) => {
      const me = await client(db, 'Моя Co', 'Ритейл')
      // legacy row (no snapshot): an overall score but no health index
      await db.query(`INSERT INTO public.diagnostics (user_id, overall_score, health_index) VALUES ($1, 60, NULL)`, [me])

      h.client = sessionClient(db, { id: me, email: 'me@test.local' })
      const payload = await (await GET()).json() as Payload

      expect(payload.todayClients).toEqual([expect.objectContaining({
        name: 'Моя Co', riskScore: null, churnLevel: null, comment: 'Нет оценки здоровья', action: 'monitor', history: [],
      })])
      expect(payload.stats).toMatchObject({ noScore: 1, processedToday: 0, revenueAtRisk: null })
    }))

  // A failed read is an error, never a confident answer: a failed diagnostics read used to show every
  // client as «Анкета не заполнена», and without the snapshots the raw row would pass as official
  // («Старый балл Co»: preliminary, a leftover 80 in health_index → «risk 20, low»).
  it.each(['diagnostics', 'point_a_snapshots'])('a failed %s read → 500', (failing) =>
    inRollback(async (db) => {
      const admin = await seedStaff(db, 'super_admin')
      await client(db, 'Старый балл Co', 'Логистика', { health: 80, daysAgo: 4 }, PRELIMINARY)

      const session = sessionClient(db, { id: admin, email: 'admin@test.local' })
      const from = session.from.bind(session)
      const failed: Record<string, unknown> = {
        select: () => failed, eq: () => failed, in: () => failed, order: () => failed,
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'connection reset' } }).then(ok),
      }
      h.client = Object.assign(session, { from: (table: string) => (table === failing ? failed : from(table)) })
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const res = await GET()
        expect(res.status).toBe(500)
        expect(await res.json()).toEqual({ error: 'Пульс временно недоступен' })
        expect(h.getDailyBriefing).not.toHaveBeenCalled()
      } finally {
        errorLog.mockRestore()
      }
    }))
})
