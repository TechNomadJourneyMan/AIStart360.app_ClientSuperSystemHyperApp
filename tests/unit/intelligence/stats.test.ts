/**
 * /intelligence stat tiles are real: AI insights = active AI_HYPOTHESIS rows
 * of diagnostic_findings (not a constant '0'), clients = profiles with role
 * 'client' (not the NextAuth-era Prisma `clients` table), system status =
 * the /api/health checks (not a constant 'Active'). A failed read is reported
 * as failed, never as 0.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  sql: [] as string[],
  audit: 12 as number | Error,
  clients: 7 as number | Error,
  ai: { total: 5, awaiting_review: 3 } as { total: number; awaiting_review: number } | Error,
  ping: true,
  missingEnv: [] as string[],
  legacyClientCount: 0,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    auditLog: {
      count: async () => {
        if (s.audit instanceof Error) throw s.audit
        return s.audit
      },
    },
    client: { count: async () => { s.legacyClientCount++; return 999 } },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?').replace(/\s+/g, ' ').trim()
      s.sql.push(sql)
      if (sql === 'SELECT 1') {
        if (!s.ping) throw new Error('connection refused')
        return [{ '?column?': 1 }]
      }
      if (sql.includes('FROM public.profiles')) {
        if (s.clients instanceof Error) throw s.clients
        return [{ n: s.clients }]
      }
      if (sql.includes('FROM public.diagnostic_findings')) {
        if (s.ai instanceof Error) throw s.ai
        return [s.ai]
      }
      throw new Error(`unexpected SQL: ${sql}`)
    },
  },
}))
vi.mock('@/lib/env', () => ({ getMissingServerEnv: () => s.missingEnv }))

import { dbStatusFor, getIntelligenceStats } from '@/lib/intelligence/stats'

beforeEach(() => {
  s.sql = []
  s.audit = 12
  s.clients = 7
  s.ai = { total: 5, awaiting_review: 3 }
  s.ping = true
  s.missingEnv = []
  s.legacyClientCount = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('getIntelligenceStats', () => {
  it('counts real rows from the current product tables', async () => {
    const st = await getIntelligenceStats()
    expect(st.auditEvents).toEqual({ ok: true, value: 12 })
    expect(st.clients).toEqual({ ok: true, value: 7 })
    expect(st.aiInsights).toEqual({ ok: true, value: { total: 5, awaitingReview: 3 } })
    expect(s.legacyClientCount).toBe(0)

    const clientsSql = s.sql.find((q) => q.includes('FROM public.profiles'))
    expect(clientsSql).toContain("role = 'client'")
    const aiSql = s.sql.find((q) => q.includes('FROM public.diagnostic_findings'))
    expect(aiSql).toContain("provenance_type = 'AI_HYPOTHESIS'")
    expect(aiSql).toContain("status = 'active'")
    expect(aiSql).toContain('reviewed_at IS NULL')
  })

  it('zero AI hypotheses is a real 0, distinct from a failed read', async () => {
    s.ai = { total: 0, awaiting_review: 0 }
    expect((await getIntelligenceStats()).aiInsights).toEqual({ ok: true, value: { total: 0, awaitingReview: 0 } })
    s.ai = new Error('relation "public.diagnostic_findings" does not exist')
    expect((await getIntelligenceStats()).aiInsights).toEqual({ ok: false })
  })

  it('each tile fails on its own', async () => {
    s.audit = new Error('db down')
    s.clients = new Error('db down')
    const st = await getIntelligenceStats()
    expect(st.auditEvents).toEqual({ ok: false })
    expect(st.clients).toEqual({ ok: false })
    expect(st.aiInsights.ok).toBe(true)
  })

  it('system status comes from the health checks, not a constant', async () => {
    let st = await getIntelligenceStats()
    expect(st.health.db.status).toBe('online')
    expect(st.health.missingEnv).toBe(0)
    expect(st.health.allOnline).toBe(true)

    s.ping = false
    st = await getIntelligenceStats()
    expect(st.health.db.status).toBe('offline')
    expect(st.health.allOnline).toBe(false)

    s.ping = true
    s.missingEnv = ['SUPABASE_SERVICE_ROLE_KEY']
    st = await getIntelligenceStats()
    expect(st.health.missingEnv).toBe(1)
    expect(st.health.allOnline).toBe(false)
  })

  it('database latency bands match /api/health', () => {
    expect(dbStatusFor(true, 20)).toBe('online')
    expect(dbStatusFor(true, 149)).toBe('online')
    expect(dbStatusFor(true, 150)).toBe('degraded')
    expect(dbStatusFor(true, 399)).toBe('degraded')
    expect(dbStatusFor(true, 400)).toBe('offline')
    expect(dbStatusFor(false, 5)).toBe('offline')
  })
})
