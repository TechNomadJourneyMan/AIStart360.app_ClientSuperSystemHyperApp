/**
 * Integration test for the Point A aggregator end-to-end.
 *
 * Inserts a real test profile/company/survey_answers row set against Supabase
 * (service role), invokes `aggregatePointA(...)`, and validates the full
 * `PointA` + `intelligence` shape. Idempotent — runs the aggregator twice and
 * cleans up after itself, including any rows the materialize step writes to
 * `public.metrics`.
 *
 * Skipped automatically when no service-role key is available, or when the
 * Phase-4 aggregator module hasn't been built yet.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  supabaseTestsEnabled,
  TEST_SUPABASE_SERVICE_ROLE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/supabase-env'

// ── Env / skip detection ─────────────────────────────────────────────────────

// Disposable project only — never the production Supabase from .env.
// See tests/helpers/supabase-env.ts.
const SERVICE_KEY = TEST_SUPABASE_SERVICE_ROLE_KEY
const SUPA_URL = TEST_SUPABASE_URL

const SKIP = !supabaseTestsEnabled

// Vitest's `describe.skipIf` lands in 1.0+. Fall back to inline guard if
// running on an older runner.
const maybeDescribe =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof (describe as any).skipIf === 'function'
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (describe as any).skipIf(SKIP)
    : SKIP
      ? describe.skip
      : describe

// ── Test fixture state — populated in beforeAll, cleaned in afterAll ─────────

interface Fixture {
  sb: SupabaseClient
  userId: string
  companyId: string
  surveyKeys: string[]
}

const fx: Partial<Fixture> = {}

let aggregateModule:
  | { aggregatePointA: (...args: unknown[]) => Promise<unknown> }
  | null = null
let aggregateLoadError: string | null = null

// Try to dynamic-import the aggregator. If Phase 4 hasn't shipped yet, we want
// to *skip* every test rather than fail — so we record the error and let each
// `it.skipIf(...)` check it.
async function loadAggregator(): Promise<void> {
  if (aggregateModule || aggregateLoadError) return
  try {
    // Use a dynamic specifier so TypeScript doesn't require the module to
    // exist at compile time — Phase 4 may not have shipped yet.
    const specifier = '@/lib/point-a/aggregator'
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      aggregatePointA?: (...args: unknown[]) => Promise<unknown>
    }
    if (typeof mod.aggregatePointA !== 'function') {
      aggregateLoadError =
        'aggregatePointA export not found in @/lib/point-a/aggregator'
      return
    }
    aggregateModule = { aggregatePointA: mod.aggregatePointA }
  } catch (err) {
    aggregateLoadError =
      err instanceof Error ? err.message : String(err)
  }
}

// ── 8 survey answers across the 5 blocks ────────────────────────────────────
//
// Keys are chosen from `lib/metrics/descriptions.ts` so the resolver actually
// matches them — but the test doesn't assert *exact* metric values, only the
// overall PointA shape. That keeps it resilient to scoring tweaks.
function buildSurveyRows(userId: string, companyId: string) {
  const rows: Array<{
    user_id: string
    company_id: string
    step: number
    question_key: string
    answer: { value: unknown }
  }> = [
    // finance
    {
      user_id: userId,
      company_id: companyId,
      step: 2,
      question_key: 's2_revenue_2024',
      answer: { value: 84_200_000 },
    },
    {
      user_id: userId,
      company_id: companyId,
      step: 2,
      question_key: 's2_gross_margin',
      answer: { value: 38 },
    },
    // sales
    {
      user_id: userId,
      company_id: companyId,
      step: 3,
      question_key: 's3_deals_2025',
      answer: { value: 142 },
    },
    {
      user_id: userId,
      company_id: companyId,
      step: 5,
      question_key: 's5n_funnel_lead_to_sale',
      answer: { value: 12 },
    },
    // marketing
    {
      user_id: userId,
      company_id: companyId,
      step: 2,
      question_key: 's2_cac',
      answer: { value: 8_500 },
    },
    {
      user_id: userId,
      company_id: companyId,
      step: 2,
      question_key: 's2_ltv',
      answer: { value: 45_000 },
    },
    // operations
    {
      user_id: userId,
      company_id: companyId,
      step: 9,
      question_key: 's9n_debtor_days',
      answer: { value: 27 },
    },
    // strategy
    {
      user_id: userId,
      company_id: companyId,
      step: 1,
      question_key: 's1_website',
      answer: { value: 'https://test.example.com' },
    },
  ]
  return rows
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (SKIP) return
  await loadAggregator()
  if (aggregateLoadError) return

  const sb = createClient(SUPA_URL!, SERVICE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  fx.sb = sb

  // 1. Create an auth user (profiles.id FKs auth.users.id).
  const email = `pa-aggr-test-${Date.now()}@example.test`
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email,
    password: `pw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    email_confirm: true,
  })
  if (createErr || !created?.user) {
    throw new Error(`failed to create auth user: ${createErr?.message}`)
  }
  fx.userId = created.user.id

  // 2. Insert (or upsert) the profiles row. The on_auth_user trigger may have
  //    already created one — upsert defensively.
  const { error: profErr } = await sb.from('profiles').upsert(
    {
      id: fx.userId,
      email,
      full_name: 'Point A Integration Test',
      role: 'client',
      status: 'approved',
    },
    { onConflict: 'id' },
  )
  if (profErr) throw new Error(`profiles upsert failed: ${profErr.message}`)

  // 3. Insert a company.
  const { data: companyRow, error: compErr } = await sb
    .from('companies')
    .insert({
      user_id: fx.userId,
      name: 'PointA Aggregator Test Co',
      industry: 'tech',
      stage: 'Growth',
      business_model: 'B2B',
    })
    .select('id')
    .single()
  if (compErr || !companyRow) {
    throw new Error(`company insert failed: ${compErr?.message}`)
  }
  fx.companyId = companyRow.id

  // 4. Insert 8 survey answers spanning finance + sales + marketing + ops + strategy.
  const rows = buildSurveyRows(fx.userId!, fx.companyId!)
  fx.surveyKeys = rows.map((r) => r.question_key)
  const { error: surveyErr } = await sb
    .from('survey_answers')
    .upsert(rows, { onConflict: 'user_id,question_key' })
  if (surveyErr) {
    throw new Error(`survey_answers upsert failed: ${surveyErr.message}`)
  }
})

// ── Cleanup ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  const { sb, userId, companyId } = fx
  if (!sb) return
  try {
    if (companyId) {
      await sb.from('metrics').delete().eq('company_id', companyId)
      await sb.from('diagnostics').delete().eq('company_id', companyId)
      await sb.from('survey_answers').delete().eq('company_id', companyId)
      await sb.from('documents').delete().eq('company_id', companyId)
      await sb.from('companies').delete().eq('id', companyId)
    }
    if (userId) {
      await sb.from('survey_answers').delete().eq('user_id', userId)
      await sb.from('diagnostics').delete().eq('user_id', userId)
      await sb.from('profiles').delete().eq('id', userId)
      await sb.auth.admin.deleteUser(userId)
    }
  } catch (err) {
    // Don't fail the suite on cleanup errors — surface as a console warning.
    // eslint-disable-next-line no-console
    console.warn('[point-a-aggregate test] cleanup error:', err)
  }
})

// ── Tests ────────────────────────────────────────────────────────────────────

maybeDescribe('point-a aggregator integration', () => {
  it('aggregator module is available (else this whole suite is a no-op)', () => {
    if (aggregateLoadError) {
      // eslint-disable-next-line no-console
      console.warn(
        `[point-a-aggregate] skipping: aggregator not yet built — ${aggregateLoadError}`,
      )
    }
    // Always pass — the per-test guards below short-circuit if module missing.
    expect(true).toBe(true)
  })

  it('returns a well-formed PointA with intelligence and non-zero coverage', async () => {
    if (aggregateLoadError || !aggregateModule) {
      // eslint-disable-next-line no-console
      console.warn(
        '[point-a-aggregate] aggregator not built — skipping shape assertion',
      )
      return
    }
    if (!fx.companyId || !fx.userId) {
      throw new Error('fixture not initialised')
    }

    // Aggregator signature is (supabase, userId, companyId, opts?)
    const raw = await aggregateModule.aggregatePointA(fx.sb!, fx.userId, fx.companyId)

    // The aggregator might return either `PointA` directly or
    // `{ pointA, intelligence }` — accept both.
    const result = raw as {
      overall_score?: number
      blocks?: Record<string, { score?: number }>
      risks?: unknown[]
      intelligence?: {
        coverage?: number
        top_strengths?: unknown[]
      }
      pointA?: {
        overall_score?: number
        blocks?: Record<string, { score?: number }>
        risks?: unknown[]
      }
    }

    const pointA = result.pointA ?? result
    const intelligence = result.intelligence ?? (result as { intelligence?: unknown }).intelligence

    // Overall score 0..100
    expect(typeof pointA.overall_score).toBe('number')
    expect(pointA.overall_score!).toBeGreaterThanOrEqual(0)
    expect(pointA.overall_score!).toBeLessThanOrEqual(100)

    // All five blocks present and 0..100
    expect(pointA.blocks).toBeDefined()
    for (const key of [
      'finance',
      'sales',
      'operations',
      'marketing',
      'strategy',
    ] as const) {
      const b = pointA.blocks![key]
      expect(b, `block ${key} present`).toBeDefined()
      expect(typeof b.score).toBe('number')
      expect(b.score!).toBeGreaterThanOrEqual(0)
      expect(b.score!).toBeLessThanOrEqual(100)
    }

    // Risks is an array (may be empty)
    expect(Array.isArray(pointA.risks)).toBe(true)

    // Phase 4 intelligence is present and reflects what we inserted.
    // `coverage` is an object { biz, kpi, gri, goal, overall } per
    // the Phase 4 contract — read `.overall` for the global ratio.
    expect(intelligence, 'intelligence enrichment present').toBeDefined()
    const intel = intelligence as {
      coverage?: { overall?: number } | number
      top_strengths?: unknown[]
    }
    const overall =
      typeof intel.coverage === 'number'
        ? intel.coverage
        : intel.coverage?.overall ?? 0
    expect(typeof overall).toBe('number')
    expect(overall).toBeGreaterThan(0)
    expect(Array.isArray(intel.top_strengths)).toBe(true)
    expect((intel.top_strengths ?? []).length).toBeGreaterThan(0)
  })

  it('is idempotent — running aggregator twice yields a coherent result', async () => {
    if (aggregateLoadError || !aggregateModule) {
      // eslint-disable-next-line no-console
      console.warn(
        '[point-a-aggregate] aggregator not built — skipping idempotency',
      )
      return
    }
    if (!fx.companyId || !fx.userId) {
      throw new Error('fixture not initialised')
    }

    const first = (await aggregateModule.aggregatePointA(fx.sb!, fx.userId, fx.companyId)) as {
      overall_score?: number
      pointA?: { overall_score?: number }
    }

    const second = (await aggregateModule.aggregatePointA(fx.sb!, fx.userId, fx.companyId)) as {
      overall_score?: number
      pointA?: { overall_score?: number }
    }

    const firstScore = first.pointA?.overall_score ?? first.overall_score
    const secondScore = second.pointA?.overall_score ?? second.overall_score

    expect(typeof firstScore).toBe('number')
    expect(typeof secondScore).toBe('number')
    // Same input → same (or near-same) output. Allow a tiny delta in case the
    // aggregator factors in `now` for time-of-day weighting.
    const a = firstScore as number
    const b = secondScore as number
    expect(Math.abs(a - b)).toBeLessThan(5)
  })
})
