/**
 * Supabase-backed acceptance coverage for the canonical Point A model.
 *
 * The suite intentionally exercises the real repository and real Supabase
 * tables with a service-role client. Every test creates unique auth/company
 * fixtures and removes only those exact ids in `finally`.
 *
 * Service-role clients bypass Postgres RLS. Scenario 10 additionally signs in
 * through the public anon client and verifies cross-tenant SELECT/INSERT
 * behavior with a real user JWT, then verifies the repository ownership guard.
 */

import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { describe, expect, it } from 'vitest'
import {
  confirmPointAValue,
  ingestDocumentToPointA,
  ingestSurveyAnswersToPointA,
  readPointAModel,
  retractDocumentPointASource,
  setManualPointAValue,
} from '@/lib/point-a/model/repository'
import type {
  PointAFieldView,
  PointAModelView,
  PointAScenario,
} from '@/lib/point-a/model/types'

config({
  path: resolve(process.cwd(), '.env.local'),
  override: false,
  quiet: true,
})

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SKIP = !SUPABASE_URL || !SERVICE_ROLE_KEY
const TEST_TIMEOUT = 60_000

const REVENUE_FIELD = 'biz.finansy.vyruchka_god'
const SURVEY_REVENUE_KEY = 's2_revenue_2025'

interface FixtureOwner {
  userId: string
  email: string
  password: string
  companyId: string
}

interface AcceptanceFixture {
  sb: SupabaseClient
  runId: string
  owners: FixtureOwner[]
}

interface RegisteredDocument {
  documentId: string
  fileName: string
  contentHash: string
  parsedData: ReturnType<typeof revenuePayload>
  periodYear: number
  periodQuarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
  ingestion: {
    created: number
    unchanged: number
    fields: string[]
  }
}

function dbError(context: string, error: { message?: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message ?? 'unknown error'}`)
}

function owner(fixture: AcceptanceFixture, index = 0): FixtureOwner {
  const result = fixture.owners[index]
  if (!result) throw new Error(`fixture owner ${index} was not created`)
  return result
}

function field(
  model: PointAModelView,
  periodKey = '2025',
  scenario: PointAScenario = 'fact',
): PointAFieldView | undefined {
  return model.fields.find(
    (item) =>
      item.fieldKey === REVENUE_FIELD &&
      item.periodKey === periodKey &&
      item.scenario === scenario,
  )
}

function revenuePayload(
  value: unknown,
  confidence = 0.95,
  source = `Выручка за период: ${String(value)}`,
) {
  return {
    summary: 'Интеграционный отчёт о прибылях и убытках',
    fields: [
      {
        key: 'revenue_total',
        label: 'Выручка',
        value: value as string | number,
        target_tab: 'Финансы',
        target_parameter: 'Выручка',
        metric_id: REVENUE_FIELD,
        source,
        confidence,
      },
    ],
    raw_text_preview: source,
    extracted_at: new Date().toISOString(),
    model_used: 'acceptance-fixture',
    classification: 'pl_report',
  }
}

async function cleanupFixture(fixture: AcceptanceFixture): Promise<void> {
  const companyIds = fixture.owners.map((item) => item.companyId).filter(Boolean)
  const userIds = fixture.owners.map((item) => item.userId).filter(Boolean)

  const deleteBy = async (
    table: string,
    column: string,
    values: string[],
  ): Promise<void> => {
    if (!values.length) return
    const { error } = await fixture.sb.from(table).delete().in(column, values)
    dbError(`cleanup ${table}`, error)
  }

  if (companyIds.length) {
    // Delete dependency edges before their referenced values/sources.
    await deleteBy('point_a_value_events', 'company_id', companyIds)
    await deleteBy('point_a_resolutions', 'company_id', companyIds)
    await deleteBy('metrics', 'company_id', companyIds)
    await deleteBy('point_a_values', 'company_id', companyIds)
    await deleteBy('point_a_sources', 'company_id', companyIds)
    await deleteBy('documents', 'company_id', companyIds)
    await deleteBy('survey_answers', 'company_id', companyIds)
    await deleteBy('diagnostics', 'company_id', companyIds)
    await deleteBy('companies', 'id', companyIds)
  }

  if (userIds.length) {
    await deleteBy('survey_answers', 'user_id', userIds)
    await deleteBy('diagnostics', 'user_id', userIds)
    await deleteBy('profiles', 'id', userIds)
    for (const userId of userIds) {
      const { error } = await fixture.sb.auth.admin.deleteUser(userId)
      dbError(`cleanup auth user ${userId}`, error)
    }
  }
}

async function createFixture(
  scenario: string,
  ownerCount = 1,
): Promise<AcceptanceFixture> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('Supabase service-role environment is not configured')
  }

  const fixture: AcceptanceFixture = {
    sb: createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }),
    runId: `${scenario}-${randomUUID()}`,
    owners: [],
  }

  try {
    for (let index = 0; index < ownerCount; index += 1) {
      const email = `point-a-accept-${fixture.runId}-${index}@example.test`
      const password = `PointA-${randomUUID()}`
      const { data: authData, error: authError } =
        await fixture.sb.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        })
      dbError('create auth user', authError)
      if (!authData.user) throw new Error('create auth user returned no user')

      const partialOwner: FixtureOwner = {
        userId: authData.user.id,
        email,
        password,
        companyId: '',
      }
      fixture.owners.push(partialOwner)

      const { error: profileError } = await fixture.sb.from('profiles').upsert(
        {
          id: partialOwner.userId,
          email,
          full_name: `Point A acceptance ${scenario}/${index}`,
          role: 'client',
          status: 'approved',
        },
        { onConflict: 'id' },
      )
      dbError('upsert fixture profile', profileError)

      const { data: company, error: companyError } = await fixture.sb
        .from('companies')
        .insert({
          user_id: partialOwner.userId,
          name: `Point A acceptance ${fixture.runId}/${index}`,
          industry: 'technology',
          stage: 'Growth',
          business_model: 'B2B',
        })
        .select('id')
        .single()
      dbError('create fixture company', companyError)
      if (!company?.id) throw new Error('create company returned no id')
      partialOwner.companyId = String(company.id)
    }
    return fixture
  } catch (error) {
    await cleanupFixture(fixture)
    throw error
  }
}

async function withFixture(
  scenario: string,
  body: (fixture: AcceptanceFixture) => Promise<void>,
  ownerCount = 1,
): Promise<void> {
  const fixture = await createFixture(scenario, ownerCount)
  try {
    await body(fixture)
  } finally {
    await cleanupFixture(fixture)
  }
}

async function submitSurveyRevenue(
  fixture: AcceptanceFixture,
  fixtureOwner: FixtureOwner,
  value: unknown,
): Promise<void> {
  const { error } = await fixture.sb.from('survey_answers').upsert(
    {
      user_id: fixtureOwner.userId,
      company_id: fixtureOwner.companyId,
      step: 2,
      question_key: SURVEY_REVENUE_KEY,
      answer: { value },
    },
    { onConflict: 'user_id,question_key' },
  )
  dbError('persist survey answer', error)

  await ingestSurveyAnswersToPointA(fixture.sb, {
    userId: fixtureOwner.userId,
    companyId: fixtureOwner.companyId,
    answers: { [SURVEY_REVENUE_KEY]: value },
    step: 2,
  })
}

async function registerParsedDocument(
  fixture: AcceptanceFixture,
  fixtureOwner: FixtureOwner,
  input: {
    tag: string
    value: unknown
    confidence?: number
    periodYear?: number
    periodQuarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
    source?: string
  },
): Promise<RegisteredDocument> {
  const periodYear = input.periodYear ?? 2025
  const periodQuarter = input.periodQuarter ?? null
  const fileName = `${fixture.runId}-${input.tag}.xlsx`
  const contentHash = createHash('sha256')
    .update(`${fixture.runId}:${input.tag}:${String(input.value)}`)
    .digest('hex')
  const parsedData = revenuePayload(
    input.value,
    input.confidence,
    input.source,
  )
  const fileUrl =
    `${SUPABASE_URL}/storage/v1/object/public/documents/` +
    `${fixtureOwner.userId}/${encodeURIComponent(fileName)}`

  const { data: document, error } = await fixture.sb
    .from('documents')
    .insert({
      user_id: fixtureOwner.userId,
      company_id: fixtureOwner.companyId,
      file_name: fileName,
      file_url: fileUrl,
      file_size: 1_024,
      mime_type:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      doc_type: 'pl_report',
      period_year: periodYear,
      period_quarter: periodQuarter,
      content_hash: contentHash,
      parse_status: 'parsed',
      parsed_data: parsedData,
    })
    .select('id')
    .single()
  dbError('register parsed document', error)
  if (!document?.id) throw new Error('document insert returned no id')

  const documentId = String(document.id)
  const ingestion = await ingestDocumentToPointA(fixture.sb, {
    id: documentId,
    userId: fixtureOwner.userId,
    companyId: fixtureOwner.companyId,
    fileName,
    docType: 'pl_report',
    parsedData,
    contentHash,
    periodYear,
    periodQuarter,
  })

  return {
    documentId,
    fileName,
    contentHash,
    parsedData,
    periodYear,
    periodQuarter,
    ingestion,
  }
}

async function dashboardMetric(
  fixture: AcceptanceFixture,
  companyId: string,
  input: {
    periodYear: number
    periodQuarter?: string | null
    scenario: PointAScenario
  },
) {
  let query = fixture.sb
    .from('metrics')
    .select(
      'metric_key,metric_value,metric_unit,period_year,period_quarter,period_month,scenario,source,provenance',
    )
    .eq('company_id', companyId)
    .eq('metric_key', REVENUE_FIELD)
    .eq('period_year', input.periodYear)
    .eq('scenario', input.scenario)
    .eq('source', 'calculated')

  query =
    input.periodQuarter == null
      ? query.is('period_quarter', null)
      : query.eq('period_quarter', input.periodQuarter)

  const { data, error } = await query.maybeSingle()
  dbError('read projected dashboard metric', error)
  return data
}

const acceptanceDescribe = SKIP ? describe.skip : describe.sequential

acceptanceDescribe('canonical Point A acceptance against Supabase', () => {
  it(
    '1. persists a submitted survey answer and exposes it in Point A',
    async () => {
      await withFixture('01-survey-point-a', async (fixture) => {
        const fixtureOwner = owner(fixture)
        await submitSurveyRevenue(fixture, fixtureOwner, '84,2 млн ₸')

        const model = await readPointAModel(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
        })
        const revenue = field(model)

        expect(revenue).toBeDefined()
        expect(revenue?.selected).toMatchObject({
          normalized_value: 84_200_000,
          extraction_kind: 'survey',
          status: 'detected',
          period_key: '2025',
          scenario: 'fact',
        })
        expect(revenue?.selected?.point_a_sources).toMatchObject({
          source_type: 'survey',
          native_source_id: `survey:${SURVEY_REVENUE_KEY}`,
        })
      })
    },
    TEST_TIMEOUT,
  )

  it(
    '2. projects survey data to the metric consumed by the dashboard',
    async () => {
      await withFixture('02-survey-dashboard', async (fixture) => {
        const fixtureOwner = owner(fixture)
        await submitSurveyRevenue(fixture, fixtureOwner, 91_000_000)

        const metric = await dashboardMetric(
          fixture,
          fixtureOwner.companyId,
          { periodYear: 2025, scenario: 'fact' },
        )

        expect(metric).toBeDefined()
        expect(Number(metric?.metric_value)).toBe(91_000_000)
        expect(metric).toMatchObject({
          metric_key: REVENUE_FIELD,
          period_year: 2025,
          scenario: 'fact',
          source: 'calculated',
        })
        expect(metric?.provenance).toMatchObject({
          extraction_kind: 'survey',
          raw_value: 91_000_000,
        })
      })
    },
    TEST_TIMEOUT,
  )

  it(
    '3. stores an uploaded parsed report and exposes its extracted source',
    async () => {
      await withFixture('03-document-ingestion', async (fixture) => {
        const fixtureOwner = owner(fixture)
        const report = await registerParsedDocument(fixture, fixtureOwner, {
          tag: 'p-and-l',
          value: 72_500_000,
          source: 'Строка 18: Выручка — 72 500 000 ₸',
        })

        expect(report.ingestion).toMatchObject({
          created: 1,
          unchanged: 0,
          fields: [REVENUE_FIELD],
        })

        const model = await readPointAModel(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
        })
        const revenue = field(model)

        expect(revenue?.selected).toMatchObject({
          normalized_value: 72_500_000,
          extraction_kind: 'table',
          source_fragment: 'Строка 18: Выручка — 72 500 000 ₸',
        })
        expect(revenue?.selected?.source_locator).toMatchObject({
          document_id: report.documentId,
          field_key: 'revenue_total',
        })
        expect(revenue?.selected?.point_a_sources).toMatchObject({
          source_type: 'document',
          native_source_id: report.documentId,
          source_name: report.fileName,
        })
      })
    },
    TEST_TIMEOUT,
  )

  it(
    '4. makes repeated ingestion of the same file idempotent',
    async () => {
      await withFixture('04-document-dedup', async (fixture) => {
        const fixtureOwner = owner(fixture)
        const report = await registerParsedDocument(fixture, fixtureOwner, {
          tag: 'same-file',
          value: 64_000_000,
        })

        const repeated = await ingestDocumentToPointA(fixture.sb, {
          id: report.documentId,
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
          fileName: report.fileName,
          docType: 'pl_report',
          parsedData: report.parsedData,
          contentHash: report.contentHash,
          periodYear: report.periodYear,
          periodQuarter: report.periodQuarter,
        })

        expect(report.ingestion).toMatchObject({ created: 1, unchanged: 0 })
        expect(repeated).toMatchObject({ created: 0, unchanged: 1 })

        const { data: sources, error: sourceError } = await fixture.sb
          .from('point_a_sources')
          .select('id')
          .eq('company_id', fixtureOwner.companyId)
          .eq('source_type', 'document')
          .eq('native_source_id', report.documentId)
        dbError('count deduplicated sources', sourceError)
        expect(sources).toHaveLength(1)

        const { data: values, error: valuesError } = await fixture.sb
          .from('point_a_values')
          .select('id,status')
          .eq('source_id', sources?.[0]?.id)
          .not('status', 'in', '("superseded","retracted")')
        dbError('count deduplicated values', valuesError)
        expect(values).toHaveLength(1)
      })
    },
    TEST_TIMEOUT,
  )

  it(
    '5. selects manual input ahead of an automatic document value',
    async () => {
      await withFixture('05-manual-priority', async (fixture) => {
        const fixtureOwner = owner(fixture)
        await registerParsedDocument(fixture, fixtureOwner, {
          tag: 'automatic',
          value: 70_000_000,
          confidence: 0.99,
        })
        await setManualPointAValue(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
          fieldKey: REVENUE_FIELD,
          value: 71_500_000,
          currency: 'KZT',
          period: '2025',
          scenario: 'fact',
        })

        const model = await readPointAModel(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
        })
        const revenue = field(model)

        expect(revenue?.selected).toMatchObject({
          normalized_value: 71_500_000,
          extraction_kind: 'manual',
        })
        expect(revenue?.resolutionStatus).toBe('conflict')
        expect(revenue?.candidates.map((item) => item.extraction_kind)).toEqual(
          expect.arrayContaining(['manual', 'table']),
        )
      })
    },
    TEST_TIMEOUT,
  )

  it(
    '6. exposes disagreement between two documents as a conflict',
    async () => {
      await withFixture('06-document-conflict', async (fixture) => {
        const fixtureOwner = owner(fixture)
        await registerParsedDocument(fixture, fixtureOwner, {
          tag: 'report-a',
          value: 82_000_000,
          confidence: 0.97,
        })
        await registerParsedDocument(fixture, fixtureOwner, {
          tag: 'report-b',
          value: 76_000_000,
          confidence: 0.91,
        })

        const model = await readPointAModel(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
        })
        const conflict = field(model)

        expect(conflict?.resolutionStatus).toBe('conflict')
        expect(conflict?.candidates).toHaveLength(2)
        expect(
          conflict?.candidates.map((item) => item.normalized_value),
        ).toEqual(expect.arrayContaining([82_000_000, 76_000_000]))
        expect(model.conflicts.map((item) => item.resolutionId)).toContain(
          conflict?.resolutionId,
        )
        expect(model.recentChanges.some(
          (event) =>
            event.fieldKey === REVENUE_FIELD &&
            event.eventType === 'conflict_detected',
        )).toBe(true)
      })
    },
    TEST_TIMEOUT,
  )

  it(
    '7. confirmation resolves Point A and updates the dashboard projection',
    async () => {
      await withFixture('07-confirm-refresh', async (fixture) => {
        const fixtureOwner = owner(fixture)
        await registerParsedDocument(fixture, fixtureOwner, {
          tag: 'higher-confidence',
          value: 88_000_000,
          confidence: 0.98,
        })
        await registerParsedDocument(fixture, fixtureOwner, {
          tag: 'user-choice',
          value: 79_000_000,
          confidence: 0.9,
        })

        const before = await readPointAModel(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
        })
        const chosen = field(before)?.candidates.find(
          (candidate) => candidate.normalized_value === 79_000_000,
        )
        expect(chosen).toBeDefined()

        await confirmPointAValue(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
          valueId: chosen!.id,
          eventType: 'conflict_resolved',
        })

        const after = await readPointAModel(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
        })
        expect(field(after)).toMatchObject({
          resolutionStatus: 'resolved',
          selected: {
            id: chosen!.id,
            normalized_value: 79_000_000,
            status: 'confirmed',
            confirmed_by: fixtureOwner.userId,
          },
        })
        expect(after.conflicts).toHaveLength(0)

        const metric = await dashboardMetric(
          fixture,
          fixtureOwner.companyId,
          { periodYear: 2025, scenario: 'fact' },
        )
        expect(Number(metric?.metric_value)).toBe(79_000_000)
        expect(metric?.provenance).toMatchObject({
          canonical_value_id: chosen!.id,
          status: 'confirmed',
        })
      })
    },
    TEST_TIMEOUT,
  )

  it(
    '8. retracting a document recomputes Point A and its dashboard metric',
    async () => {
      await withFixture('08-document-retract', async (fixture) => {
        const fixtureOwner = owner(fixture)
        const removed = await registerParsedDocument(
          fixture,
          fixtureOwner,
          {
            tag: 'removed',
            value: 95_000_000,
            confidence: 0.99,
          },
        )
        await registerParsedDocument(fixture, fixtureOwner, {
          tag: 'remaining',
          value: 81_000_000,
          confidence: 0.9,
        })

        const result = await retractDocumentPointASource(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
          documentId: removed.documentId,
        })

        expect(result).toEqual({ retracted: 1, fields: 1 })
        const model = await readPointAModel(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
        })
        expect(field(model)).toMatchObject({
          resolutionStatus: 'resolved',
          selected: { normalized_value: 81_000_000 },
        })

        const metric = await dashboardMetric(
          fixture,
          fixtureOwner.companyId,
          { periodYear: 2025, scenario: 'fact' },
        )
        expect(Number(metric?.metric_value)).toBe(81_000_000)

        const { data: source, error } = await fixture.sb
          .from('point_a_sources')
          .select('status,deleted_at')
          .eq('company_id', fixtureOwner.companyId)
          .eq('native_source_id', removed.documentId)
          .single()
        dbError('read retracted source', error)
        expect(source?.status).toBe('deleted')
        expect(source?.deleted_at).toBeTruthy()
      })
    },
    TEST_TIMEOUT,
  )

  it(
    '9. a failed document extraction leaves previously saved data intact',
    async () => {
      await withFixture('09-processing-error', async (fixture) => {
        const fixtureOwner = owner(fixture)
        await submitSurveyRevenue(fixture, fixtureOwner, 68_000_000)

        const failedDocumentId = randomUUID()
        const failedFile = `${fixture.runId}-broken.pdf`
        const contentHash = createHash('sha256')
          .update(`${fixture.runId}:broken`)
          .digest('hex')
        const { error: insertError } = await fixture.sb
          .from('documents')
          .insert({
            id: failedDocumentId,
            user_id: fixtureOwner.userId,
            company_id: fixtureOwner.companyId,
            file_name: failedFile,
            file_url:
              `${SUPABASE_URL}/storage/v1/object/public/documents/` +
              `${fixtureOwner.userId}/${failedFile}`,
            file_size: 512,
            mime_type: 'application/pdf',
            doc_type: 'pl_report',
            period_year: 2025,
            content_hash: contentHash,
            parse_status: 'error',
            parse_error: 'fixture extraction failure',
            parsed_data: null,
          })
        dbError('persist failed document state', insertError)

        await expect(
          ingestDocumentToPointA(fixture.sb, {
            id: failedDocumentId,
            userId: fixtureOwner.userId,
            companyId: fixtureOwner.companyId,
            fileName: failedFile,
            docType: 'pl_report',
            parsedData: null,
            contentHash,
            periodYear: 2025,
          }),
        ).rejects.toThrow('Документ не содержит извлечённых полей')

        const model = await readPointAModel(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
        })
        expect(field(model)?.selected).toMatchObject({
          normalized_value: 68_000_000,
          extraction_kind: 'survey',
        })

        const metric = await dashboardMetric(
          fixture,
          fixtureOwner.companyId,
          { periodYear: 2025, scenario: 'fact' },
        )
        expect(Number(metric?.metric_value)).toBe(68_000_000)

        const { data: failedDocument, error: readError } = await fixture.sb
          .from('documents')
          .select('parse_status,parse_error')
          .eq('id', failedDocumentId)
          .single()
        dbError('read failed document state', readError)
        expect(failedDocument).toMatchObject({
          parse_status: 'error',
          parse_error: 'fixture extraction failure',
        })
      })
    },
    TEST_TIMEOUT,
  )

  it(
    '10. enforces JWT RLS and repository ownership between two users',
    async () => {
      await withFixture(
        '10-two-user-ownership',
        async (fixture) => {
          const first = owner(fixture, 0)
          const second = owner(fixture, 1)
          await submitSurveyRevenue(fixture, first, 77_000_000)
          await submitSurveyRevenue(fixture, second, 55_000_000)

          if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            throw new Error(
              'NEXT_PUBLIC_SUPABASE_ANON_KEY is required for JWT RLS acceptance',
            )
          }

          const jwtClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
              autoRefreshToken: false,
              persistSession: false,
            },
          })
          const { data: session, error: signInError } =
            await jwtClient.auth.signInWithPassword({
              email: first.email,
              password: first.password,
            })
          dbError('sign in first owner for RLS verification', signInError)
          expect(session.user?.id).toBe(first.userId)

          const { data: foreignCompanies, error: companyReadError } =
            await jwtClient
              .from('companies')
              .select('id')
              .eq('id', second.companyId)
          dbError('read foreign company through JWT RLS', companyReadError)
          expect.soft(foreignCompanies).toEqual([])

          const { data: foreignValues, error: valueReadError } = await jwtClient
            .from('point_a_values')
            .select('id')
            .eq('company_id', second.companyId)
          dbError('read foreign Point A values through JWT RLS', valueReadError)
          expect.soft(foreignValues).toEqual([])

          const { error: foreignInsertError } = await jwtClient
            .from('point_a_sources')
            .insert({
              user_id: second.userId,
              company_id: second.companyId,
              source_type: 'manual',
              native_source_id: `rls-attack:${fixture.runId}`,
              source_name: 'Запрещённая межтенантная запись',
              status: 'ready',
              metadata: { acceptance_fixture: fixture.runId },
            })
          expect.soft(foreignInsertError).toBeTruthy()

          await expect(
            readPointAModel(fixture.sb, {
              userId: second.userId,
              companyId: first.companyId,
            }),
          ).rejects.toThrow('Компания пользователя не найдена')

          const secondModel = await readPointAModel(fixture.sb, {
            userId: second.userId,
            companyId: second.companyId,
          })
          expect(field(secondModel)?.selected).toMatchObject({
            user_id: second.userId,
            company_id: second.companyId,
            normalized_value: 55_000_000,
          })
          expect(secondModel.companyId).toBe(second.companyId)

          const { data: firstUserRows, error } = await fixture.sb
            .from('point_a_values')
            .select('user_id,company_id')
            .eq('company_id', first.companyId)
          dbError('verify first user fixture rows', error)
          expect(firstUserRows).toEqual([
            {
              user_id: first.userId,
              company_id: first.companyId,
            },
          ])

          const { error: signOutError } = await jwtClient.auth.signOut()
          dbError('sign out JWT RLS fixture user', signOutError)
        },
        2,
      )
    },
    TEST_TIMEOUT,
  )

  it(
    '11. returns honest empty and partially completed model states',
    async () => {
      await withFixture('11-empty-partial', async (fixture) => {
        const fixtureOwner = owner(fixture)
        const empty = await readPointAModel(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
        })

        expect(empty.fields).toHaveLength(0)
        expect(empty.conflicts).toHaveLength(0)
        expect(empty.completion).toBe(0)
        expect(empty.missing.length).toBeGreaterThan(0)

        await submitSurveyRevenue(fixture, fixtureOwner, 50_000_000)
        const partial = await readPointAModel(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
        })

        expect(field(partial)).toBeDefined()
        expect(partial.completion).toBeGreaterThan(0)
        expect(partial.completion).toBeLessThan(100)
        expect(partial.missing.length).toBeLessThan(empty.missing.length)
      })
    },
    TEST_TIMEOUT,
  )

  it(
    '12. keeps an invalid numeric value out of projected aggregates',
    async () => {
      await withFixture('12-invalid-number', async (fixture) => {
        const fixtureOwner = owner(fixture)
        await setManualPointAValue(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
          fieldKey: REVENUE_FIELD,
          value: 'не число',
          unit: '₸',
          currency: 'KZT',
          period: '2025',
          scenario: 'fact',
        })

        const model = await readPointAModel(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
        })
        expect(field(model)?.selected).toMatchObject({
          raw_value: 'не число',
          normalized_value: 'не число',
          value_type: 'text',
        })

        const metric = await dashboardMetric(
          fixture,
          fixtureOwner.companyId,
          { periodYear: 2025, scenario: 'fact' },
        )
        expect(metric).toBeNull()
      })
    },
    TEST_TIMEOUT,
  )

  it(
    '13. stores fact, plan and forecast as independent dimensions',
    async () => {
      await withFixture('13-scenarios', async (fixture) => {
        const fixtureOwner = owner(fixture)
        const values: Record<PointAScenario, number> = {
          fact: 100_000_000,
          plan: 120_000_000,
          forecast: 111_000_000,
        }

        for (const scenario of ['fact', 'plan', 'forecast'] as const) {
          await setManualPointAValue(fixture.sb, {
            userId: fixtureOwner.userId,
            companyId: fixtureOwner.companyId,
            fieldKey: REVENUE_FIELD,
            value: values[scenario],
            currency: 'KZT',
            period: '2025-Q4',
            scenario,
          })
        }

        const model = await readPointAModel(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
        })
        const scenarioFields = model.fields.filter(
          (item) =>
            item.fieldKey === REVENUE_FIELD &&
            item.periodKey === '2025-Q4',
        )

        expect(scenarioFields).toHaveLength(3)
        expect(
          Object.fromEntries(
            scenarioFields.map((item) => [
              item.scenario,
              item.selected?.normalized_value,
            ]),
          ),
        ).toEqual(values)

        for (const scenario of ['fact', 'plan', 'forecast'] as const) {
          const metric = await dashboardMetric(
            fixture,
            fixtureOwner.companyId,
            {
              periodYear: 2025,
              periodQuarter: 'Q4',
              scenario,
            },
          )
          expect(Number(metric?.metric_value)).toBe(values[scenario])
        }
      })
    },
    TEST_TIMEOUT,
  )

  it(
    '14. preserves values from different periods without overwriting',
    async () => {
      await withFixture('14-periods', async (fixture) => {
        const fixtureOwner = owner(fixture)
        await setManualPointAValue(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
          fieldKey: REVENUE_FIELD,
          value: 23_000_000,
          currency: 'KZT',
          period: '2025-Q1',
          scenario: 'fact',
        })
        await setManualPointAValue(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
          fieldKey: REVENUE_FIELD,
          value: 31_000_000,
          currency: 'KZT',
          period: '2025-Q2',
          scenario: 'fact',
        })

        const model = await readPointAModel(fixture.sb, {
          userId: fixtureOwner.userId,
          companyId: fixtureOwner.companyId,
        })
        expect(field(model, '2025-Q1')?.selected?.normalized_value).toBe(
          23_000_000,
        )
        expect(field(model, '2025-Q2')?.selected?.normalized_value).toBe(
          31_000_000,
        )

        const q1 = await dashboardMetric(fixture, fixtureOwner.companyId, {
          periodYear: 2025,
          periodQuarter: 'Q1',
          scenario: 'fact',
        })
        const q2 = await dashboardMetric(fixture, fixtureOwner.companyId, {
          periodYear: 2025,
          periodQuarter: 'Q2',
          scenario: 'fact',
        })
        expect(Number(q1?.metric_value)).toBe(23_000_000)
        expect(Number(q2?.metric_value)).toBe(31_000_000)
        expect(q1?.provenance).not.toEqual(q2?.provenance)
      })
    },
    TEST_TIMEOUT,
  )
})
