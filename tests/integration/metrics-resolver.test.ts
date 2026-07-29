// ============================================================
// tests/integration/metrics-resolver.test.ts
// Round-trip integration test for the Phase 1 metrics resolver:
//   profile + company + survey_answers  →
//     gatherResolverContext  →
//       resolveAllMetrics  →
//         materializeAll  →
//           SELECT FROM public.metrics
//
// Runs against the real Supabase instance using the service role
// key (RLS bypass) so we can both seed fixtures and clean up.
// If `SUPABASE_SERVICE_ROLE_KEY` is missing the suite is skipped
// rather than failing — that keeps CI/local-without-creds green.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  supabaseTestsEnabled,
  TEST_SUPABASE_SERVICE_ROLE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/supabase-env'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  gatherResolverContext,
  materializeAll,
} from '@/lib/metrics/materialize'
import { resolveAllMetrics } from '@/lib/metrics/resolver'

// ─── Env loading ─────────────────────────────────────────────
// `tests/helpers/setup.ts` only loads `.env`. The service role
// lives in `.env.local`, so we read it ourselves (no dep added).
function loadEnvFile(file: string) {
  if (!existsSync(file)) return
  const content = readFileSync(file, 'utf8')
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val
  }
}

loadEnvFile(resolve(__dirname, '../../.env.local'))
loadEnvFile(resolve(__dirname, '../../.env'))

// Disposable project only — never the production Supabase from .env.
// See tests/helpers/supabase-env.ts.
const SUPABASE_URL = TEST_SUPABASE_URL
const SERVICE_ROLE_KEY = TEST_SUPABASE_SERVICE_ROLE_KEY
const SKIP = !supabaseTestsEnabled

// Allowed source values in `public.metrics` (per migration 016).
const ALLOWED_SOURCES = new Set([
  'survey',
  'document',
  'manual',
  'calculated',
  'resolver',
  'external',
  'prisma',
])

// describe.skipIf was added in Vitest 1.x; fall back to a plain
// describe-conditional if it's somehow not present.
const describeOrSkip =
  typeof (describe as unknown as { skipIf?: unknown }).skipIf === 'function'
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (describe as any).skipIf(SKIP)
    : SKIP
      ? describe.skip
      : describe

describeOrSkip('metrics resolver integration (real Supabase)', () => {
  let supabase: SupabaseClient
  let userId: string // auth.users.id ↔ profiles.id
  let userEmail: string
  let companyId: string
  let companyName: string
  let insertedSurveyKeys: string[] = []

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── 1. Create an auth user (profile row is auto-inserted by trigger).
    const tag = randomUUID()
    userEmail = `resolver-test-${tag}@aistart360.test`
    const created = await supabase.auth.admin.createUser({
      email: userEmail,
      password: `Pw_${tag}`,
      email_confirm: true,
      user_metadata: { full_name: `RESOLVER_TEST_${tag}` },
    })
    if (created.error || !created.data.user) {
      throw new Error(
        `auth.admin.createUser failed: ${created.error?.message ?? 'no user'}`,
      )
    }
    userId = created.data.user.id

    // The on_auth_user_created trigger should have inserted a profile.
    // Wait briefly for it; if it didn't fire (e.g. local env without the
    // trigger), insert one explicitly so the FK chain holds.
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle()
    if (!existingProfile) {
      const { error: profileErr } = await supabase.from('profiles').insert({
        id: userId,
        email: userEmail,
        full_name: `RESOLVER_TEST_${tag}`,
        role: 'client',
        status: 'approved',
      })
      if (profileErr) throw new Error(`profile insert: ${profileErr.message}`)
    }

    // ── 2. Create a company tagged with RESOLVER_TEST_ for easy cleanup.
    companyName = `RESOLVER_TEST_${tag}`
    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .insert({
        user_id: userId,
        name: companyName,
        industry: 'integration-test',
        business_model: 'B2B',
      })
      .select('id')
      .single()
    if (companyErr || !company) {
      throw new Error(`company insert: ${companyErr?.message ?? 'no row'}`)
    }
    companyId = company.id as string

    // ── 3. Seed survey_answers covering several finance metrics.
    // Keys chosen from lib/metrics/descriptions.ts so they map to
    // real `biz.*` metric ids the registry knows about.
    const surveyRows = [
      { user_id: userId, company_id: companyId, step: 2, question_key: 's2_revenue_2025',  answer: { value: 84200000 } },
      { user_id: userId, company_id: companyId, step: 9, question_key: 's9n_revenue_2024', answer: { value: 70000000 } },
      { user_id: userId, company_id: companyId, step: 2, question_key: 's2_gross_margin',  answer: { value: 32 } },
      { user_id: userId, company_id: companyId, step: 9, question_key: 's9n_net_profit',   answer: { value: 12500000 } },
      { user_id: userId, company_id: companyId, step: 9, question_key: 's9n_expense_cogs', answer: { value: 48000000 } },
    ]
    insertedSurveyKeys = surveyRows.map((r) => r.question_key)
    const { error: surveyErr } = await supabase
      .from('survey_answers')
      .insert(surveyRows)
    if (surveyErr) throw new Error(`survey insert: ${surveyErr.message}`)
  }, 30_000)

  afterAll(async () => {
    if (!supabase) return
    // Order matters: metrics → survey_answers → companies → profile → auth user.
    if (companyId) {
      await supabase.from('metrics').delete().eq('company_id', companyId)
    }
    if (userId) {
      await supabase
        .from('survey_answers')
        .delete()
        .eq('user_id', userId)
        .in('question_key', insertedSurveyKeys)
    }
    if (companyId) {
      await supabase.from('companies').delete().eq('id', companyId)
    }
    if (userId) {
      // Profile is FK-cascaded from auth.users, but delete explicitly to
      // cover the local-insert path above.
      await supabase.from('profiles').delete().eq('id', userId)
      await supabase.auth.admin.deleteUser(userId)
    }
  }, 30_000)

  // ─── 1. gatherResolverContext ──────────────────────────────
  it('gathers resolver context with survey answers populated', async () => {
    const ctx = await gatherResolverContext(supabase, {
      userId,
      companyId,
    })
    expect(ctx.companyId).toBe(companyId)
    expect(ctx.userId).toBe(userId)
    expect(ctx.surveyAnswers['s2_revenue_2025']).toBe(84200000)
    expect(ctx.surveyAnswers['s9n_revenue_2024']).toBe(70000000)
    expect(ctx.surveyAnswers['s2_gross_margin']).toBe(32)
    // Documents may be empty — that's fine, this user uploaded none.
    expect(Array.isArray(ctx.documents)).toBe(true)
  })

  // ─── 2. resolveAllMetrics ──────────────────────────────────
  it('resolves at least 3 metrics from the seeded survey answers', async () => {
    const ctx = await gatherResolverContext(supabase, { userId, companyId })
    const values = resolveAllMetrics(ctx)
    const picked = values.filter((v) => v.picked !== null)
    expect(picked.length).toBeGreaterThanOrEqual(3)
    // Every picked source must be one the survey adapter would emit.
    for (const v of picked) {
      expect(v.confidence).toBeGreaterThan(0)
      expect(v.confidence).toBeLessThanOrEqual(1)
    }
  })

  // ─── 3. materializeAll round trip ──────────────────────────
  it('materializes resolved metrics to public.metrics with valid shape', async () => {
    const ctx = await gatherResolverContext(supabase, { userId, companyId })
    const { result } = await materializeAll(supabase, ctx)
    expect(result.errors).toEqual([])
    expect(result.written).toBeGreaterThanOrEqual(3)

    const { data: rows, error } = await supabase
      .from('metrics')
      .select(
        'metric_key, metric_value, metric_unit, source, confidence, provenance, period_year, period_quarter, computed_at',
      )
      .eq('company_id', companyId)
    expect(error).toBeNull()
    expect(rows && rows.length).toBeGreaterThanOrEqual(3)

    for (const row of rows ?? []) {
      // Source must be in the migration-016 allowed set.
      expect(ALLOWED_SOURCES.has(row.source as string)).toBe(true)
      // Confidence is DECIMAL(3,2) and bounded.
      const conf = Number(row.confidence)
      expect(conf).toBeGreaterThanOrEqual(0)
      expect(conf).toBeLessThanOrEqual(1)
      // Numeric value should be finite.
      const value = Number(row.metric_value)
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  // ─── 4. Provenance shape ───────────────────────────────────
  it('records provenance with picked / considered / raw_value keys', async () => {
    const { data: rows, error } = await supabase
      .from('metrics')
      .select('metric_key, provenance')
      .eq('company_id', companyId)
      .limit(5)
    expect(error).toBeNull()
    expect(rows && rows.length).toBeGreaterThan(0)
    for (const row of rows ?? []) {
      const prov = row.provenance as Record<string, unknown> | null
      expect(prov).not.toBeNull()
      expect(prov).toHaveProperty('picked')
      expect(prov).toHaveProperty('considered')
      expect(prov).toHaveProperty('raw_value')
      expect(Array.isArray((prov as { considered: unknown }).considered)).toBe(
        true,
      )
    }
  })

  // ─── 5. Idempotency ────────────────────────────────────────
  // The unique index is `(company_id, metric_key, period_year,
  // period_quarter, source)`. In Postgres, NULL ≠ NULL for unique
  // indexes by default, so rows with null period would each insert
  // fresh on every run. We therefore exercise the realistic path
  // where the caller pins a period — that's the only case the
  // upsert can actually de-duplicate, and the one production uses.
  it('is idempotent — running materializeAll twice with a pinned period does not duplicate rows', async () => {
    const ctx = await gatherResolverContext(supabase, {
      userId,
      companyId,
      preferPeriodYear: 2025,
      preferPeriodQuarter: 'Q4',
    })

    // First materialize with the pinned period (clean slate for this period).
    await supabase
      .from('metrics')
      .delete()
      .eq('company_id', companyId)
      .eq('period_year', 2025)
      .eq('period_quarter', 'Q4')

    const first = await materializeAll(supabase, ctx)
    expect(first.result.errors).toEqual([])
    expect(first.result.written).toBeGreaterThanOrEqual(3)

    const { count: countAfterFirst, error: countErr1 } = await supabase
      .from('metrics')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('period_year', 2025)
      .eq('period_quarter', 'Q4')
    expect(countErr1).toBeNull()
    expect(countAfterFirst).toBeGreaterThanOrEqual(3)

    // Re-run; the upsert should match the unique index and update in place.
    const second = await materializeAll(supabase, ctx)
    expect(second.result.errors).toEqual([])

    const { count: countAfterSecond, error: countErr2 } = await supabase
      .from('metrics')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('period_year', 2025)
      .eq('period_quarter', 'Q4')
    expect(countErr2).toBeNull()
    expect(countAfterSecond).toBe(countAfterFirst)
  })
})
