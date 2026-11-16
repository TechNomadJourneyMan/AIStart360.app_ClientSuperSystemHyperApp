/**
 * Ревью R3-PA H1 / M1 / L1 — lib/point-a/ai-claim.ts and the status write:
 *   • «готовится» older than 15 min is stale (a lost call) — a failure the
 *     client can retry; the sweep turns such rows failed / 'stale';
 *   • a start is ONE compare-and-swap claim: two parallel «Повторить» → one
 *     paid analysis; refused while in progress, after a complete one (unless
 *     staff regenerate), within the cooldown after the last start;
 *   • any failure of the diagnosis columns still writes the status.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AI_RETRY_COOLDOWN_MS, AI_STALE_AFTER_MS, claimAiAnalysis, claimDecision, claimRefusalText, failStaleAiAnalyses, isAiStale,
} from '@/lib/point-a/ai-claim'
import { updateDiagnosticAi } from '@/lib/point-a/ai-columns'

const NOW = Date.parse('2026-11-15T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

type Row = Record<string, unknown>

/** A diagnostics table that applies eq / is filters to update + select, like PostgREST (one statement = atomic). */
function table(rows: Row[], opts: { pre150?: boolean; failUpdate?: (payload: Row) => { code: string } | null } = {}) {
  const writes: Row[] = []
  const client = {
    from: () => {
      let op: 'select' | 'update' = 'select'
      let payload: Row = {}
      let cols = ''
      const filters: Array<(r: Row) => boolean> = []
      const orFilters: string[] = []
      const run = async (single: boolean) => {
        if (opts.pre150 && (cols.includes('ai_started_at') || 'ai_started_at' in payload || 'ai_error' in payload || orFilters.some((f) => f.includes('ai_started_at')))) {
          return { data: null, error: { code: '42703' } }
        }
        if (op === 'update') {
          const err = opts.failUpdate?.(payload)
          if (err) return { data: null, error: err }
          const hit = rows.filter((r) => filters.every((f) => f(r)))
          for (const r of hit) Object.assign(r, payload)
          writes.push(payload)
          return { data: hit.map((r) => ({ id: r.id })), error: null }
        }
        const hit = rows.filter((r) => filters.every((f) => f(r)))
        return single ? { data: hit[0] ? { ...hit[0] } : null, error: null } : { data: hit, error: null }
      }
      const b: Record<string, unknown> = {
        select: (c?: string) => { if (op === 'select') cols = c ?? ''; return b },
        update: (p: Row) => { op = 'update'; payload = p; return b },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
        is: (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b },
        lt: (c: string, v: string) => { filters.push((r) => typeof r[c] === 'string' && (r[c] as string) < v); return b },
        or: (expr: string) => {
          orFilters.push(expr)
          // ai_started_at.lt.X,and(ai_started_at.is.null,calculated_at.lt.X)
          const cutoff = expr.split('ai_started_at.lt.')[1].split(',')[0]
          filters.push((r) => (typeof r.ai_started_at === 'string' ? r.ai_started_at < cutoff : r.ai_started_at == null && typeof r.calculated_at === 'string' && (r.calculated_at as string) < cutoff))
          return b
        },
        maybeSingle: () => run(true),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run(false).then(res, rej),
      }
      return b
    },
  }
  return { sb: client as unknown as SupabaseClient, writes }
}

const T = { diagnosticId: 'd-1', userId: 'u-1' }

describe('stale «готовится» (H1)', () => {
  it('processing longer than 15 min (by ai_started_at, else calculated_at) is stale; other statuses never', () => {
    expect(isAiStale({ ai_status: 'processing', ai_started_at: ago(AI_STALE_AFTER_MS + 1000) }, NOW)).toBe(true)
    expect(isAiStale({ ai_status: 'processing', ai_started_at: ago(60_000) }, NOW)).toBe(false)
    expect(isAiStale({ ai_status: 'processing', ai_started_at: null, calculated_at: ago(20 * 60_000) }, NOW)).toBe(true)
    expect(isAiStale({ ai_status: 'failed', ai_started_at: ago(60 * 60_000) }, NOW)).toBe(false)
    expect(isAiStale({ ai_status: 'processing' }, NOW)).toBe(false) // no time — never invented
  })

  it('the sweep turns stale rows failed / «stale» — only those; one row when asked; before 150 by the row age', async () => {
    const rows = [
      { id: 'a', ai_status: 'processing', ai_started_at: ago(20 * 60_000), calculated_at: ago(30 * 60_000) },
      { id: 'b', ai_status: 'processing', ai_started_at: ago(60_000), calculated_at: ago(30 * 60_000) },
      { id: 'c', ai_status: 'processing', ai_started_at: null, calculated_at: ago(40 * 60_000) },
      { id: 'd', ai_status: 'completed', ai_started_at: ago(60 * 60_000) },
    ]
    const t = table(rows)
    expect(await failStaleAiAnalyses(t.sb, { now: new Date(NOW) })).toBe(2)
    expect(rows.map((r) => [r.id, r.ai_status, (r as Row).ai_error ?? null])).toEqual([
      ['a', 'failed', 'stale'], ['b', 'processing', null], ['c', 'failed', 'stale'], ['d', 'completed', null],
    ])
    const one = table([{ id: 'x', ai_status: 'processing', ai_started_at: ago(20 * 60_000) }, { id: 'y', ai_status: 'processing', ai_started_at: ago(20 * 60_000) }])
    expect(await failStaleAiAnalyses(one.sb, { diagnosticId: 'y', now: new Date(NOW) })).toBe(1)
    const pre = [{ id: 'p', ai_status: 'processing', calculated_at: ago(20 * 60_000) }]
    expect(await failStaleAiAnalyses(table(pre, { pre150: true }).sb, { now: new Date(NOW) })).toBe(1)
    expect(pre[0]).toMatchObject({ ai_status: 'failed' })
    expect(pre[0]).not.toHaveProperty('ai_error')
  })
})

describe('the claim (M1)', () => {
  it('decision: in progress / complete / cooldown refused; failed, none and stale claimable; staff may regenerate', () => {
    expect(claimDecision({ ai_status: 'processing', ai_started_at: ago(60_000) }, { now: NOW })).toEqual({ claim: false, reason: 'processing' })
    expect(claimDecision({ ai_status: 'processing', ai_started_at: ago(20 * 60_000) }, { now: NOW })).toEqual({ claim: true })
    expect(claimDecision({ ai_status: 'completed' }, { now: NOW })).toEqual({ claim: false, reason: 'completed' })
    expect(claimDecision({ ai_status: 'completed', ai_started_at: ago(60 * 60_000) }, { now: NOW, allowCompleted: true })).toEqual({ claim: true })
    expect(claimDecision({ ai_status: 'failed', ai_started_at: ago(60_000) }, { now: NOW })).toEqual({ claim: false, reason: 'cooldown', retryInMs: AI_RETRY_COOLDOWN_MS - 60_000 })
    expect(claimDecision({ ai_status: 'failed', ai_started_at: ago(AI_RETRY_COOLDOWN_MS + 1) }, { now: NOW })).toEqual({ claim: true })
    expect(claimDecision({ ai_status: 'none' }, { now: NOW })).toEqual({ claim: true })
    expect(claimDecision(null)).toEqual({ claim: false, reason: 'not_found' })
  })

  it('five parallel claims of one failed row → exactly ONE wins (one paid analysis)', async () => {
    const rows = [{ id: 'd-1', user_id: 'u-1', ai_status: 'failed', ai_started_at: ago(10 * 60_000) }]
    const t = table(rows)
    const results = await Promise.all(Array.from({ length: 5 }, () => claimAiAnalysis(t.sb, T, { now: new Date(NOW) })))
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'processing')).toBe(true)
    expect(rows[0]).toMatchObject({ ai_status: 'processing', ai_started_at: new Date(NOW).toISOString() })
  })

  it('a stale row is claimed once; before migration 150 the status alone is compared', async () => {
    const rows = [{ id: 'd-1', user_id: 'u-1', ai_status: 'processing', ai_started_at: ago(20 * 60_000) }]
    expect(await claimAiAnalysis(table(rows).sb, T, { now: new Date(NOW) })).toEqual({ ok: true })
    const pre = [{ id: 'd-1', user_id: 'u-1', ai_status: 'failed', calculated_at: ago(60 * 60_000) }]
    expect(await claimAiAnalysis(table(pre, { pre150: true }).sb, T, { now: new Date(NOW) })).toEqual({ ok: true })
    expect(pre[0]).toMatchObject({ ai_status: 'processing' })
    expect(pre[0]).not.toHaveProperty('ai_started_at')
  })

  it('the client is told why: 409 in progress / complete, 429 cooldown with minutes', () => {
    expect(claimRefusalText({ reason: 'processing' })).toMatchObject({ status: 409 })
    expect(claimRefusalText({ reason: 'completed' })).toMatchObject({ status: 409, error: expect.stringContaining('уже готов') })
    expect(claimRefusalText({ reason: 'cooldown', retryInMs: 61_000 })).toEqual({ status: 429, error: 'Разбор только что запускался — повторить можно через 2 мин' })
  })
})

describe('the status survives a failed diagnosis write (L1)', () => {
  it('a hand-made VARCHAR(50) ai_error (22001) → the status is still written', async () => {
    const rows = [{ id: 'd-1', user_id: 'u-1', ai_status: 'processing' }]
    const t = table(rows, { failUpdate: (p) => ('ai_error' in p ? { code: '22001' } : null) })
    const r = await updateDiagnosticAi(t.sb, T, { ai_status: 'failed' }, { ai_error: 'summary:schema; blocksA:http_502; blocksB:cut — длинный список' })
    expect(r).toEqual({ ok: true, withDiagnosis: false })
    expect(rows[0].ai_status).toBe('failed')
  })
})
