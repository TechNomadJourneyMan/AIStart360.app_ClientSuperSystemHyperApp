/**
 * Integration tests for the document pipeline.
 *
 * These tests hit the REAL Supabase database using credentials from
 * `.env.local` / `.env` (loaded by `tests/helpers/setup.ts`). They use a
 * unique `INTEGRATION_TEST_<uuid>` prefix on `companies.name` so that
 * orphaned rows (if any) can be identified and purged by an admin.
 *
 * If the required env vars are absent (e.g. on CI without secrets) the
 * entire suite is skipped — never failed — so it remains CI-safe.
 *
 * The service-role client is used to bypass RLS for setup/teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { config } from 'dotenv'
import { resolve } from 'path'
import { randomUUID } from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Load .env.local first (preferred), then fall back to .env. dotenv won't
// overwrite already-set vars, so the order matters.
config({ path: resolve(__dirname, '../../.env.local') })
config({ path: resolve(__dirname, '../../.env') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SKIP = !SUPABASE_URL || !SERVICE_ROLE_KEY

// Stable run identifier so all rows created in this test process share a prefix
const RUN_ID = randomUUID()
const TEST_PREFIX = `INTEGRATION_TEST_${RUN_ID}`

// Track every row we insert so afterAll can clean them up regardless of which
// `it()` blocks ran or failed.
type CreatedRows = {
  userIds: string[]
  companyIds: string[]
  documentIds: string[]
  metricIds: string[]
}
const created: CreatedRows = {
  userIds: [],
  companyIds: [],
  documentIds: [],
  metricIds: [],
}

let supabase: SupabaseClient

// vitest's `describe.skipIf` short-circuits the whole suite on CI/dev
// environments without Supabase credentials. The `(SKIP as boolean)` cast is
// only there to satisfy strict TS — `SKIP` is already boolean at runtime.
describe.skipIf(SKIP as boolean)('documents-pipeline integration', () => {
  beforeAll(() => {
    supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  })

  afterAll(async () => {
    if (!supabase) return
    // Order matters: documents/metrics → companies → profiles → auth users
    if (created.documentIds.length) {
      await supabase.from('documents').delete().in('id', created.documentIds)
    }
    if (created.metricIds.length) {
      await supabase.from('metrics').delete().in('id', created.metricIds)
    }
    if (created.companyIds.length) {
      await supabase.from('companies').delete().in('id', created.companyIds)
    }
    if (created.userIds.length) {
      // Removing the auth user cascades to `profiles` via FK ON DELETE CASCADE.
      for (const uid of created.userIds) {
        await supabase.auth.admin.deleteUser(uid).catch(() => {
          /* best-effort cleanup */
        })
      }
    }
  }, 30_000)

  /**
   * Helper: create a fresh auth user + profile + company for one test.
   * Each test gets its own isolated set so tests don't depend on each other.
   */
  async function makeCompany(label: string): Promise<{ userId: string; companyId: string }> {
    const email = `integration+${randomUUID()}@aistart360.test`
    const { data: userData, error: userErr } = await supabase.auth.admin.createUser({
      email,
      password: randomUUID() + 'Aa1!',
      email_confirm: true,
      user_metadata: { test_run: RUN_ID, label },
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    const userId = userData.user.id
    created.userIds.push(userId)

    // The `handle_new_user` trigger normally creates the profile row, but to be
    // robust against trigger drift we upsert explicitly.
    const { error: profileErr } = await supabase
      .from('profiles')
      .upsert(
        { id: userId, email, full_name: `${TEST_PREFIX} ${label}`, role: 'client' },
        { onConflict: 'id' },
      )
    if (profileErr) throw profileErr

    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .insert({
        user_id: userId,
        name: `${TEST_PREFIX} :: ${label}`,
        industry: 'Test',
      })
      .select('id')
      .single()
    if (companyErr || !company) throw companyErr ?? new Error('company insert failed')
    created.companyIds.push(company.id)

    return { userId, companyId: company.id }
  }

  it('connects to Supabase and verifies documents schema has parsed_data, parse_status, doc_type', async () => {
    // Selecting zero rows but with the desired column projection is the
    // cheapest way to assert the columns exist — PostgREST will 400 if a
    // requested column is missing.
    const { data, error } = await supabase
      .from('documents')
      .select('id, parsed_data, parse_status, doc_type')
      .limit(1)

    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it("accepts source='resolver' on metrics (migration 016 CHECK constraint)", async () => {
    const { companyId } = await makeCompany('metrics-source-check')

    const { data, error } = await supabase
      .from('metrics')
      .insert({
        company_id: companyId,
        metric_key: `${TEST_PREFIX}_key`,
        metric_value: 1.23,
        metric_unit: 'count',
        period_year: 2026,
        period_quarter: 'Q1',
        source: 'resolver',
      })
      .select('id, source')
      .single()

    expect(error).toBeNull()
    expect(data?.source).toBe('resolver')
    if (data?.id) created.metricIds.push(data.id)
  })

  it('round-trips parsed_data JSONB with a metric_id preserved through serialization', async () => {
    const { userId, companyId } = await makeCompany('jsonb-roundtrip')

    const metricId = randomUUID()
    const parsedData = {
      revenue: 84_000_000,
      gross_margin: 34.2,
      metric_id: metricId,
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('documents')
      .insert({
        user_id: userId,
        company_id: companyId,
        file_name: `${TEST_PREFIX}.pdf`,
        file_url: `https://example.test/${RUN_ID}.pdf`,
        file_size: 1024,
        mime_type: 'application/pdf',
        doc_type: 'pl_report',
        parse_status: 'parsed',
        parsed_data: parsedData,
      })
      .select('id')
      .single()

    expect(insertErr).toBeNull()
    expect(inserted?.id).toBeTruthy()
    if (inserted?.id) created.documentIds.push(inserted.id)

    // Read back as an independent query to confirm the value survives a
    // full PostgREST round trip (not just an echo of the insert payload).
    const { data: fetched, error: fetchErr } = await supabase
      .from('documents')
      .select('parsed_data, parse_status, doc_type')
      .eq('id', inserted!.id)
      .single()

    expect(fetchErr).toBeNull()
    expect(fetched?.parse_status).toBe('parsed')
    expect(fetched?.doc_type).toBe('pl_report')
    expect(fetched?.parsed_data).toMatchObject({
      revenue: 84_000_000,
      gross_margin: 34.2,
      metric_id: metricId,
    })
    // Explicit assertion that the UUID survived JSONB encoding.
    expect((fetched?.parsed_data as { metric_id?: string })?.metric_id).toBe(metricId)
  })
})
