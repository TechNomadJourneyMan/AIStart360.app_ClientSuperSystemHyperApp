import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase-service'
import {
  contactPhoneHash,
  decryptContactValue,
  encryptContactValue,
  externalCustomerHash,
  maskPhone,
  normalizeE164,
} from './identity'
import { evaluateMyHonorReactivationEligibility } from './eligibility'
import { loadVerifiedMyHonorProducts } from './catalog'
import { nextMyHonorMarketingSendTime } from './policy'
import {
  myHonorRecommendationAffinityExclusion,
  recommendVerifiedMyHonorProducts,
} from './recommendations'
import { classifyMyHonorReactivationSegments } from './segmentation'
import {
  buildMyHonorApprovedTemplate,
  renderMyHonorTemplateBody,
} from './templates'
import { expectedMyHonorTemplateContractHash } from './template-preflight'
import {
  getMyHonorReactivationConfiguration,
  MYHONOR_OPAQUE_ID_PATTERN,
  myHonorCampaignDraftSchema,
  myHonorMarketingContactEventHash,
  normalizeMyHonorMarketingContactEvent,
  type MyHonorCampaignDraftInput,
  type MyHonorMarketingHoldReason,
  type MyHonorMarketingContactEvent,
  type MyHonorMarketingPurpose,
  type MyHonorReactivationConfiguration,
  type MyHonorReactivationInterest,
  type MyHonorReactivationSegment,
} from './types'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/

export type MyHonorReactivationCampaignState =
  | 'draft'
  | 'approved'
  | 'running'
  | 'paused'
  | 'completed'

export type MyHonorReactivationRecipientState =
  | 'preview'
  | 'holdout'
  | 'excluded'
  | 'queued'
  | 'leased'
  | 'authorized'
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'delivery_unknown'
  | 'cancelled'

export interface IngestedMyHonorMarketingContactEvent {
  id: string | null
  eventId: string
  created: boolean
  duplicate: boolean
  conflict: boolean
  consentState: 'granted' | 'revoked'
}

export interface MyHonorReactivationCampaignSummary {
  id: string
  name: string
  segment: string
  state: MyHonorReactivationCampaignState
  dryRun: boolean
  createdAt: string
  recipientCount: number
  queuedCount: number
  acceptedCount: number
  excludedCount: number
  holdoutCount: number
  previewSnapshotHash: string | null
  approvalSnapshotHash: string | null
  templateContractHash: string | null
}

export interface CreatedMyHonorReactivationCampaign {
  id: string
  state: MyHonorReactivationCampaignState
  dryRun: boolean
}

export interface MaterializedMyHonorReactivationCampaign {
  insertedCount: number
  queuedCount: number
  previewCount: number
  holdoutCount: number
  excludedCount: number
  previewSnapshotHash: string
}

export interface MyHonorReactivationTransition {
  changed: boolean
  state: MyHonorReactivationCampaignState
  reason: string
  recipientJobs: MyHonorReactivationRecipientJob[]
}

export interface MyHonorReactivationRecipientJob {
  recipientId: string
  runAt: string
}

export interface ClaimedMyHonorReactivationRecipient {
  id: string
  leaseToken: string
  campaignId: string
  contactId: string
  phoneCiphertext: string
  locale: string
  segment: MyHonorReactivationSegment
  templateName: string
  templateLanguage: string
  templateContractHash: string
  templateParametersHash: string
  templateParametersCiphertext: string
  recommendationSnapshot: Record<string, unknown>
  attempts: number
  maxAttempts: number
}

export interface FinishedMyHonorReactivationRecipient {
  accepted: boolean
  state: MyHonorReactivationRecipientState | null
  runAt: string | null
}

export interface MyHonorMaterializationCandidate {
  contact_id: string
  eligibility_snapshot: Record<string, unknown>
  eligibility_hash: string
  recommendation_snapshot: Record<string, unknown>
  recommendation_hash: string
  template_parameters_hash: string
  template_parameters_ciphertext: string
  run_at: string
}

export interface PreviewedMyHonorReactivationCampaign {
  campaign: {
    id: string
    state: MyHonorReactivationCampaignState
    dryRun: boolean
  }
  materialized: MaterializedMyHonorReactivationCampaign
  approvalSnapshotHash: string
  templateContractHash: string | null
  overview: Record<string, unknown>
}

export interface MyHonorReactivationRecipientPreview {
  id: string
  previewSnapshotHash: string
  phoneMasked: string
  locale: 'ru' | 'kk'
  state: MyHonorReactivationRecipientState
  exclusionReason: string | null
  holdout: boolean
  consent: Record<string, unknown>
  eligibility: Record<string, unknown>
  recommendation: Record<string, unknown>
  templateParametersHash: string
  templateParameters: string[]
  messagePreview: string | null
  runAt: string
}

export interface MyHonorReactivationOutboundContext {
  recipientId: string
  campaignId: string
  segment: MyHonorReactivationSegment
  templateName: string
  templateLanguage: string
  templateParametersCiphertext: string
  providerMessageId: string
  providerAcceptedAt: string
}

export class MyHonorReactivationAudienceTooLargeError extends Error {
  constructor(
    readonly total: number,
    readonly loaded: number,
  ) {
    super('MyHonor reactivation audience exceeds the safe preview limit')
    this.name = 'MyHonorReactivationAudienceTooLargeError'
  }
}

interface MyHonorCandidateContext {
  contactId: string
  locale: 'ru' | 'kk'
  phoneValidated: boolean
  cityCiphertext: string | null
  interests: MyHonorReactivationInterest[]
  sizeCiphertext: string | null
  budgetKzt: number | null
  clubStatus: 'member' | 'not_member' | 'unknown'
  customerKind: 'retail' | 'wholesale' | 'unknown'
  lifecycle: MyHonorMarketingContactEvent['lifecycle']
  sourceUpdatedAt: string
  effectiveConsent: Record<string, unknown>
  activeSuppressions: string[]
  manualHold: boolean
  marketingHoldReason: MyHonorMarketingHoldReason | null
  providerMarketingLimited: boolean
  cooldownUntil: string | null
  lastMarketingSentAt: string | null
  marketingSentLast30Days: number
  campaignDefinition: Record<string, unknown>
}

function databaseError(operation: string, error: { message?: string } | null): Error {
  return new Error(`${operation}: ${error?.message?.slice(0, 300) || 'database error'}`)
}

function record(value: unknown, operation: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${operation}: database returned an invalid row`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`myhonor reactivation database returned invalid ${field}`)
  }
  return value
}

function requiredUuid(value: unknown, field: string): string {
  const result = requiredString(value, field)
  if (!UUID_PATTERN.test(result)) {
    throw new Error(`myhonor reactivation database returned invalid ${field}`)
  }
  return result
}

function requiredInteger(value: unknown, field: string): number {
  const result = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`myhonor reactivation database returned invalid ${field}`)
  }
  return result
}

function requiredHash(value: unknown, field: string): string {
  const result = requiredString(value, field)
  if (!HASH.test(result)) {
    throw new Error(`myhonor reactivation database returned invalid ${field}`)
  }
  return result
}

function nullableTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  const raw = requiredString(value, field)
  const parsed = new Date(raw)
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`myhonor reactivation database returned invalid ${field}`)
  }
  return parsed.toISOString()
}

function timestamp(value: unknown, field: string): string {
  const result = nullableTimestamp(value, field)
  if (!result) throw new Error(`myhonor reactivation database returned invalid ${field}`)
  return result
}

function campaignState(value: unknown): MyHonorReactivationCampaignState {
  if (
    value === 'draft'
    || value === 'approved'
    || value === 'running'
    || value === 'paused'
    || value === 'completed'
  ) return value
  throw new Error('myhonor reactivation database returned invalid campaign state')
}

function recipientState(value: unknown): MyHonorReactivationRecipientState {
  if (
    value === 'preview'
    || value === 'holdout'
    || value === 'excluded'
    || value === 'queued'
    || value === 'leased'
    || value === 'authorized'
    || value === 'accepted'
    || value === 'sent'
    || value === 'delivered'
    || value === 'read'
    || value === 'failed'
    || value === 'delivery_unknown'
    || value === 'cancelled'
  ) return value
  throw new Error('myhonor reactivation database returned invalid recipient state')
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  return requiredString(value, field)
}

function nullableHash(value: unknown, field: string): string | null {
  const result = nullableString(value, field)
  if (result !== null && !HASH.test(result)) {
    throw new Error(`myhonor reactivation database returned invalid ${field}`)
  }
  return result
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`myhonor reactivation database returned invalid ${field}`)
  }
  return [...new Set(value as string[])]
}

function interestArray(value: unknown): MyHonorReactivationInterest[] {
  const permitted = new Set([
    'hunting', 'fishing', 'outdoor', 'mountains', 'tactical', 'footwear',
    'base_layer', 'accessories',
  ])
  const result = stringArray(value, 'interests')
  if (result.some((item) => !permitted.has(item))) {
    throw new Error('myhonor reactivation database returned invalid interests')
  }
  return result as MyHonorReactivationInterest[]
}

function marketingHoldReason(value: unknown): MyHonorMarketingHoldReason | null {
  if (value === null || value === undefined) return null
  if (
    value === 'open_order'
    || value === 'recent_cancel_or_return'
    || value === 'payment_unknown'
    || value === 'source_incomplete'
    || value === 'identity_conflict'
    || value === 'manual_review'
  ) return value
  throw new Error('myhonor reactivation database returned invalid marketing_hold_reason')
}

function optionalInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null
  return requiredInteger(value, field)
}

function jsonObjectOrNull(value: unknown, field: string): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  return record(value, field)
}

function candidateContext(value: unknown): MyHonorCandidateContext {
  const item = record(value, 'list myhonor candidate context')
  const locale = requiredString(item.locale, 'locale')
  if (locale !== 'ru' && locale !== 'kk') {
    throw new Error('myhonor reactivation database returned invalid locale')
  }
  const clubStatus = requiredString(item.club_status, 'club_status')
  if (!['member', 'not_member', 'unknown'].includes(clubStatus)) {
    throw new Error('myhonor reactivation database returned invalid club_status')
  }
  const customerKind = requiredString(item.customer_kind, 'customer_kind')
  if (!['retail', 'wholesale', 'unknown'].includes(customerKind)) {
    throw new Error('myhonor reactivation database returned invalid customer_kind')
  }
  const productIds = Array.isArray(item.last_order_product_ids)
    ? item.last_order_product_ids
    : []
  if (productIds.some((id) => typeof id !== 'string')) {
    throw new Error('myhonor reactivation database returned invalid last_order_product_ids')
  }
  const abandoned = jsonObjectOrNull(item.abandoned_cart, 'abandoned_cart')
  return {
    contactId: requiredUuid(item.contact_id, 'contact_id'),
    locale,
    phoneValidated: item.phone_validated === true,
    cityCiphertext: nullableString(item.city_ciphertext, 'city_ciphertext'),
    interests: interestArray(item.interests),
    sizeCiphertext: nullableString(item.size_ciphertext, 'size_ciphertext'),
    budgetKzt: optionalInteger(item.budget_kzt, 'budget_kzt'),
    clubStatus: clubStatus as MyHonorCandidateContext['clubStatus'],
    customerKind: customerKind as MyHonorCandidateContext['customerKind'],
    lifecycle: {
      registered_at: nullableTimestamp(item.registered_at, 'registered_at'),
      last_activity_at: nullableTimestamp(item.last_activity_at, 'last_activity_at'),
      last_order_at: nullableTimestamp(item.last_order_at, 'last_order_at'),
      order_count: requiredInteger(item.order_count, 'order_count'),
      lifetime_value_kzt: Number(item.lifetime_value_kzt ?? 0),
      last_order_product_ids: productIds as string[],
      abandoned_cart: abandoned as MyHonorMarketingContactEvent['lifecycle']['abandoned_cart'],
      club_interest: item.club_interest === true,
      back_in_stock_product_ids: Array.isArray(item.back_in_stock_product_ids)
        ? stringArray(item.back_in_stock_product_ids, 'back_in_stock_product_ids')
        : [],
      unresolved_complaint: item.unresolved_complaint === true,
      marketing_hold: item.marketing_hold === true,
      marketing_hold_reason: marketingHoldReason(item.marketing_hold_reason),
    },
    sourceUpdatedAt: timestamp(item.source_updated_at, 'source_updated_at'),
    effectiveConsent: record(item.effective_consent, 'effective_consent'),
    activeSuppressions: stringArray(item.active_suppressions, 'active_suppressions'),
    manualHold: item.manual_hold === true,
    marketingHoldReason: marketingHoldReason(item.marketing_hold_reason),
    providerMarketingLimited: item.provider_marketing_limited === true,
    cooldownUntil: nullableTimestamp(item.cooldown_until, 'cooldown_until'),
    lastMarketingSentAt: nullableTimestamp(
      item.last_marketing_sent_at,
      'last_marketing_sent_at',
    ),
    marketingSentLast30Days: requiredInteger(
      item.marketing_sent_last_30_days,
      'marketing_sent_last_30_days',
    ),
    campaignDefinition: record(item.campaign_definition, 'campaign_definition'),
  }
}

function campaignDraftFromDefinition(
  definition: Record<string, unknown>,
): MyHonorCampaignDraftInput {
  return myHonorCampaignDraftSchema.parse({
    name: definition.name,
    segment: definition.segment,
    interest: definition.interest ?? null,
    season: definition.season ?? null,
    inactivity_days: definition.inactivity_days,
    frequency_cap_days: definition.frequency_cap_days,
    monthly_cap: definition.monthly_cap,
    daily_limit: definition.daily_limit,
    holdout_percent: definition.holdout_percent,
    product_limit: definition.product_limit,
    dry_run: definition.dry_run,
    utm_campaign: definition.utm_campaign,
  })
}

function purpose(value: unknown): MyHonorMarketingPurpose {
  if (
    value === 'marketing_offers'
    || value === 'product_recommendations'
    || value === 'club_updates'
  ) return value
  throw new Error('myhonor reactivation database returned invalid campaign purpose')
}

function reactivationSegment(value: unknown): MyHonorReactivationSegment {
  if (
    value === 'old_lead'
    || value === 'abandoned_cart'
    || value === 'registered_no_order'
    || value === 'dormant_customer'
    || value === 'post_purchase'
    || value === 'seasonal'
    || value === 'club_interest'
    || value === 'back_in_stock'
  ) return value
  throw new Error('myhonor reactivation database returned invalid segment')
}

function consentForEligibility(
  context: MyHonorCandidateContext,
  campaignPurpose: MyHonorMarketingPurpose,
  now: Date,
): MyHonorMarketingContactEvent['consent'] {
  const source = context.effectiveConsent.source
  const acceptedSource = source === 'checkout_checkbox'
    || source === 'account_settings'
    || source === 'whatsapp_reply'
    || source === 'in_store'
    || source === 'import_verified'
      ? source
      : 'import_verified'
  const eligible = context.effectiveConsent.eligible === true
    && context.effectiveConsent.status === 'granted'
  return {
    status: eligible ? 'granted' : 'revoked',
    purposes: eligible ? [campaignPurpose] : [],
    source: acceptedSource,
    notice_version: typeof context.effectiveConsent.notice_version === 'string'
      && context.effectiveConsent.notice_version.trim()
      ? context.effectiveConsent.notice_version
      : 'missing-consent-notice',
    evidence_id: typeof context.effectiveConsent.consent_event_id === 'string'
      && UUID_PATTERN.test(context.effectiveConsent.consent_event_id)
      ? `myhonor:consent-event:${context.effectiveConsent.consent_event_id}`
      : 'myhonor:missing:00000000-0000-4000-8000-000000000000',
    obtained_at: eligible && typeof context.effectiveConsent.obtained_at === 'string'
      ? context.effectiveConsent.obtained_at
      : null,
    revoked_at: eligible ? null : now.toISOString(),
    cross_border_disclosed:
      context.effectiveConsent.cross_border_disclosed === true,
  }
}

function safeDecryptOptional(value: string | null, masterKey: string): string | null {
  if (!value) return null
  try {
    const result = decryptContactValue(value, masterKey).trim()
    return result || null
  } catch {
    return null
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`
}

export function myHonorSnapshotHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

export function myHonorReactivationActorHash(value: string): string {
  return createHash('sha256')
    .update(`aistart360:myhonor-reactivation:actor:${value}`)
    .digest('hex')
}

function encryptedContact(
  event: ReturnType<typeof normalizeMyHonorMarketingContactEvent>,
  configuration: MyHonorReactivationConfiguration,
): Record<string, unknown> {
  if (!configuration.masterKey || !configuration.companyId) {
    throw new Error('MyHonor reactivation ingestion is not configured')
  }
  const phone = normalizeE164(event.contact.phone_e164)
  const encrypted = (value: string | null): string | null =>
    value ? encryptContactValue(value, configuration.masterKey as string) : null
  return {
    external_customer_hash: externalCustomerHash(
      event.contact.external_customer_id,
      configuration.companyId,
      configuration.masterKey,
    ),
    phone_hash: contactPhoneHash(phone, configuration.masterKey),
    phone_ciphertext: encryptContactValue(phone, configuration.masterKey),
    phone_masked: maskPhone(phone),
    first_name_ciphertext: encrypted(event.contact.first_name),
    locale: event.contact.locale,
    city_ciphertext: encrypted(event.contact.city),
    interests: event.contact.interests,
    size_ciphertext: encrypted(event.contact.size),
    budget_kzt: event.contact.budget_kzt,
    club_status: event.contact.club_status,
    customer_kind: event.contact.customer_kind,
  }
}

function consentPayload(
  event: ReturnType<typeof normalizeMyHonorMarketingContactEvent>,
): Record<string, unknown> {
  return {
    status: event.consent.status,
    purposes: event.consent.purposes,
    source: event.consent.source,
    notice_version: event.consent.notice_version,
    evidence_hash: createHash('sha256')
      .update(event.consent.evidence_id)
      .digest('hex'),
    obtained_at: event.consent.obtained_at ?? null,
    revoked_at: event.consent.revoked_at ?? null,
    cross_border_disclosed: event.consent.cross_border_disclosed,
  }
}

export async function ingestMyHonorMarketingContactEvent(
  input: {
    event: MyHonorMarketingContactEvent
    idempotencyKey: string
    requestHash?: string
    configuration?: MyHonorReactivationConfiguration
  },
  client: SupabaseClient = createServiceClient(),
): Promise<IngestedMyHonorMarketingContactEvent> {
  const configuration = input.configuration ?? getMyHonorReactivationConfiguration()
  if (!configuration.ingestReady || !configuration.ownerUserId || !configuration.companyId) {
    throw new Error('MyHonor reactivation ingestion is not configured')
  }
  if (
    !MYHONOR_OPAQUE_ID_PATTERN.test(input.idempotencyKey)
    || input.idempotencyKey !== input.event.event_id
  ) {
    throw new Error('Idempotency-Key must equal event_id')
  }
  const event = normalizeMyHonorMarketingContactEvent(input.event)
  const requestHash = input.requestHash ?? myHonorMarketingContactEventHash(event)
  if (!HASH.test(requestHash)) throw new Error('requestHash must be SHA-256')

  const { data, error } = await client.rpc('ingest_myhonor_reactivation_contact_event', {
    p_user_id: configuration.ownerUserId,
    p_company_id: configuration.companyId,
    p_event_id: event.event_id,
    p_event_hash: requestHash,
    p_source_version: event.source_version,
    p_occurred_at: event.occurred_at,
    p_encrypted_contact: encryptedContact(event, configuration),
    p_lifecycle: event.lifecycle,
    p_consent: consentPayload(event),
  }).maybeSingle()
  if (error) throw databaseError('ingest myhonor reactivation contact event', error)
  const row = record(data, 'ingest myhonor reactivation contact event')
  const result = requiredString(row.ingest_result, 'ingest_result')
  if (![
    'created', 'updated', 'stale_profile', 'revoked', 'duplicate', 'conflict',
  ].includes(result)) {
    throw new Error('myhonor reactivation database returned invalid ingest_result')
  }
  const conflict = row.conflict === true
  const duplicate = row.duplicate === true
  return {
    id: row.contact_id === null || row.contact_id === undefined
      ? null
      : requiredUuid(row.contact_id, 'contact_id'),
    eventId: event.event_id,
    created: !duplicate && !conflict,
    duplicate,
    conflict,
    consentState: event.consent.status,
  }
}

export async function listMyHonorReactivationCampaigns(
  input: { limit?: number; offset?: number; configuration?: MyHonorReactivationConfiguration } = {},
  client: SupabaseClient = createServiceClient(),
): Promise<MyHonorReactivationCampaignSummary[]> {
  const configuration = input.configuration ?? getMyHonorReactivationConfiguration()
  if (!configuration.ownerUserId || !configuration.companyId) return []
  const limit = Math.min(100, Math.max(1, input.limit ?? 50))
  const offset = Math.max(0, input.offset ?? 0)
  const { data, error } = await client.rpc('list_myhonor_reactivation_campaigns', {
    p_user_id: configuration.ownerUserId,
    p_company_id: configuration.companyId,
    p_limit: Math.min(100, limit + offset),
  })
  if (error) throw databaseError('list myhonor reactivation campaigns', error)
  return ((data ?? []) as unknown[]).slice(offset, offset + limit).map((value) => {
    const row = record(value, 'list myhonor reactivation campaigns')
    return {
      id: requiredUuid(row.campaign_id, 'campaign_id'),
      name: requiredString(row.name, 'name'),
      segment: requiredString(row.segment, 'segment'),
      state: campaignState(row.campaign_state),
      dryRun: row.dry_run === true,
      createdAt: timestamp(row.created_at, 'created_at'),
      recipientCount: requiredInteger(row.recipient_count, 'recipient_count'),
      queuedCount: requiredInteger(row.queued_count, 'queued_count'),
      acceptedCount: requiredInteger(row.accepted_count, 'accepted_count'),
      excludedCount: requiredInteger(row.excluded_count, 'excluded_count'),
      holdoutCount: requiredInteger(row.holdout_count, 'holdout_count'),
      previewSnapshotHash: nullableHash(row.preview_snapshot_hash, 'preview_snapshot_hash'),
      approvalSnapshotHash: nullableHash(row.approval_snapshot_hash, 'approval_snapshot_hash'),
      templateContractHash: nullableHash(row.template_contract_hash, 'template_contract_hash'),
    }
  })
}

export async function getMyHonorReactivationOverview(
  input: { campaignId?: string | null; configuration?: MyHonorReactivationConfiguration } = {},
  client: SupabaseClient = createServiceClient(),
): Promise<Record<string, unknown>> {
  const configuration = input.configuration ?? getMyHonorReactivationConfiguration()
  if (!configuration.ownerUserId || !configuration.companyId) {
    return { configured: false, campaigns: 0, recipients: {} }
  }
  if (input.campaignId && !UUID_PATTERN.test(input.campaignId)) {
    throw new Error('campaignId must be a UUID')
  }
  const { data, error } = await client.rpc('get_myhonor_reactivation_campaign_overview', {
    p_user_id: configuration.ownerUserId,
    p_company_id: configuration.companyId,
    p_campaign_id: input.campaignId ?? null,
  })
  if (error) throw databaseError('get myhonor reactivation overview', error)
  return record(data, 'get myhonor reactivation overview')
}

export async function createMyHonorReactivationCampaign(
  input: {
    draft: MyHonorCampaignDraftInput
    createdBy: string
    configuration?: MyHonorReactivationConfiguration
  },
  client: SupabaseClient = createServiceClient(),
): Promise<CreatedMyHonorReactivationCampaign> {
  const configuration = input.configuration ?? getMyHonorReactivationConfiguration()
  if (!configuration.ownerUserId || !configuration.companyId) {
    throw new Error('MyHonor reactivation campaign storage is not configured')
  }
  const draft = myHonorCampaignDraftSchema.parse(input.draft)
  if (!draft.dry_run && !configuration.sendReady) {
    throw new Error('MyHonor live reactivation provider is not ready')
  }
  const definition = {
    ...draft,
    interest: draft.interest ?? null,
    season: draft.season ?? null,
    template_name: configuration.templates[draft.segment],
    template_language: configuration.templateLanguage,
  }
  const { data, error } = await client.rpc('create_myhonor_reactivation_campaign', {
    p_user_id: configuration.ownerUserId,
    p_company_id: configuration.companyId,
    p_definition: definition,
    p_actor_hash: myHonorReactivationActorHash(input.createdBy),
  }).maybeSingle()
  if (error) throw databaseError('create myhonor reactivation campaign', error)
  const row = record(data, 'create myhonor reactivation campaign')
  return {
    id: requiredUuid(row.campaign_id, 'campaign_id'),
    state: campaignState(row.campaign_state),
    dryRun: row.dry_run === true,
  }
}

export async function materializeMyHonorReactivationCampaign(
  input: {
    campaignId: string
    candidates: MyHonorMaterializationCandidate[]
    actorId: string
    templateContractHash: string | null
  },
  client: SupabaseClient = createServiceClient(),
): Promise<MaterializedMyHonorReactivationCampaign> {
  if (!UUID_PATTERN.test(input.campaignId)) throw new Error('campaignId must be a UUID')
  if (input.templateContractHash !== null && !HASH.test(input.templateContractHash)) {
    throw new Error('templateContractHash must be SHA-256')
  }
  const { data, error } = await client.rpc('materialize_myhonor_reactivation_campaign', {
    p_campaign_id: input.campaignId,
    p_candidates: input.candidates,
    p_actor_hash: myHonorReactivationActorHash(input.actorId),
    p_template_contract_hash: input.templateContractHash,
  }).maybeSingle()
  if (error) throw databaseError('materialize myhonor reactivation campaign', error)
  const row = record(data, 'materialize myhonor reactivation campaign')
  return {
    insertedCount: requiredInteger(row.inserted_count, 'inserted_count'),
    queuedCount: requiredInteger(row.queued_count, 'queued_count'),
    previewCount: requiredInteger(row.preview_count, 'preview_count'),
    holdoutCount: requiredInteger(row.holdout_count, 'holdout_count'),
    excludedCount: requiredInteger(row.excluded_count, 'excluded_count'),
    previewSnapshotHash: (() => {
      const value = requiredString(row.preview_snapshot_hash, 'preview_snapshot_hash')
      if (!HASH.test(value)) {
        throw new Error('myhonor reactivation database returned invalid preview_snapshot_hash')
      }
      return value
    })(),
  }
}

async function listMyHonorReactivationCandidateContexts(
  input: {
    campaignId: string
    limit?: number
    configuration: MyHonorReactivationConfiguration
  },
  client: SupabaseClient,
): Promise<MyHonorCandidateContext[]> {
  if (!UUID_PATTERN.test(input.campaignId)) throw new Error('campaignId must be a UUID')
  if (!input.configuration.ownerUserId || !input.configuration.companyId) {
    throw new Error('MyHonor reactivation candidate storage is not configured')
  }
  const { data, error } = await client.rpc(
    'list_myhonor_reactivation_candidate_context',
    {
      p_user_id: input.configuration.ownerUserId,
      p_company_id: input.configuration.companyId,
      p_campaign_id: input.campaignId,
      p_limit: Math.min(5_000, Math.max(1, input.limit ?? 5_000)),
    },
  )
  if (error) throw databaseError('list myhonor reactivation candidate context', error)
  const rows = (data ?? []) as unknown[]
  const total = rows.length === 0
    ? 0
    : requiredInteger(
        record(rows[0], 'list myhonor candidate context').total_count,
        'total_count',
      )
  if (total > rows.length) {
    throw new MyHonorReactivationAudienceTooLargeError(total, rows.length)
  }
  return rows.map(candidateContext)
}

export async function getMyHonorReactivationCampaignDefinition(
  input: {
    campaignId: string
    configuration: MyHonorReactivationConfiguration
  },
  client: SupabaseClient = createServiceClient(),
): Promise<Record<string, unknown> | null> {
  if (!UUID_PATTERN.test(input.campaignId)) throw new Error('campaignId must be a UUID')
  if (!input.configuration.ownerUserId || !input.configuration.companyId) {
    throw new Error('MyHonor reactivation campaign storage is not configured')
  }
  const { data, error } = await client.rpc(
    'get_myhonor_reactivation_campaign_definition',
    {
      p_user_id: input.configuration.ownerUserId,
      p_company_id: input.configuration.companyId,
      p_campaign_id: input.campaignId,
    },
  )
  if (error) throw databaseError('get myhonor reactivation campaign definition', error)
  return data === null || data === undefined
    ? null
    : record(data, 'get myhonor reactivation campaign definition')
}

function campaignMatchesContext(
  context: MyHonorCandidateContext,
  draft: MyHonorCampaignDraftInput,
  consent: MyHonorMarketingContactEvent['consent'],
  now: Date,
): { matched: boolean; reasons: string[] } {
  const backInStockProductIds = context.lifecycle.back_in_stock_product_ids
  const normalizedEvent = normalizeMyHonorMarketingContactEvent({
    schema_version: 1,
    event_id: `myhonor:preview:${context.contactId}`,
    source_version: 1,
    occurred_at: now.toISOString(),
    contact: {
      external_customer_id: context.contactId,
      // The ingestion RPC has already validated and encrypted E.164. Pure
      // segmentation never consumes its value, so no PII is decrypted here.
      phone_e164: context.phoneValidated ? '+10000000' : '+00000000',
      first_name: null,
      locale: context.locale,
      city: null,
      interests: context.interests,
      size: null,
      budget_kzt: context.budgetKzt,
      club_status: context.clubStatus,
      customer_kind: context.customerKind,
    },
    lifecycle: context.lifecycle,
    consent,
  })
  const matches = classifyMyHonorReactivationSegments(normalizedEvent, {
    now,
    signals: {
      clubInterest: context.lifecycle.club_interest
        && draft.segment === 'club_interest'
        && consent.status === 'granted'
        && consent.purposes.includes('club_updates'),
      backInStockProductIds: draft.segment === 'back_in_stock'
        ? backInStockProductIds
        : [],
      seasonalCampaignActive: draft.segment === 'seasonal',
      seasonalInterests: draft.interest ? [draft.interest] : context.interests,
    },
    thresholds: {
      oldLeadAfterDays: draft.inactivity_days,
      registeredNoOrderAfterDays: Math.min(draft.inactivity_days, 30),
      dormantAfterDays: draft.inactivity_days,
      postPurchaseFromDays: 14,
      postPurchaseToDays: Math.max(45, draft.inactivity_days),
    },
  })
  const match = matches.find((item) => item.segment === draft.segment)
  return { matched: Boolean(match), reasons: match?.reasons ?? [] }
}

export async function previewMyHonorReactivationCampaign(
  input: {
    campaignId: string
    actorId: string
    limit?: number
    now?: Date
    configuration?: MyHonorReactivationConfiguration
  },
  client: SupabaseClient = createServiceClient(),
): Promise<PreviewedMyHonorReactivationCampaign> {
  const configuration = input.configuration ?? getMyHonorReactivationConfiguration()
  if (!configuration.masterKey || !configuration.ownerUserId || !configuration.companyId) {
    throw new Error('MyHonor reactivation preview is not configured')
  }
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new Error('now must be a valid date')
  const definition = await getMyHonorReactivationCampaignDefinition({
    campaignId: input.campaignId,
    configuration,
  }, client)
  if (!definition) throw new Error('MyHonor reactivation campaign was not found')
  const contexts = await listMyHonorReactivationCandidateContexts({
    campaignId: input.campaignId,
    limit: input.limit,
    configuration,
  }, client)
  const draft = campaignDraftFromDefinition(definition)
  const campaignId = requiredUuid(
    definition.id,
    'campaign_definition.id',
  )
  if (campaignId !== input.campaignId) throw new Error('campaign context mismatch')
  const state = campaignState(definition.state)
  if (state !== 'draft') throw new Error('only draft campaigns can be previewed')
  const campaignPurpose = purpose(definition.purpose)
  const templateName = nullableString(
    definition.template_name,
    'template_name',
  ) ?? configuration.templates[draft.segment]
  const templateLanguage = nullableString(
    definition.template_language,
    'template_language',
  ) ?? configuration.templateLanguage
  const templateContractHash = templateName && templateLanguage
    ? expectedMyHonorTemplateContractHash({
        segment: draft.segment,
        templateName,
        languageCode: templateLanguage,
      })
    : null
  if (templateName && templateLanguage && !templateContractHash) {
    throw new Error('approved template contract is invalid')
  }
  const products = campaignPurpose === 'product_recommendations'
    ? await loadVerifiedMyHonorProducts({ configuration, now }, client)
    : []
  const candidates: MyHonorMaterializationCandidate[] = []

  for (const context of contexts) {
    if (requiredUuid(context.campaignDefinition.id, 'campaign_definition.id') !== campaignId) {
      throw new Error('candidate campaign context mismatch')
    }
    const consent = consentForEligibility(context, campaignPurpose, now)
    const eligibility = evaluateMyHonorReactivationEligibility({
      segment: draft.segment,
      phoneE164: context.phoneValidated ? '+10000000' : '+00000000',
      consent,
      suppressed: context.activeSuppressions.length > 0,
      optedOut: context.activeSuppressions.some((reason) =>
        /opt.?out|unsubscribe|customer_request|revoked/i.test(reason),
      ),
      unresolvedComplaint: context.lifecycle.unresolved_complaint,
      manualHold: context.manualHold || context.customerKind === 'wholesale',
      sourceUpdatedAt: context.sourceUpdatedAt,
      providerMarketingLimited: context.providerMarketingLimited,
      cooldownUntil: context.cooldownUntil,
      lastMarketingSentAt: context.lastMarketingSentAt,
      marketingSentLast30Days: context.marketingSentLast30Days,
      frequencyCapDays: draft.frequency_cap_days,
      monthlyCap: draft.monthly_cap,
      now,
    })
    const segment = campaignMatchesContext(context, draft, consent, now)
    const city = safeDecryptOptional(context.cityCiphertext, configuration.masterKey)
    const size = safeDecryptOptional(context.sizeCiphertext, configuration.masterKey)
    const backInStockProductIds = context.lifecycle.back_in_stock_product_ids
    const abandonedCartProductIds = context.lifecycle.abandoned_cart?.active
      ? context.lifecycle.abandoned_cart.product_ids
      : []
    const recommendationInterests = draft.interest
      ? [draft.interest]
      : context.interests
    const personalizationExclusion = myHonorRecommendationAffinityExclusion({
      segment: draft.segment,
      campaignInterest: draft.interest ?? null,
      contactInterests: context.interests,
    })
    const recommendations = campaignPurpose === 'product_recommendations'
      && !personalizationExclusion
      ? recommendVerifiedMyHonorProducts({
          products,
          profile: {
            interests: recommendationInterests,
            seasons: draft.season ? [draft.season] : [],
            size,
            budgetKzt: context.budgetKzt,
            city,
          },
          limit: draft.product_limit,
          now,
          excludeProductIds: context.lifecycle.last_order_product_ids,
          requiredProductIds: draft.segment === 'back_in_stock'
            ? backInStockProductIds
            : draft.segment === 'abandoned_cart'
              ? abandonedCartProductIds
              : [],
          requireCityStock: false,
        })
      : []
    const template = templateName && templateLanguage
      ? buildMyHonorApprovedTemplate({
          segment: draft.segment,
          templateName,
          languageCode: templateLanguage,
          locale: context.locale,
          recommendations,
          catalogUrl: 'https://myhonor.shop/catalog',
          clubInviteUrl:
            'https://chat.whatsapp.com/JDaVNsnloFMF0RpOtLSDRW?mode=gi_t',
          utmCampaign: draft.utm_campaign,
          season: draft.season ?? null,
        })
      : null
    const exclusions: string[] = [...eligibility.exclusions]
    if (!segment.matched) exclusions.push('segment_not_matched')
    if (context.locale !== templateLanguage) {
      exclusions.push('template_locale_mismatch')
    }
    if (
      campaignPurpose === 'product_recommendations'
      && personalizationExclusion
    ) {
      exclusions.push(personalizationExclusion)
    } else if (
      campaignPurpose === 'product_recommendations'
      && recommendations.length === 0
    ) {
      exclusions.push('no_verified_recommendation')
    }
    if (!template) exclusions.push('approved_template_unavailable')
    const uniqueExclusions = [...new Set(exclusions)]
    const eligibilitySnapshot = {
      eligible: uniqueExclusions.length === 0,
      segment_match: segment.matched,
      segment: draft.segment,
      segment_reasons: segment.reasons,
      required_purpose: eligibility.requiredPurpose,
      marketing_hold_reason: context.marketingHoldReason,
      source_updated_at: context.sourceUpdatedAt,
      exclusions: uniqueExclusions,
      evaluated_at: now.toISOString(),
    }
    const recommendationSnapshot = {
      product_ids: recommendations.map((item) => item.productId),
      products: recommendations,
      template: template
        ? {
            name: template.templateName,
            language: template.languageCode,
            parameter_contract: template.parameterContract,
            ctas: template.ctas,
          }
        : null,
      catalog_source: 'myhonor.shop',
      generated_at: now.toISOString(),
    }
    const runAt = nextMyHonorMarketingSendTime(now)
    const templateParameters = template?.bodyParameters ?? []
    candidates.push({
      contact_id: context.contactId,
      eligibility_snapshot: eligibilitySnapshot,
      eligibility_hash: myHonorSnapshotHash(eligibilitySnapshot),
      recommendation_snapshot: recommendationSnapshot,
      recommendation_hash: myHonorSnapshotHash(recommendationSnapshot),
      template_parameters_hash: myHonorSnapshotHash(templateParameters),
      template_parameters_ciphertext: encryptContactValue(
        JSON.stringify(templateParameters),
        configuration.masterKey,
      ),
      run_at: runAt.toISOString(),
    })
  }

  const materialized = await materializeMyHonorReactivationCampaign({
    campaignId,
    candidates,
    actorId: input.actorId,
    templateContractHash,
  }, client)
  const overview = await getMyHonorReactivationOverview({
    campaignId,
    configuration,
  }, client)
  const approvalSnapshotHash = materialized.previewSnapshotHash
  return {
    campaign: { id: campaignId, state, dryRun: draft.dry_run },
    materialized,
    approvalSnapshotHash,
    templateContractHash,
    overview,
  }
}

function decryptedTemplateParameters(value: unknown, masterKey: string): string[] {
  const ciphertext = requiredString(value, 'template_parameters_ciphertext')
  let parsed: unknown
  try {
    parsed = JSON.parse(decryptContactValue(ciphertext, masterKey)) as unknown
  } catch {
    throw new Error('myhonor reactivation database returned invalid template parameters')
  }
  if (
    !Array.isArray(parsed)
    || parsed.length > 20
    || parsed.some((item) =>
      typeof item !== 'string'
      || item !== item.trim()
      || item.length < 1
      || item.length > 1_024,
    )
  ) {
    throw new Error('myhonor reactivation database returned invalid template parameters')
  }
  return parsed as string[]
}

export async function listMyHonorReactivationRecipientPreviews(
  input: {
    campaignId: string
    limit?: number
    offset?: number
    expectedSnapshotHash?: string | null
    configuration?: MyHonorReactivationConfiguration
  },
  client: SupabaseClient = createServiceClient(),
): Promise<MyHonorReactivationRecipientPreview[]> {
  if (!UUID_PATTERN.test(input.campaignId)) throw new Error('campaignId must be a UUID')
  const configuration = input.configuration ?? getMyHonorReactivationConfiguration()
  if (!configuration.ownerUserId || !configuration.companyId || !configuration.masterKey) {
    throw new Error('MyHonor reactivation preview storage is not configured')
  }
  const masterKey = configuration.masterKey
  if (input.expectedSnapshotHash && !HASH.test(input.expectedSnapshotHash)) {
    throw new Error('expectedSnapshotHash must be SHA-256')
  }
  if (
    input.offset !== undefined
    && (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 10_000)
  ) {
    throw new Error('offset must be an integer from 0 to 10000')
  }
  const { data, error } = await client.rpc(
    'list_myhonor_reactivation_recipient_previews',
    {
      p_user_id: configuration.ownerUserId,
      p_company_id: configuration.companyId,
      p_campaign_id: input.campaignId,
      p_limit: Math.min(500, Math.max(1, input.limit ?? 100)),
      p_offset: input.offset ?? 0,
    },
  )
  if (error) throw databaseError('list myhonor reactivation recipient previews', error)
  return ((data ?? []) as unknown[]).map((value) => {
    const row = record(value, 'list myhonor reactivation recipient previews')
    const previewSnapshotHash = requiredString(
      row.preview_snapshot_hash,
      'preview_snapshot_hash',
    )
    if (!HASH.test(previewSnapshotHash)) {
      throw new Error('myhonor reactivation database returned invalid preview_snapshot_hash')
    }
    if (
      input.expectedSnapshotHash
      && previewSnapshotHash !== input.expectedSnapshotHash
    ) {
      throw new Error('MyHonor recipient preview revision does not match')
    }
    const locale = requiredString(row.locale, 'locale')
    if (locale !== 'ru' && locale !== 'kk') {
      throw new Error('myhonor reactivation database returned invalid locale')
    }
    const phoneMasked = requiredString(row.phone_masked, 'phone_masked')
    if (!/^\+[0-9]{1,3}•{4,10}[0-9]{4}$/.test(phoneMasked)) {
      throw new Error('myhonor reactivation database returned invalid phone_masked')
    }
    const templateParameters = decryptedTemplateParameters(
      row.template_parameters_ciphertext,
      masterKey,
    )
    const templateParametersHash = requiredHash(
      row.template_parameters_hash,
      'template_parameters_hash',
    )
    if (myHonorSnapshotHash(templateParameters) !== templateParametersHash) {
      throw new Error('MyHonor recipient preview template parameters do not match')
    }
    const eligibility = record(row.eligibility_snapshot, 'eligibility_snapshot')
    const state = recipientState(row.recipient_state)
    // Excluded recipients never receive a message, so the operator view must
    // not try to render copy in an unsupported contact locale. In particular,
    // a `kk` contact is excluded while only the exact RU Meta contract exists.
    const messagePreview = state === 'excluded'
      ? null
      : renderMyHonorTemplateBody(
          reactivationSegment(eligibility.segment),
          locale,
          templateParameters,
        )
    const intentionallyEmptyExcludedPreview = templateParameters.length === 0
      && (state === 'excluded' || state === 'holdout')
    if (
      !messagePreview
      && state !== 'excluded'
      && !intentionallyEmptyExcludedPreview
    ) {
      throw new Error('MyHonor recipient preview message contract is invalid')
    }
    return {
      id: requiredUuid(row.recipient_id, 'recipient_id'),
      previewSnapshotHash,
      phoneMasked,
      locale,
      state,
      exclusionReason: nullableString(row.exclusion_reason, 'exclusion_reason'),
      holdout: row.is_holdout === true,
      consent: record(row.consent_snapshot, 'consent_snapshot'),
      eligibility,
      recommendation: record(row.recommendation_snapshot, 'recommendation_snapshot'),
      templateParametersHash,
      templateParameters,
      messagePreview,
      runAt: timestamp(row.run_at, 'run_at'),
    }
  })
}

export async function getMyHonorReactivationOutboundContext(
  input: {
    recipientId: string
    configuration?: MyHonorReactivationConfiguration
  },
  client: SupabaseClient = createServiceClient(),
): Promise<MyHonorReactivationOutboundContext | null> {
  if (!UUID_PATTERN.test(input.recipientId)) throw new Error('recipientId must be a UUID')
  const configuration = input.configuration ?? getMyHonorReactivationConfiguration()
  if (!configuration.ownerUserId || !configuration.companyId) return null
  const { data, error } = await client.rpc(
    'get_myhonor_reactivation_outbound_context',
    {
      p_user_id: configuration.ownerUserId,
      p_company_id: configuration.companyId,
      p_recipient_id: input.recipientId,
    },
  ).maybeSingle()
  if (error) throw databaseError('get myhonor reactivation outbound context', error)
  if (!data) return null
  const row = record(data, 'get myhonor reactivation outbound context')
  return {
    recipientId: requiredUuid(row.recipient_id, 'recipient_id'),
    campaignId: requiredUuid(row.campaign_id, 'campaign_id'),
    segment: reactivationSegment(row.segment),
    templateName: requiredString(row.template_name, 'template_name'),
    templateLanguage: requiredString(row.template_language, 'template_language'),
    templateParametersCiphertext: requiredString(
      row.template_parameters_ciphertext,
      'template_parameters_ciphertext',
    ),
    providerMessageId: requiredString(row.provider_message_id, 'provider_message_id'),
    providerAcceptedAt: timestamp(row.provider_accepted_at, 'provider_accepted_at'),
  }
}

export async function transitionMyHonorReactivationCampaign(
  input: {
    campaignId: string
    action: 'approve' | 'launch' | 'pause' | 'complete'
    actorId: string
    sendEnabled?: boolean
    approvalSnapshotHash?: string | null
    templateContractHash?: string | null
  },
  client: SupabaseClient = createServiceClient(),
): Promise<MyHonorReactivationTransition> {
  if (!UUID_PATTERN.test(input.campaignId)) throw new Error('campaignId must be a UUID')
  const target = input.action === 'approve'
    ? 'approved'
    : input.action === 'launch'
      ? 'running'
      : input.action === 'pause'
        ? 'paused'
        : 'completed'
  if (target === 'running' && input.sendEnabled !== true) {
    return {
      changed: false,
      state: 'approved',
      reason: 'global_send_disabled',
      recipientJobs: [],
    }
  }
  if (input.approvalSnapshotHash && !HASH.test(input.approvalSnapshotHash)) {
    throw new Error('approvalSnapshotHash must be SHA-256')
  }
  if (input.templateContractHash && !HASH.test(input.templateContractHash)) {
    throw new Error('templateContractHash must be SHA-256')
  }
  if ((target === 'approved' || target === 'running') && !input.templateContractHash) {
    throw new Error('templateContractHash is required for approval and launch')
  }
  const { data, error } = await client.rpc('transition_myhonor_reactivation_campaign', {
    p_campaign_id: input.campaignId,
    p_target_state: target,
    p_actor_hash: myHonorReactivationActorHash(input.actorId),
    p_approval_snapshot_hash: input.approvalSnapshotHash ?? null,
    p_template_contract_hash: input.templateContractHash ?? null,
  }).maybeSingle()
  if (error) throw databaseError('transition myhonor reactivation campaign', error)
  const row = record(data, 'transition myhonor reactivation campaign')
  const state = campaignState(row.campaign_state)
  let recipientJobs: MyHonorReactivationRecipientJob[] = []
  if (state === 'running') {
    recipientJobs = await listReadyMyHonorReactivationRecipientJobs({
      campaignId: input.campaignId,
      limit: 100,
    }, client)
  }
  return {
    changed: row.changed === true,
    state,
    reason: requiredString(row.reason, 'reason'),
    recipientJobs,
  }
}

export async function listReadyMyHonorReactivationRecipientJobs(
  input: {
    campaignId: string
    limit?: number
    configuration?: MyHonorReactivationConfiguration
  },
  client: SupabaseClient = createServiceClient(),
): Promise<MyHonorReactivationRecipientJob[]> {
  if (!UUID_PATTERN.test(input.campaignId)) throw new Error('campaignId must be a UUID')
  const configuration = input.configuration ?? getMyHonorReactivationConfiguration()
  if (!configuration.ownerUserId || !configuration.companyId) return []
  const { data, error } = await client.rpc('list_ready_myhonor_reactivation_recipients', {
    p_user_id: configuration.ownerUserId,
    p_company_id: configuration.companyId,
    p_campaign_id: input.campaignId,
    p_limit: Math.min(100, Math.max(1, input.limit ?? 100)),
  })
  if (error) throw databaseError('list ready myhonor reactivation recipients', error)
  return ((data ?? []) as unknown[]).map((value) => {
    const row = record(value, 'list ready recipients')
    return {
      recipientId: requiredUuid(row.recipient_id, 'recipient_id'),
      runAt: timestamp(row.run_at, 'run_at'),
    }
  })
}

export async function claimMyHonorReactivationRecipient(
  input: { recipientId: string; ownerToken: string; leaseSeconds?: number },
  client: SupabaseClient = createServiceClient(),
): Promise<ClaimedMyHonorReactivationRecipient | null> {
  if (!UUID_PATTERN.test(input.recipientId)) throw new Error('recipientId must be a UUID')
  const { data, error } = await client.rpc('claim_myhonor_reactivation_recipient', {
    p_recipient_id: input.recipientId,
    p_owner_token: input.ownerToken,
    p_lease_seconds: input.leaseSeconds ?? 120,
  }).maybeSingle()
  if (error) throw databaseError('claim myhonor reactivation recipient', error)
  if (!data) return null
  const row = record(data, 'claim myhonor reactivation recipient')
  const recommendation = record(row.recommendation_snapshot, 'recommendation snapshot')
  return {
    id: requiredUuid(row.recipient_id, 'recipient_id'),
    leaseToken: requiredUuid(row.lease_token, 'lease_token'),
    campaignId: requiredUuid(row.campaign_id, 'campaign_id'),
    contactId: requiredUuid(row.contact_id, 'contact_id'),
    phoneCiphertext: requiredString(row.phone_ciphertext, 'phone_ciphertext'),
    locale: requiredString(row.locale, 'locale'),
    segment: reactivationSegment(row.segment),
    templateName: requiredString(row.template_name, 'template_name'),
    templateLanguage: requiredString(row.template_language, 'template_language'),
    templateContractHash: requiredHash(
      row.template_contract_hash,
      'template_contract_hash',
    ),
    templateParametersHash: requiredHash(
      row.template_parameters_hash,
      'template_parameters_hash',
    ),
    templateParametersCiphertext: requiredString(
      row.template_parameters_ciphertext,
      'template_parameters_ciphertext',
    ),
    recommendationSnapshot: recommendation,
    attempts: requiredInteger(row.attempts, 'attempts'),
    maxAttempts: requiredInteger(row.max_attempts, 'max_attempts'),
  }
}

export async function authorizeMyHonorReactivationRecipient(
  input: { recipientId: string; leaseToken: string; ownerToken: string; leaseSeconds?: number },
  client: SupabaseClient = createServiceClient(),
): Promise<{
  authorized: boolean
  reason: string
  providerAttemptId: string | null
  nextRunAt: string | null
}> {
  const { data, error } = await client.rpc('authorize_myhonor_reactivation_recipient', {
    p_recipient_id: input.recipientId,
    p_lease_token: input.leaseToken,
    p_owner_token: input.ownerToken,
    p_lease_seconds: input.leaseSeconds ?? 120,
  }).maybeSingle()
  if (error) throw databaseError('authorize myhonor reactivation recipient', error)
  const row = record(data, 'authorize myhonor reactivation recipient')
  return {
    authorized: row.authorized === true,
    reason: requiredString(row.reason, 'reason'),
    providerAttemptId: row.provider_attempt_id === null || row.provider_attempt_id === undefined
      ? null
      : requiredUuid(row.provider_attempt_id, 'provider_attempt_id'),
    nextRunAt: nullableTimestamp(row.next_run_at, 'next_run_at'),
  }
}

export async function finishMyHonorReactivationRecipient(
  input: {
    recipientId: string
    leaseToken: string
    ownerToken: string
    outcome: 'accepted' | 'failed' | 'delivery_unknown'
    providerMessageId?: string | null
    errorCode?: string | null
    retryable?: boolean
    retryAfterSeconds?: number
  },
  client: SupabaseClient = createServiceClient(),
): Promise<FinishedMyHonorReactivationRecipient> {
  const { data, error } = await client.rpc('finish_myhonor_reactivation_recipient', {
    p_recipient_id: input.recipientId,
    p_lease_token: input.leaseToken,
    p_owner_token: input.ownerToken,
    p_outcome: input.outcome,
    p_provider_message_id: input.providerMessageId ?? null,
    p_error_code: input.errorCode ?? null,
    p_retryable: input.retryable ?? false,
    p_retry_after_seconds: input.retryAfterSeconds ?? 60,
  }).maybeSingle()
  if (error) throw databaseError('finish myhonor reactivation recipient', error)
  const row = record(data, 'finish myhonor reactivation recipient')
  return {
    accepted: row.accepted === true,
    state: row.recipient_state === null || row.recipient_state === undefined
      ? null
      : recipientState(row.recipient_state),
    runAt: nullableTimestamp(row.next_run_at, 'next_run_at'),
  }
}

export function newMyHonorReactivationOwnerToken(prefix = 'direct'): string {
  return `${prefix}:${randomUUID()}`
}
