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
// diagnostics — comes from rows seeded here, inside a rolled-back transaction.
const h = vi.hoisted(() => ({
  client: null as unknown,
  getDailyBriefing: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => h.client }))
// The daily briefing is its own module (rate limit, cache, model call); here
// only the hand-off is checked, deterministically, with or without a model key.
vi.mock('@/lib/ai/openrouter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/openrouter')>()),
  hasOpenRouterKey: () => true,
}))
vi.mock('@/lib/pulse/briefing', () => ({ getDailyBriefing: h.getDailyBriefing }))

const { GET } = await import('../../app/api/pulse/route')

type Client = {
  id: string; name: string; sector: string; daysSince: number | null; avgCheck: number; volumeChange: number
  riskScore: number; churnProb: number; churnLevel: string; comment: string | null; action: string; history: number[]
}
type Payload = {
  stats: { revenueAtRisk: number; highRisk: number; mediumRisk: number; totalClients: number; processedToday: number; dailyTarget: number }
  todayClients: Client[]
  aiBriefing: string | null
}

function sessionClient(db: Db, user: { id: string; email: string }) {
  return Object.assign(pgPostgrest(db, user.id), {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  })
}

/** An approved client with a company and (optionally) a Point A diagnostic of `health`. */
async function client(db: Db, name: string, industry: string, diag?: { health: number; finance: number; sales: number; daysAgo: number }) {
  const id = await seedUser(db, { status: 'approved' })
  const company = await seedCompany(db, id, name)
  await db.query(`UPDATE public.companies SET industry = $2 WHERE id = $1`, [company, industry])
  if (diag) {
    await db.query(
      `INSERT INTO public.diagnostics (user_id, overall_score, health_index, finance_score, sales_score, calculated_at)
       VALUES ($1, $2, $2, $3::jsonb, $4::jsonb, now() - make_interval(days => $5))`,
      [id, diag.health, JSON.stringify({ score: diag.finance }), JSON.stringify({ score: diag.sales }), diag.daysAgo],
    )
  }
  return id
}

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

  it('calculates processedToday from actionable clients instead of hardcoded value', () =>
    inRollback(async (db) => {
      const admin = await seedStaff(db, 'super_admin')
      // health 30 → risk 70, high, «call»; finance 12 → avgCheck 120 000 (revenue at risk)
      const risky = await client(db, 'Риск Co', 'Ритейл', { health: 30, finance: 12, sales: 40, daysAgo: 3 })
      // …and an older calculation of it kept as history (not current), dated later: only the current
      // row counts (the read used to take every row, history included, and the newest by date)
      await db.query(
        `INSERT INTO public.diagnostics (user_id, overall_score, health_index, finance_score, sales_score, calculated_at, is_current)
         VALUES ($1, 90, 90, '{"score": 1}'::jsonb, '{"score": 1}'::jsonb, now(), false)`, [risky])
      // (the versioning trigger demotes the current row on every insert: put the state back — the
      // calculation of 3 days ago is current, the later-dated one is history)
      await db.query(`UPDATE public.diagnostics SET is_current = (calculated_at < now() - interval '1 day') WHERE user_id = $1`, [risky])
      // health 55 → medium, «message»
      const middle = await client(db, 'Средняя Co', 'Услуги', { health: 55, finance: 5, sales: 60, daysAgo: 1 })
      // health 85 → low, «monitor»: NOT processed today
      const healthy = await client(db, 'Здоровая Co', 'IT', { health: 85, finance: 30, sales: 70, daysAgo: 0 })
      // no diagnostic → health 50, medium, «message», «Анкета не заполнена»
      const noSurvey = await client(db, 'Без анкеты Co', 'Производство')
      // not in the pulse: a client still waiting for approval, an expert with a company
      const pending = await seedUser(db, { status: 'pending_approval' })
      await seedCompany(db, pending, 'Ждёт одобрения Co')
      const expert = await seedUser(db, { status: 'approved', role: 'expert' })
      await seedCompany(db, expert, 'Экспертная Co')

      h.client = sessionClient(db, { id: admin, email: 'admin@test.local' })
      const res = await GET()
      expect(res.status).toBe(200)
      const payload = await res.json() as Payload

      const seeded = new Set([risky, middle, healthy, noSurvey])
      const byId = new Map(payload.todayClients.map((c) => [c.id, c]))
      expect(payload.todayClients.length).toBeGreaterThanOrEqual(4)
      expect(byId.has(pending)).toBe(false)
      expect(byId.has(expert)).toBe(false)

      expect(byId.get(risky)).toMatchObject({
        name: 'Риск Co', sector: 'Ритейл', daysSince: 3, avgCheck: 120000, volumeChange: -10,
        riskScore: 70, churnProb: 70, churnLevel: 'high', comment: 'Требует внимания', action: 'call',
        history: [18, 21, 24, 27, 30],
      })
      expect(byId.get(middle)).toMatchObject({
        name: 'Средняя Co', daysSince: 1, avgCheck: 50000, volumeChange: 10,
        riskScore: 45, churnLevel: 'medium', comment: null, action: 'message',
      })
      expect(byId.get(healthy)).toMatchObject({
        name: 'Здоровая Co', daysSince: 0, riskScore: 15, churnLevel: 'low', comment: null, action: 'monitor',
      })
      expect(byId.get(noSurvey)).toMatchObject({
        name: 'Без анкеты Co', daysSince: null, avgCheck: 0, riskScore: 50, churnLevel: 'medium',
        comment: 'Анкета не заполнена', action: 'message',
      })

      // Rows committed by other suites (none on a clean DB) are counted the same way.
      const others = payload.todayClients.filter((c) => !seeded.has(c.id))
      const n = (f: (c: Client) => boolean) => others.filter(f).length
      expect(payload.stats).toEqual({
        processedToday: 3 + n((c) => c.action !== 'monitor'), // risky, middle, noSurvey — not the healthy one
        totalClients: 4 + others.length,
        highRisk: 1 + n((c) => c.churnLevel === 'high'),
        mediumRisk: 2 + n((c) => c.churnLevel === 'medium'),
        revenueAtRisk: 120000 + others.filter((c) => c.churnLevel === 'high').reduce((s, c) => s + c.avgCheck, 0),
        dailyTarget: 6,
      })
      expect(payload.stats.processedToday).toBeLessThan(payload.stats.totalClients)

      // The briefing gets the highest-risk client first, by name, for this user.
      expect(h.getDailyBriefing).toHaveBeenCalledTimes(1)
      const [briefUser, prompt] = h.getDailyBriefing.mock.calls[0] as [string, string]
      expect(briefUser).toBe(admin)
      // The briefing lists the five riskiest clients of the whole platform: other test files may
      // commit clients of their own, so the check is the rule itself — the risks in the prompt are the
      // five highest of the answer — and «Риск Co» is there whenever fewer than five others are as risky.
      const risks = [...prompt.matchAll(/^\d+\. ".+?" — .*?, риск (\d+)\/100/gm)].map((m) => Number(m[1]))
      expect(risks).toEqual(payload.todayClients.map((c) => c.riskScore).sort((a, b) => b - a).slice(0, 5))
      const riskyRisk = byId.get(risky)!.riskScore
      if (others.filter((c) => c.riskScore >= riskyRisk).length < 5) expect(prompt).toContain('"Риск Co"')
      expect(payload.aiBriefing).toBe('Позвоните «Риск» первым.')
    }))

  it('a client sees only their own row', () =>
    inRollback(async (db) => {
      const me = await client(db, 'Моя Co', 'Ритейл', { health: 30, finance: 2, sales: 50, daysAgo: 2 })
      await client(db, 'Чужая Co', 'IT', { health: 20, finance: 9, sales: 50, daysAgo: 2 })

      h.client = sessionClient(db, { id: me, email: 'me@test.local' })
      const payload = await (await GET()).json() as Payload

      expect(payload.todayClients.map((c) => c.name)).toEqual(['Моя Co'])
      expect(payload.stats).toMatchObject({ totalClients: 1, processedToday: 1, highRisk: 1, revenueAtRisk: 20000 })
    }))
})
