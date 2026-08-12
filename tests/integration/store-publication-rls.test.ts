import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  supabaseTestsEnabled,
  TEST_SUPABASE_SERVICE_ROLE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/supabase-env'

/**
 * Destructive integration coverage for migration 085.
 *
 * The suite is deliberately gated on TEST_SUPABASE_* and also refuses a test
 * URL that matches the application's configured Supabase URL. It creates auth
 * users, companies and store facts, so it must run only against a disposable
 * project whose migrations (through 085) have already been applied.
 */

const configuredAppUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const normalizeUrl = (value: string) => value.replace(/\/+$/, '')
const pointsAtConfiguredApp = Boolean(
  TEST_SUPABASE_URL
  && configuredAppUrl
  && normalizeUrl(TEST_SUPABASE_URL) === normalizeUrl(configuredAppUrl),
)
const SKIP = !supabaseTestsEnabled || pointsAtConfiguredApp

const describeOrSkip =
  typeof (describe as unknown as { skipIf?: unknown }).skipIf === 'function'
    ? (describe as unknown as { skipIf: (condition: boolean) => typeof describe })
      .skipIf(SKIP)
    : SKIP
      ? describe.skip
      : describe

interface TestUser {
  id: string
  email: string
  password: string
  companyId: string
  client: SupabaseClient
}

interface PublishedRun {
  id: string
  userId: string
  companyId: string
  variantId: string
  factId: string
  params: Record<string, unknown>
}

interface PublicationRow {
  outcome: 'published' | 'duplicate'
  import_run_id: string
  status: string
  import_kind: string
  scope_key: string
  row_count: number
  published_at: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function serviceClient(): SupabaseClient {
  return createClient(
    TEST_SUPABASE_URL,
    TEST_SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

async function createTestUser(
  service: SupabaseClient,
  label: string,
): Promise<TestUser> {
  const tag = randomUUID()
  const email = `store-publication-${label}-${tag}@aistart360.test`
  const password = `Store_${tag}_Aa1!`
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `STORE_PUBLICATION_${label}_${tag}` },
  })
  if (created.error || !created.data.user) {
    throw new Error(`create ${label} auth user: ${created.error?.message ?? 'no user'}`)
  }

  const id = created.data.user.id
  const { error: profileError } = await service.from('profiles').upsert({
    id,
    email,
    full_name: `Store publication ${label}`,
    role: 'client',
    status: 'approved',
  }, { onConflict: 'id' })
  if (profileError) {
    throw new Error(`create ${label} profile: ${profileError.message}`)
  }

  const companyResult = await service
    .from('companies')
    .insert({
      user_id: id,
      name: `STORE_PUBLICATION_${label}_${tag}`,
      industry: 'integration-test',
      business_model: 'B2C',
    })
    .select('id')
    .single()
  if (companyResult.error || !companyResult.data) {
    throw new Error(
      `create ${label} company: ${companyResult.error?.message ?? 'no company'}`,
    )
  }

  // Keep the service key only as the required `apikey` header. Once signed in,
  // supabase-js sends the user's access token as Authorization, so PostgREST
  // evaluates grants and RLS as `authenticated`, not `service_role`.
  const client = serviceClient()
  const signedIn = await client.auth.signInWithPassword({ email, password })
  if (signedIn.error || !signedIn.data.session) {
    throw new Error(`sign in ${label}: ${signedIn.error?.message ?? 'no session'}`)
  }

  return {
    id,
    email,
    password,
    companyId: String(companyResult.data.id),
    client,
  }
}

function pricePublicationParams(user: TestUser, label: string) {
  const normalizedName = `integration price variant ${label} ${randomUUID()}`
  const rows = [{
    variantKey: `name-v1:${sha256(normalizedName)}`,
    sku: `TEST-${label}-${randomUUID()}`,
    name: normalizedName,
    normalizedName,
    snapshotDate: '2026-08-12',
    purchasePrice: 100,
    retailPrice: 150,
    consignmentPrice: null,
    wholesale25Price: null,
    wholesale30Price: null,
  }]

  return {
    p_user_id: user.id,
    p_company_id: user.companyId,
    p_source_sha256: sha256(`source:${label}:${randomUUID()}`),
    p_source_file_name: `store-import-${label}.xlsx`,
    p_source_size_bytes: 512,
    p_schema_version: 1,
    p_idempotency_key: randomUUID(),
    p_manifest_sha256: sha256(JSON.stringify({ label, rows })),
    p_import_kind: 'prices',
    p_scope_key: 'global',
    p_effective_date: '2026-08-12',
    p_period_start: '2026-08-12',
    p_period_end: '2026-08-12',
    p_warning_count: 0,
    p_quarantined_count: 0,
    p_rows: rows,
  }
}

async function publishPrice(
  service: SupabaseClient,
  user: TestUser,
  label: string,
): Promise<{ run: PublishedRun; result: PublicationRow }> {
  const params = pricePublicationParams(user, label)
  const publication = await service.rpc('publish_store_import', params)
  if (publication.error) {
    throw new Error(
      `publish ${label} (apply migrations through 085 first): ${publication.error.message}`,
    )
  }

  const result = (publication.data as PublicationRow[] | null)?.[0]
  if (!result?.import_run_id) {
    throw new Error(`publish ${label}: RPC returned no import run`)
  }

  const variant = await service
    .from('store_product_variants')
    .select('id')
    .eq('user_id', user.id)
    .eq('company_id', user.companyId)
    .single()
  if (variant.error || !variant.data) {
    throw new Error(`load ${label} variant: ${variant.error?.message ?? 'no variant'}`)
  }

  const fact = await service
    .from('store_price_snapshots')
    .select('id')
    .eq('import_run_id', result.import_run_id)
    .single()
  if (fact.error || !fact.data) {
    throw new Error(`load ${label} fact: ${fact.error?.message ?? 'no fact'}`)
  }

  return {
    result,
    run: {
      id: result.import_run_id,
      userId: user.id,
      companyId: user.companyId,
      variantId: String(variant.data.id),
      factId: String(fact.data.id),
      params,
    },
  }
}

describeOrSkip('store publication RPC and RLS (disposable Supabase)', () => {
  let service: SupabaseClient
  let userA: TestUser
  let userB: TestUser
  let runA: PublishedRun
  let runB: PublishedRun
  let firstA: PublicationRow
  const createdUserIds: string[] = []

  beforeAll(async () => {
    service = serviceClient()

    userA = await createTestUser(service, 'a')
    createdUserIds.push(userA.id)
    userB = await createTestUser(service, 'b')
    createdUserIds.push(userB.id)

    const publishedA = await publishPrice(service, userA, 'a')
    const publishedB = await publishPrice(service, userB, 'b')
    runA = publishedA.run
    runB = publishedB.run
    firstA = publishedA.result
  }, 30_000)

  afterAll(async () => {
    if (!service) return

    const cleanupFailures: string[] = []
    for (const userId of [...createdUserIds].reverse()) {
      const deleted = await service.auth.admin.deleteUser(userId)
      if (deleted.error) cleanupFailures.push(`${userId}: ${deleted.error.message}`)
    }
    if (cleanupFailures.length > 0) {
      throw new Error(`store publication cleanup failed: ${cleanupFailures.join('; ')}`)
    }
  }, 30_000)

  it('publishes only through the service RPC and returns duplicate on an exact retry', async () => {
    expect(firstA).toMatchObject({
      outcome: 'published',
      import_run_id: runA.id,
      status: 'published',
      import_kind: 'prices',
      scope_key: 'global',
      row_count: 1,
    })
    expect(firstA.published_at).toBeTruthy()

    const retry = await service.rpc('publish_store_import', runA.params)
    expect(retry.error).toBeNull()
    expect((retry.data as PublicationRow[] | null)?.[0]).toMatchObject({
      outcome: 'duplicate',
      import_run_id: runA.id,
      status: 'published',
      row_count: 1,
    })

    const authenticatedRpc = await userA.client.rpc(
      'publish_store_import',
      runA.params,
    )
    expect(authenticatedRpc.error).not.toBeNull()
  })

  it('lets each authenticated owner read only their own published run and fact', async () => {
    const runIds = [runA.id, runB.id]

    const [runsForA, runsForB, factsForA, factsForB] = await Promise.all([
      userA.client
        .from('store_import_runs')
        .select('id,user_id')
        .in('id', runIds),
      userB.client
        .from('store_import_runs')
        .select('id,user_id')
        .in('id', runIds),
      userA.client
        .from('store_price_snapshots')
        .select('id,user_id,import_run_id')
        .in('import_run_id', runIds),
      userB.client
        .from('store_price_snapshots')
        .select('id,user_id,import_run_id')
        .in('import_run_id', runIds),
    ])

    for (const query of [runsForA, runsForB, factsForA, factsForB]) {
      expect(query.error).toBeNull()
    }
    expect(runsForA.data).toEqual([{ id: runA.id, user_id: userA.id }])
    expect(runsForB.data).toEqual([{ id: runB.id, user_id: userB.id }])
    expect(factsForA.data).toEqual([{
      id: runA.factId,
      user_id: userA.id,
      import_run_id: runA.id,
    }])
    expect(factsForB.data).toEqual([{
      id: runB.factId,
      user_id: userB.id,
      import_run_id: runB.id,
    }])
  })

  it('blocks direct fact mutation for authenticated and service_role clients', async () => {
    const attemptedPrice = 999

    const authenticatedUpdate = await userA.client
      .from('store_price_snapshots')
      .update({ retail_price: attemptedPrice })
      .eq('id', runA.factId)
      .select('id')
    expect(authenticatedUpdate.error).not.toBeNull()
    expect(authenticatedUpdate.data ?? []).toHaveLength(0)

    const serviceUpdate = await service
      .from('store_price_snapshots')
      .update({ retail_price: attemptedPrice })
      .eq('id', runA.factId)
      .select('id')
    expect(serviceUpdate.error).not.toBeNull()
    expect(serviceUpdate.data ?? []).toHaveLength(0)

    const persisted = await service
      .from('store_price_snapshots')
      .select('retail_price')
      .eq('id', runA.factId)
      .single()
    expect(persisted.error).toBeNull()
    expect(Number(persisted.data?.retail_price)).toBe(150)
  })
})
