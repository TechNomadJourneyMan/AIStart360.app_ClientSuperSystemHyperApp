import type {
  MyHonorReactivationInterest,
  MyHonorReactivationSegment,
  NormalizedMyHonorMarketingContactEvent,
} from './types'

const DAY_MS = 24 * 60 * 60 * 1000

export const MYHONOR_REACTIVATION_SEGMENT_PRIORITY = [
  'back_in_stock',
  'abandoned_cart',
  'club_interest',
  'post_purchase',
  'seasonal',
  'registered_no_order',
  'dormant_customer',
  'old_lead',
] as const satisfies readonly MyHonorReactivationSegment[]

export interface MyHonorSegmentationSignals {
  /** Explicit, contact-level club interest. Never infer this from membership alone. */
  clubInterest: boolean
  /** Product ids the same contact requested and that upstream has verified are back in stock. */
  backInStockProductIds: readonly string[]
  /** Interests targeted by a currently active, human-approved seasonal campaign. */
  seasonalInterests: readonly MyHonorReactivationInterest[]
  seasonalCampaignActive: boolean
}

export interface MyHonorSegmentationThresholds {
  oldLeadAfterDays: number
  registeredNoOrderAfterDays: number
  dormantAfterDays: number
  postPurchaseFromDays: number
  postPurchaseToDays: number
}

export interface MyHonorSegmentationOptions {
  now?: Date
  signals?: Partial<MyHonorSegmentationSignals>
  thresholds?: Partial<MyHonorSegmentationThresholds>
}

export interface MyHonorSegmentMatch {
  segment: MyHonorReactivationSegment
  referenceAt: string | null
  reasons: string[]
}

const DEFAULT_SIGNALS: MyHonorSegmentationSignals = {
  clubInterest: false,
  backInStockProductIds: [],
  seasonalInterests: [],
  seasonalCampaignActive: false,
}

const DEFAULT_THRESHOLDS: MyHonorSegmentationThresholds = {
  oldLeadAfterDays: 30,
  registeredNoOrderAfterDays: 3,
  dormantAfterDays: 90,
  postPurchaseFromDays: 14,
  postPurchaseToDays: 45,
}

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function wholeDaysSince(value: string | null | undefined, now: Date): number | null {
  const parsed = timestampMs(value)
  if (parsed === null || parsed > now.getTime()) return null
  return Math.floor((now.getTime() - parsed) / DAY_MS)
}

function latestTimestamp(
  values: Array<string | null | undefined>,
): string | null {
  let latest: { value: string; parsed: number } | null = null
  for (const value of values) {
    if (!value) continue
    const parsed = timestampMs(value)
    if (parsed === null) continue
    if (!latest || parsed > latest.parsed) latest = { value, parsed }
  }
  return latest?.value ?? null
}

function uniqueCanonicalProductIds(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) =>
    /^myhonor:[a-f0-9]{64}$/.test(value),
  ))].sort((a, b) => a.localeCompare(b))
}

function safeThresholds(
  input: Partial<MyHonorSegmentationThresholds> | undefined,
): MyHonorSegmentationThresholds {
  const merged = { ...DEFAULT_THRESHOLDS, ...input }
  const positiveInteger = (value: number, fallback: number) =>
    Number.isInteger(value) && value >= 0 ? value : fallback
  const from = positiveInteger(
    merged.postPurchaseFromDays,
    DEFAULT_THRESHOLDS.postPurchaseFromDays,
  )
  const to = Math.max(
    from,
    positiveInteger(
      merged.postPurchaseToDays,
      DEFAULT_THRESHOLDS.postPurchaseToDays,
    ),
  )
  return {
    oldLeadAfterDays: positiveInteger(
      merged.oldLeadAfterDays,
      DEFAULT_THRESHOLDS.oldLeadAfterDays,
    ),
    registeredNoOrderAfterDays: positiveInteger(
      merged.registeredNoOrderAfterDays,
      DEFAULT_THRESHOLDS.registeredNoOrderAfterDays,
    ),
    dormantAfterDays: positiveInteger(
      merged.dormantAfterDays,
      DEFAULT_THRESHOLDS.dormantAfterDays,
    ),
    postPurchaseFromDays: from,
    postPurchaseToDays: to,
  }
}

/**
 * Deterministically classifies lifecycle signals. This function deliberately
 * does not inspect consent or decide whether a message may be sent.
 */
export function classifyMyHonorReactivationSegments(
  event: NormalizedMyHonorMarketingContactEvent,
  options: MyHonorSegmentationOptions = {},
): MyHonorSegmentMatch[] {
  const now = options.now ?? new Date()
  if (!Number.isFinite(now.getTime())) return []
  const signals: MyHonorSegmentationSignals = {
    ...DEFAULT_SIGNALS,
    ...options.signals,
    backInStockProductIds: uniqueCanonicalProductIds(
      options.signals?.backInStockProductIds ?? [],
    ),
    seasonalInterests: [...new Set(
      options.signals?.seasonalInterests ?? [],
    )].sort(),
  }
  const thresholds = safeThresholds(options.thresholds)
  const lifecycle = event.lifecycle
  const hasOrders = lifecycle.order_count > 0 || Boolean(lifecycle.last_order_at)
  const registeredAt = lifecycle.registered_at ?? null
  const lastActivityAt = lifecycle.last_activity_at ?? null
  const lastOrderAt = lifecycle.last_order_at ?? null
  const latestCustomerActivity = latestTimestamp([
    lastActivityAt,
    lastOrderAt,
    registeredAt,
  ])
  const inactivityDays = wholeDaysSince(latestCustomerActivity, now)
  const registrationAgeDays = wholeDaysSince(registeredAt, now)
  const orderAgeDays = wholeDaysSince(lastOrderAt, now)
  const matches = new Map<MyHonorReactivationSegment, MyHonorSegmentMatch>()

  const add = (
    segment: MyHonorReactivationSegment,
    referenceAt: string | null,
    reasons: string[],
  ) => matches.set(segment, { segment, referenceAt, reasons })

  if (
    !hasOrders
    && !registeredAt
    && inactivityDays !== null
    && inactivityDays >= thresholds.oldLeadAfterDays
  ) {
    add('old_lead', latestCustomerActivity, [
      'no_registration',
      'no_orders',
      `inactive_at_least_${thresholds.oldLeadAfterDays}_days`,
    ])
  }

  const abandonedCartUpdatedAt = lifecycle.abandoned_cart?.active
    ? lifecycle.abandoned_cart.updated_at
    : null
  const abandonedCartUpdatedMs = timestampMs(abandonedCartUpdatedAt)
  const abandonedCartAgeMs = abandonedCartUpdatedMs === null
    ? null
    : now.getTime() - abandonedCartUpdatedMs
  const orderAfterCart = abandonedCartUpdatedMs !== null
    && timestampMs(lastOrderAt) !== null
    && timestampMs(lastOrderAt)! >= abandonedCartUpdatedMs
  if (
    lifecycle.abandoned_cart?.active
    && lifecycle.abandoned_cart.product_ids.length > 0
    && abandonedCartAgeMs !== null
    && abandonedCartAgeMs >= 2 * 60 * 60 * 1000
    && abandonedCartAgeMs <= 14 * DAY_MS
    && !orderAfterCart
  ) {
    add('abandoned_cart', abandonedCartUpdatedAt, [
      'active_abandoned_cart',
      'cart_age_2_hours_to_14_days',
      'no_order_after_cart',
    ])
  }

  if (
    !hasOrders
    && registrationAgeDays !== null
    && inactivityDays !== null
    && registrationAgeDays >= thresholds.registeredNoOrderAfterDays
    && inactivityDays >= thresholds.registeredNoOrderAfterDays
  ) {
    add('registered_no_order', latestCustomerActivity, [
      'registered',
      'no_orders',
      `inactive_at_least_${thresholds.registeredNoOrderAfterDays}_days`,
    ])
  }

  if (
    hasOrders
    && inactivityDays !== null
    && inactivityDays >= thresholds.dormantAfterDays
  ) {
    add('dormant_customer', latestCustomerActivity, [
      'has_order_history',
      `inactive_at_least_${thresholds.dormantAfterDays}_days`,
    ])
  }

  if (
    hasOrders
    && orderAgeDays !== null
    && orderAgeDays >= thresholds.postPurchaseFromDays
    && orderAgeDays <= thresholds.postPurchaseToDays
  ) {
    add('post_purchase', lastOrderAt, [
      'has_order_history',
      `last_order_${thresholds.postPurchaseFromDays}_to_${thresholds.postPurchaseToDays}_days_ago`,
    ])
  }

  const seasonalMatches = event.contact.interests.filter((interest) =>
    signals.seasonalInterests.includes(interest),
  )
  if (signals.seasonalCampaignActive && seasonalMatches.length > 0) {
    add('seasonal', latestCustomerActivity, [
      'approved_seasonal_campaign',
      ...seasonalMatches.sort().map((interest) => `interest:${interest}`),
    ])
  }

  if (signals.clubInterest && event.contact.club_status !== 'member') {
    add('club_interest', latestCustomerActivity, [
      'explicit_club_interest',
      `club_status:${event.contact.club_status}`,
    ])
  }

  if (signals.backInStockProductIds.length > 0) {
    add('back_in_stock', latestCustomerActivity, [
      'explicit_back_in_stock_match',
      ...signals.backInStockProductIds.map((id) => `product:${id}`),
    ])
  }

  return MYHONOR_REACTIVATION_SEGMENT_PRIORITY
    .map((segment) => matches.get(segment))
    .filter((match): match is MyHonorSegmentMatch => Boolean(match))
}

export function selectPrimaryMyHonorReactivationSegment(
  matches: readonly MyHonorSegmentMatch[],
): MyHonorSegmentMatch | null {
  const bySegment = new Map(matches.map((match) => [match.segment, match]))
  for (const segment of MYHONOR_REACTIVATION_SEGMENT_PRIORITY) {
    const match = bySegment.get(segment)
    if (match) return match
  }
  return null
}
