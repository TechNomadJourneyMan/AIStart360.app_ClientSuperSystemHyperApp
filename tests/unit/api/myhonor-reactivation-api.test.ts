import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const dependencies = vi.hoisted(() => ({
  actor: vi.fn(),
  audit: vi.fn(),
  ingest: vi.fn(),
  definition: vi.fn(),
  overview: vi.fn(),
  listCampaigns: vi.fn(),
  transition: vi.fn(),
  listReady: vi.fn(),
  previewCampaign: vi.fn(),
  recipientPreviews: vi.fn(),
  start: vi.fn(),
  sleep: vi.fn(),
  workflowMetadata: vi.fn(),
  processRecipient: vi.fn(),
  preflight: vi.fn(),
}))

vi.mock('@/lib/admin/giga-actor', () => ({
  getGigaActor: dependencies.actor,
}))
vi.mock('@/lib/audit', () => ({
  logAudit: dependencies.audit,
}))
vi.mock('@/lib/integrations/myhonor/reactivation/repository', () => ({
  MyHonorReactivationAudienceTooLargeError: class extends Error {
    constructor(readonly total: number, readonly loaded: number) {
      super('audience too large')
    }
  },
  ingestMyHonorMarketingContactEvent: dependencies.ingest,
  getMyHonorReactivationCampaignDefinition: dependencies.definition,
  getMyHonorReactivationOverview: dependencies.overview,
  listMyHonorReactivationCampaigns: dependencies.listCampaigns,
  transitionMyHonorReactivationCampaign: dependencies.transition,
  listReadyMyHonorReactivationRecipientJobs: dependencies.listReady,
  previewMyHonorReactivationCampaign: dependencies.previewCampaign,
  listMyHonorReactivationRecipientPreviews: dependencies.recipientPreviews,
}))
vi.mock('workflow/api', () => ({ start: dependencies.start }))
vi.mock('workflow', () => ({
  sleep: dependencies.sleep,
  getWorkflowMetadata: dependencies.workflowMetadata,
}))
vi.mock('@/lib/integrations/myhonor/reactivation/process-recipient', async (original) => {
  const actual = await original<typeof import('@/lib/integrations/myhonor/reactivation/process-recipient')>()
  return {
    ...actual,
    processMyHonorReactivationRecipientDirect: dependencies.processRecipient,
  }
})
vi.mock('@/lib/integrations/myhonor/reactivation/template-preflight', () => ({
  verifyMyHonorReactivationTemplate: dependencies.preflight,
}))

import { POST as ingestContact } from '@/app/api/v1/integrations/myhonor/reactivation-events/route'
import { POST as approveCampaign } from '@/app/api/giga-admin/myhonor/reactivation/campaigns/[id]/approve/route'
import { POST as launchCampaign } from '@/app/api/giga-admin/myhonor/reactivation/campaigns/[id]/launch/route'
import { GET as getReactivationOverview } from '@/app/api/giga-admin/myhonor/reactivation/overview/route'
import { POST as previewCampaign } from '@/app/api/giga-admin/myhonor/reactivation/campaigns/[id]/preview/route'
import { GET as listRecipientPreviews } from '@/app/api/giga-admin/myhonor/reactivation/campaigns/[id]/recipients/route'
import { dispatchMyHonorReactivationCampaignWorkflow } from '@/workflows/dispatch-myhonor-reactivation-campaign'
import { processMyHonorReactivationRecipientWorkflow } from '@/workflows/process-myhonor-reactivation-recipient'

const apiKey = 'myhonor-reactivation-secret-at-least-32-bytes'
const eventId = 'myhonor:contact:00000000-0000-4000-8000-000000000042'
const campaignId = '00000000-0000-4000-8000-000000000042'
const snapshotHash = 'a'.repeat(64)

function configureEnvironment(sendEnabled = true): void {
  vi.stubEnv('MYHONOR_REACTIVATION_API_KEY', apiKey)
  vi.stubEnv('MYHONOR_REACTIVATION_MASTER_KEY', Buffer.alloc(32, 7).toString('base64'))
  vi.stubEnv('MYHONOR_REACTIVATION_OWNER_USER_ID', '00000000-0000-4000-8000-000000000001')
  vi.stubEnv('MYHONOR_REACTIVATION_COMPANY_ID', 'myhonor-shop')
  vi.stubEnv('MYHONOR_REACTIVATION_SEND_ENABLED', sendEnabled ? 'true' : 'false')
  vi.stubEnv('WHATSAPP_TOKEN', 'meta-token')
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone-number-id')
  vi.stubEnv('WHATSAPP_BUSINESS_ACCOUNT_ID', '123456789012345')
  vi.stubEnv('WHATSAPP_TEMPLATE_LANGUAGE', 'ru')
  vi.stubEnv('WHATSAPP_TEMPLATE_REACTIVATION_OLD_LEAD', 'myhonor_old_lead_v1')
  vi.stubEnv('WHATSAPP_TEMPLATE_REACTIVATION_ABANDONED_CART', 'myhonor_abandoned_cart_v1')
  vi.stubEnv('WHATSAPP_TEMPLATE_REACTIVATION_REGISTERED', 'myhonor_registered_v1')
  vi.stubEnv('WHATSAPP_TEMPLATE_REACTIVATION_DORMANT', 'myhonor_dormant_v1')
  vi.stubEnv('WHATSAPP_TEMPLATE_REACTIVATION_POST_PURCHASE', 'myhonor_post_purchase_v1')
  vi.stubEnv('WHATSAPP_TEMPLATE_REACTIVATION_SEASONAL', 'myhonor_seasonal_v1')
  vi.stubEnv('WHATSAPP_TEMPLATE_REACTIVATION_CLUB', 'myhonor_club_v1')
  vi.stubEnv('WHATSAPP_TEMPLATE_REACTIVATION_BACK_IN_STOCK', 'myhonor_back_in_stock_v1')
}

function contactEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    event_id: eventId,
    source_version: 42,
    occurred_at: '2026-08-25T10:00:00+05:00',
    contact: {
      external_customer_id: 'store-customer-42',
      phone_e164: '+77051234567',
      first_name: 'Алия',
      locale: 'ru',
      city: 'Алматы',
      interests: ['fishing', 'footwear'],
      size: 'L',
      budget_kzt: 80_000,
      club_status: 'not_member',
      customer_kind: 'retail',
    },
    lifecycle: {
      registered_at: '2025-09-10T11:00:00+05:00',
      last_activity_at: '2026-01-10T11:00:00+05:00',
      last_order_at: null,
      order_count: 0,
      lifetime_value_kzt: 0,
      last_order_product_ids: [],
      abandoned_cart: null,
      unresolved_complaint: false,
    },
    consent: {
      status: 'granted',
      purposes: ['product_recommendations'],
      source: 'account_settings',
      notice_version: 'marketing-2026-08-25',
      evidence_id: 'myhonor:consent:00000000-0000-4000-8000-000000000042',
      obtained_at: '2026-08-25T09:59:00+05:00',
      revoked_at: null,
      cross_border_disclosed: true,
    },
    ...overrides,
  }
}

function ingestRequest(input: {
  payload?: unknown
  authorization?: string | null
  idempotencyKey?: string | null
  sourceVersion?: string | null
} = {}): NextRequest {
  return new NextRequest(
    'https://portal.example.kz/api/v1/integrations/myhonor/reactivation-events',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(input.authorization === null
          ? {}
          : { authorization: input.authorization ?? `Bearer ${apiKey}` }),
        ...(input.idempotencyKey === null
          ? {}
          : { 'idempotency-key': input.idempotencyKey ?? eventId }),
        ...(input.sourceVersion === null
          ? {}
          : { 'x-myhonor-source-version': input.sourceVersion ?? '42' }),
      },
      body: JSON.stringify(input.payload ?? contactEvent()),
    },
  )
}

function launchRequest(body: unknown = {
  approval_snapshot_hash: snapshotHash,
  confirmation: 'LAUNCH_MYHONOR_CAMPAIGN',
}): NextRequest {
  return new NextRequest(
    `https://portal.example.kz/api/giga-admin/myhonor/reactivation/campaigns/${campaignId}/launch`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

function approveRequest(body: unknown = {
  approval_snapshot_hash: snapshotHash,
  confirmation: 'APPROVE_MYHONOR_CAMPAIGN',
}): NextRequest {
  return new NextRequest(
    `https://portal.example.kz/api/giga-admin/myhonor/reactivation/campaigns/${campaignId}/approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

function overviewRequest(): NextRequest {
  return new NextRequest(
    'https://portal.example.kz/api/giga-admin/myhonor/reactivation/overview',
  )
}

function recipientPreviewRequest(input: {
  hash?: string
  offset?: number
  limit?: number
} = {}): NextRequest {
  const query = new URLSearchParams({
    snapshot_hash: input.hash ?? snapshotHash,
    offset: String(input.offset ?? 0),
    limit: String(input.limit ?? 50),
  })
  return new NextRequest(
    `https://portal.example.kz/api/giga-admin/myhonor/reactivation/campaigns/${campaignId}/recipients?${query}`,
  )
}

function recipientJobs(
  startAt: number,
  total: number,
  runAt = '2026-08-25T10:00:00.000Z',
) {
  return Array.from({ length: total }, (_, index) => ({
    recipientId: `00000000-0000-4000-8000-${String(startAt + index).padStart(12, '0')}`,
    runAt,
  }))
}

describe('POST /api/v1/integrations/myhonor/reactivation-events', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
    configureEnvironment()
    dependencies.ingest.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000099',
      eventId,
      created: true,
      duplicate: false,
      conflict: false,
      consentState: 'granted',
    })
  })

  it('fails closed before reading contact PII when auth is absent or invalid', async () => {
    vi.stubEnv('MYHONOR_REACTIVATION_API_KEY', '')
    expect((await ingestContact(ingestRequest())).status).toBe(503)
    configureEnvironment()
    const unauthorized = await ingestContact(ingestRequest({
      authorization: 'Bearer wrong-secret',
    }))
    expect(unauthorized.status).toBe(401)
    expect(dependencies.ingest).not.toHaveBeenCalled()
  })

  it('requires a strict event and matching Idempotency-Key', async () => {
    const mismatch = await ingestContact(ingestRequest({
      idempotencyKey: 'myhonor:contact:00000000-0000-4000-8000-000000000043',
    }))
    expect(mismatch.status).toBe(409)
    expect((await mismatch.json()).error.code).toBe('idempotency_event_mismatch')

    const invalid = await ingestContact(ingestRequest({
      payload: contactEvent({ unexpected: true }),
    }))
    expect(invalid.status).toBe(422)
    expect(dependencies.ingest).not.toHaveBeenCalled()
  })

  it('requires the monotonic source-version header to match the signed body', async () => {
    const missing = await ingestContact(ingestRequest({ sourceVersion: null }))
    expect(missing.status).toBe(400)
    expect((await missing.json()).error.code).toBe('invalid_source_version')

    const mismatch = await ingestContact(ingestRequest({ sourceVersion: '41' }))
    expect(mismatch.status).toBe(409)
    expect((await mismatch.json()).error.code).toBe('source_version_mismatch')
    expect(dependencies.ingest).not.toHaveBeenCalled()
  })

  it('persists a normalized hash before acknowledging and deduplicates', async () => {
    const response = await ingestContact(ingestRequest())
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      ok: true,
      contact_event_id: '00000000-0000-4000-8000-000000000099',
      event_id: eventId,
      duplicate: false,
    })
    expect(dependencies.ingest).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: eventId,
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      event: expect.objectContaining({ source_version: 42 }),
    }))

    dependencies.ingest.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000099',
      eventId,
      created: false,
      duplicate: true,
      conflict: false,
      consentState: 'granted',
    })
    const duplicate = await ingestContact(ingestRequest())
    expect(duplicate.status).toBe(200)
    expect((await duplicate.json()).duplicate).toBe(true)
  })

  it('rejects an idempotency conflict without serializing a contact id', async () => {
    dependencies.ingest.mockResolvedValue({
      id: null,
      eventId,
      created: false,
      duplicate: false,
      conflict: true,
      consentState: 'granted',
    })
    const response = await ingestContact(ingestRequest())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'idempotency_conflict',
        message: 'Idempotency-Key was already used with a different request body',
        retryable: false,
      },
    })
  })
})

describe('MyHonor recipient-level campaign preview', () => {
  const recipient = {
    id: '00000000-0000-4000-8000-000000000201',
    previewSnapshotHash: snapshotHash,
    phoneMasked: '+77••••••4567',
    locale: 'ru',
    state: 'queued',
    exclusionReason: null,
    holdout: false,
    consent: {
      status: 'granted',
      source: 'account_settings',
      obtained_at: '2026-08-25T09:59:00+05:00',
    },
    eligibility: { eligible: true, exclusions: [], segment_match: true },
    recommendation: { products: [] },
    templateParameters: ['Куртка HONOR', '62 900 ₸', 'https://myhonor.shop/product/item'],
    runAt: '2026-08-25T10:00:00.000Z',
  }

  beforeEach(() => {
    vi.resetAllMocks()
    dependencies.actor.mockResolvedValue({ id: 'giga:super_admin', kind: 'break_glass' })
    dependencies.audit.mockResolvedValue(undefined)
    dependencies.previewCampaign.mockResolvedValue({
      campaign: { id: campaignId, state: 'draft', dryRun: false },
      materialized: {
        insertedCount: 1,
        queuedCount: 1,
        previewCount: 0,
        holdoutCount: 0,
        excludedCount: 0,
        previewSnapshotHash: snapshotHash,
      },
      approvalSnapshotHash: snapshotHash,
      overview: { exclusion_reasons: {} },
    })
    dependencies.recipientPreviews.mockResolvedValue([recipient])
  })

  it('returns the exact masked recipient rows that must be reviewed before approval', async () => {
    const response = await previewCampaign(new NextRequest(
      `https://portal.example.kz/api/giga-admin/myhonor/reactivation/campaigns/${campaignId}/preview`,
      { method: 'POST' },
    ), { params: { id: campaignId } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      approvalSnapshotHash: snapshotHash,
      recipientPreview: {
        items: [recipient],
        shown: 1,
        total: 1,
        nextOffset: null,
      },
    })
    expect(dependencies.recipientPreviews).toHaveBeenCalledWith({
      campaignId,
      expectedSnapshotHash: snapshotHash,
      limit: 50,
    })
  })

  it('paginates only the requested immutable preview revision', async () => {
    const response = await listRecipientPreviews(
      recipientPreviewRequest({ offset: 50, limit: 50 }),
      { params: { id: campaignId } },
    )
    expect(response.status).toBe(200)
    expect(dependencies.recipientPreviews).toHaveBeenCalledWith({
      campaignId,
      expectedSnapshotHash: snapshotHash,
      limit: 50,
      offset: 50,
    })

    const invalid = await listRecipientPreviews(
      recipientPreviewRequest({ hash: 'not-a-hash' }),
      { params: { id: campaignId } },
    )
    expect(invalid.status).toBe(400)
  })
})

describe('POST /api/giga-admin/myhonor/reactivation/campaigns/:id/approve', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
    configureEnvironment()
    dependencies.actor.mockResolvedValue({ id: 'giga:super_admin', kind: 'break_glass' })
    dependencies.definition.mockResolvedValue({
      template_contract_hash: 'b'.repeat(64),
    })
    dependencies.transition.mockResolvedValue({
      changed: true,
      state: 'approved',
      reason: 'transitioned',
      recipientJobs: [],
    })
    dependencies.audit.mockResolvedValue(undefined)
  })

  it('binds approval to the reviewed Meta contract hash', async () => {
    const response = await approveCampaign(approveRequest(), { params: { id: campaignId } })
    expect(response.status).toBe(200)
    expect(dependencies.transition).toHaveBeenCalledWith({
      campaignId,
      action: 'approve',
      actorId: 'giga:super_admin',
      sendEnabled: false,
      approvalSnapshotHash: snapshotHash,
      templateContractHash: 'b'.repeat(64),
    })
  })

  it('requires a new preview when the template contract is missing', async () => {
    dependencies.definition.mockResolvedValue({ template_contract_hash: null })
    const response = await approveCampaign(approveRequest(), { params: { id: campaignId } })
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('campaign_template_contract_missing')
    expect(dependencies.transition).not.toHaveBeenCalled()
  })
})

describe('POST /api/giga-admin/myhonor/reactivation/campaigns/:id/launch', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
    configureEnvironment()
    dependencies.actor.mockResolvedValue({ id: 'giga:super_admin', kind: 'break_glass' })
    dependencies.definition.mockResolvedValue({
      dry_run: false,
      segment: 'old_lead',
      template_name: 'myhonor_old_lead_v1',
      template_language: 'ru',
      template_contract_hash: 'b'.repeat(64),
    })
    dependencies.preflight.mockResolvedValue({
      ok: true,
      templateId: 'template-id-1',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      status: 'APPROVED',
      category: 'MARKETING',
      bodyParameterCount: 3,
      contractHash: 'b'.repeat(64),
    })
    dependencies.transition.mockResolvedValue({
      changed: true,
      state: 'running',
      reason: 'transitioned',
      recipientJobs: [
        {
          recipientId: '00000000-0000-4000-8000-000000000101',
          runAt: '2026-08-25T10:00:00.000Z',
        },
        {
          recipientId: '00000000-0000-4000-8000-000000000102',
          runAt: '2026-08-25T10:00:00.000Z',
        },
      ],
    })
    dependencies.start.mockResolvedValue({ runId: 'wrun-reactivation' })
    dependencies.audit.mockResolvedValue(undefined)
  })

  it('requires a giga admin and an explicit approved snapshot', async () => {
    dependencies.actor.mockResolvedValue(null)
    expect((await launchCampaign(launchRequest(), { params: { id: campaignId } })).status).toBe(403)

    dependencies.actor.mockResolvedValue({ id: 'giga:super_admin', kind: 'break_glass' })
    const invalid = await launchCampaign(launchRequest({}), { params: { id: campaignId } })
    expect(invalid.status).toBe(422)
    expect(dependencies.transition).not.toHaveBeenCalled()
  })

  it('never launches or schedules workers for dry-run campaigns', async () => {
    dependencies.definition.mockResolvedValue({
      dry_run: true,
      segment: 'old_lead',
      template_name: 'myhonor_old_lead_v1',
      template_language: 'ru',
      template_contract_hash: 'b'.repeat(64),
    })
    const response = await launchCampaign(launchRequest(), { params: { id: campaignId } })
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('dry_run_campaign_cannot_launch')
    expect(dependencies.transition).not.toHaveBeenCalled()
    expect(dependencies.start).not.toHaveBeenCalled()
  })

  it('refuses live launch while the global/provider configuration is disabled', async () => {
    configureEnvironment(false)
    const response = await launchCampaign(launchRequest(), { params: { id: campaignId } })
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('live_send_not_ready')
    expect(dependencies.transition).not.toHaveBeenCalled()
    expect(dependencies.start).not.toHaveBeenCalled()
  })

  it('fails closed when Meta cannot prove the exact APPROVED MARKETING template', async () => {
    dependencies.preflight.mockResolvedValue({
      ok: false,
      code: 'template_not_approved',
      message: 'The configured WhatsApp template is not APPROVED',
      retryable: false,
      status: 200,
    })

    const response = await launchCampaign(launchRequest(), { params: { id: campaignId } })
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe(
      'template_preflight_template_not_approved',
    )
    expect(dependencies.transition).not.toHaveBeenCalled()
    expect(dependencies.start).not.toHaveBeenCalled()
  })

  it('persists the approved transition before starting one fenced workflow per recipient', async () => {
    const response = await launchCampaign(launchRequest(), { params: { id: campaignId } })
    expect(response.status).toBe(202)
    expect(dependencies.transition).toHaveBeenCalledWith({
      campaignId,
      action: 'launch',
      actorId: 'giga:super_admin',
      sendEnabled: true,
      approvalSnapshotHash: snapshotHash,
      templateContractHash: 'b'.repeat(64),
    })
    expect(dependencies.preflight).toHaveBeenCalledWith({
      segment: 'old_lead',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
    })
    expect(dependencies.preflight.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.transition.mock.invocationCallOrder[0],
    )
    expect(dependencies.start).toHaveBeenCalledTimes(3)
    expect(dependencies.start).toHaveBeenNthCalledWith(
      1,
      dispatchMyHonorReactivationCampaignWorkflow,
      [{
        campaign_id: campaignId,
        already_dispatched_recipient_ids: [
          '00000000-0000-4000-8000-000000000101',
          '00000000-0000-4000-8000-000000000102',
        ],
      }],
    )
    expect(dependencies.start).toHaveBeenCalledWith(
      expect.any(Function),
      [{
        recipient_id: '00000000-0000-4000-8000-000000000101',
        not_before: '2026-08-25T10:00:00.000Z',
      }],
    )
    expect(dependencies.transition.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.start.mock.invocationCallOrder[0],
    )
    expect(await response.json()).toMatchObject({
      ok: true,
      campaign: { id: campaignId, state: 'running' },
      dispatcher: { started: true, run_id: 'wrun-reactivation' },
      dispatch: { requested: 2, scheduled: 2, failed: 0 },
    })
  })

  it('fails closed when the Meta template changed after human approval', async () => {
    dependencies.preflight.mockResolvedValue({
      ok: true,
      templateId: 'template-id-2',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      status: 'APPROVED',
      category: 'MARKETING',
      bodyParameterCount: 3,
      contractHash: 'c'.repeat(64),
    })

    const response = await launchCampaign(launchRequest(), { params: { id: campaignId } })
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe(
      'template_contract_changed_after_approval',
    )
    expect(dependencies.transition).not.toHaveBeenCalled()
    expect(dependencies.start).not.toHaveBeenCalled()
  })

  it('re-dispatches only still-queued recipients on an idempotent launch retry', async () => {
    dependencies.transition.mockResolvedValue({
      changed: false,
      state: 'running',
      reason: 'already_in_state',
      recipientJobs: [{
        recipientId: '00000000-0000-4000-8000-000000000103',
        runAt: '2026-08-25T10:00:00.000Z',
      }],
    })
    const response = await launchCampaign(launchRequest(), { params: { id: campaignId } })
    expect(response.status).toBe(202)
    expect(dependencies.start).toHaveBeenCalledTimes(2)
    expect(await response.json()).toMatchObject({
      ok: true,
      dispatch: { requested: 1, scheduled: 1, idempotent_retry: true },
    })
  })

  it('returns retryable failure and safely restarts after dispatcher start fails', async () => {
    dependencies.start.mockRejectedValueOnce(new Error('workflow unavailable'))
    const failed = await launchCampaign(launchRequest(), { params: { id: campaignId } })
    expect(failed.status).toBe(503)
    expect(await failed.json()).toMatchObject({
      ok: false,
      campaign: { id: campaignId, state: 'running' },
      error: { code: 'campaign_dispatcher_unavailable', retryable: true },
    })
    expect(dependencies.start).toHaveBeenCalledOnce()

    dependencies.start.mockResolvedValue({ runId: 'wrun-dispatcher-retry' })
    dependencies.transition.mockResolvedValue({
      changed: false,
      state: 'running',
      reason: 'already_in_state',
      recipientJobs: [],
    })
    const retried = await launchCampaign(launchRequest(), { params: { id: campaignId } })
    expect(retried.status).toBe(202)
    expect(await retried.json()).toMatchObject({
      ok: true,
      dispatcher: { started: true, run_id: 'wrun-dispatcher-retry' },
      dispatch: { idempotent_retry: true },
    })
  })
})

describe('GET /api/giga-admin/myhonor/reactivation/overview', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
    configureEnvironment()
    dependencies.actor.mockResolvedValue({ id: 'giga:super_admin', kind: 'break_glass' })
    dependencies.overview.mockResolvedValue({
      scope: 'global',
      campaign_states: { draft: 2, running: 1, customer_name: 'Алия' },
      recipient_states: {
        queued: 3,
        accepted: 1,
        delivered: 2,
        read: 1,
        excluded: 4,
        holdout: 5,
      },
      contacts: {
        total: 20,
        with_effective_consent: 12,
        globally_suppressed: 3,
        provider_marketing_limited: 1,
        phone_e164: '+77051234567',
      },
      exclusion_reasons: {
        missing_consent: 2,
        global_suppression: 1,
        application_ineligible: 1,
        'customer:+77051234567': 99,
      },
      contact_rows: [{ first_name: 'Алия', phone_e164: '+77051234567' }],
    })
    dependencies.listCampaigns.mockResolvedValue([])
  })

  it('requires giga-admin authorization before reading aggregates', async () => {
    dependencies.actor.mockResolvedValue(null)
    const response = await getReactivationOverview(overviewRequest())
    expect(response.status).toBe(403)
    expect(dependencies.overview).not.toHaveBeenCalled()
  })

  it('returns only allowlisted aggregate counts and strips unexpected PII', async () => {
    const response = await getReactivationOverview(overviewRequest())
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.overview).toEqual({
      campaign_count: 3,
      recipient_count: 16,
      queued_count: 3,
      accepted_count: 4,
      excluded_count: 4,
      holdout_count: 5,
      states: { draft: 2, running: 1 },
      contacts: {
        total: 20,
        with_effective_consent: 12,
        globally_suppressed: 3,
        provider_marketing_limited: 1,
      },
      exclusion_reasons: {
        missing_consent: 2,
        global_suppression: 1,
        application_ineligible: 1,
      },
    })
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('+77051234567')
    expect(serialized).not.toContain('Алия')
    expect(serialized).not.toContain('contact_rows')
  })

  it('fails closed when the aggregate contract contains invalid counts', async () => {
    dependencies.overview.mockResolvedValue({
      scope: 'global',
      campaign_states: {},
      recipient_states: {},
      contacts: {
        total: '20',
        with_effective_consent: 12,
        globally_suppressed: 3,
        provider_marketing_limited: 1,
      },
      exclusion_reasons: {},
    })
    const response = await getReactivationOverview(overviewRequest())
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('reactivation_store_unavailable')
  })
})

describe('processMyHonorReactivationRecipientWorkflow', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    dependencies.sleep.mockResolvedValue(undefined)
    dependencies.workflowMetadata.mockReturnValue({ workflowRunId: 'wrun-reactivation-42' })
    dependencies.processRecipient.mockResolvedValue({
      action: 'skipped',
      reason: 'recipient_not_claimable',
    })
  })

  it('durably waits for not_before before attempting the fenced recipient', async () => {
    const notBefore = '2099-08-25T10:00:00.000Z'
    const result = await processMyHonorReactivationRecipientWorkflow({
      recipient_id: '00000000-0000-4000-8000-000000000101',
      not_before: notBefore,
    })
    expect(dependencies.sleep).toHaveBeenCalledWith(new Date(notBefore))
    expect(dependencies.processRecipient).toHaveBeenCalledWith({
      recipientId: '00000000-0000-4000-8000-000000000101',
      ownerToken: 'workflow:wrun-reactivation-42',
    })
    expect(result).toEqual({ action: 'skipped', reason: 'recipient_not_claimable' })
    expect(dependencies.sleep.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.processRecipient.mock.invocationCallOrder[0],
    )
  })

  it('rejects an invalid not_before without claiming a recipient', async () => {
    await expect(processMyHonorReactivationRecipientWorkflow({
      recipient_id: '00000000-0000-4000-8000-000000000101',
      not_before: 'not-a-timestamp',
    })).rejects.toThrow('not_before must be a valid timestamp')
    expect(dependencies.processRecipient).not.toHaveBeenCalled()
  })
})

describe('dispatchMyHonorReactivationCampaignWorkflow', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    dependencies.sleep.mockResolvedValue(undefined)
    dependencies.workflowMetadata.mockReturnValue({ workflowRunId: 'wrun-dispatcher-42' })
    dependencies.start.mockResolvedValue({ runId: 'wrun-recipient-child' })
  })

  it('continues past the first 100 recipients and completes terminal work', async () => {
    dependencies.listReady
      .mockResolvedValueOnce(recipientJobs(1, 100))
      .mockResolvedValueOnce(recipientJobs(101, 1))
      .mockResolvedValueOnce([])
    dependencies.overview.mockResolvedValue({
      campaign: { state: 'running' },
      recipient_states: {},
    })
    dependencies.transition.mockResolvedValue({
      changed: true,
      state: 'completed',
      reason: 'ok',
      recipientJobs: [],
    })

    const result = await dispatchMyHonorReactivationCampaignWorkflow({
      campaign_id: campaignId,
    })
    expect(result).toMatchObject({
      state: 'completed',
      reason: 'completed',
      batches_read: 3,
      recipient_workflows_started: 101,
      truncated: false,
    })
    expect(dependencies.listReady).toHaveBeenCalledTimes(3)
    expect(dependencies.start).toHaveBeenCalledTimes(101)
  })

  it('waits until a future run_at before starting a child', async () => {
    const future = '2099-08-25T10:00:00.000Z'
    dependencies.listReady
      .mockResolvedValueOnce(recipientJobs(1, 1, future))
      .mockResolvedValueOnce([])
    dependencies.overview.mockResolvedValue({
      campaign: { state: 'running' },
      recipient_states: {},
    })
    dependencies.transition.mockResolvedValue({
      changed: true,
      state: 'completed',
      reason: 'ok',
      recipientJobs: [],
    })

    await dispatchMyHonorReactivationCampaignWorkflow({ campaign_id: campaignId })
    expect(dependencies.sleep).toHaveBeenNthCalledWith(1, new Date(future))
    expect(dependencies.sleep.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.start.mock.invocationCallOrder[0],
    )
  })

  it('starts one bounded recovery child when a previously dispatched record stays ready', async () => {
    const job = recipientJobs(1, 1, '2020-08-25T10:00:00.000Z')
    dependencies.listReady
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce([])
    dependencies.overview
      .mockResolvedValueOnce({
        campaign: { state: 'running' },
        recipient_states: { queued: 1 },
      })
      .mockResolvedValueOnce({
        campaign: { state: 'running' },
        recipient_states: { queued: 1 },
      })
      .mockResolvedValueOnce({
        campaign: { state: 'running' },
        recipient_states: {},
      })
    dependencies.transition.mockResolvedValue({
      changed: true,
      state: 'completed',
      reason: 'ok',
      recipientJobs: [],
    })

    const result = await dispatchMyHonorReactivationCampaignWorkflow({
      campaign_id: campaignId,
      already_dispatched_recipient_ids: [job[0].recipientId],
    })
    expect(result).toMatchObject({
      state: 'completed',
      recipient_workflows_started: 1,
    })
    expect(dependencies.start).toHaveBeenCalledOnce()
  })

  it('stops without scheduling or completing a paused campaign', async () => {
    dependencies.listReady.mockResolvedValue([])
    dependencies.overview.mockResolvedValue({
      campaign: { state: 'paused' },
      recipient_states: { queued: 10 },
    })
    const result = await dispatchMyHonorReactivationCampaignWorkflow({
      campaign_id: campaignId,
    })
    expect(result).toMatchObject({
      state: 'paused',
      reason: 'campaign_paused',
      truncated: false,
    })
    expect(dependencies.start).not.toHaveBeenCalled()
    expect(dependencies.transition).not.toHaveBeenCalled()
  })

  it('completes a running campaign only after queued and active counts reach zero', async () => {
    dependencies.listReady.mockResolvedValue([])
    dependencies.overview.mockResolvedValue({
      campaign: { state: 'running' },
      recipient_states: { queued: 0, leased: 0, authorized: 0, delivered: 7 },
    })
    dependencies.transition.mockResolvedValue({
      changed: true,
      state: 'completed',
      reason: 'ok',
      recipientJobs: [],
    })
    const result = await dispatchMyHonorReactivationCampaignWorkflow({
      campaign_id: campaignId,
    })
    expect(result).toMatchObject({ state: 'completed', reason: 'completed' })
    expect(dependencies.transition).toHaveBeenCalledWith({
      campaignId,
      action: 'complete',
      actorId: 'workflow:wrun-dispatcher-42',
    })
  })
})
