import { myHonorFrequencyExclusion } from './policy'
import {
  requiredMarketingPurpose,
  type MyHonorMarketingContactEvent,
  type MyHonorMarketingPurpose,
  type MyHonorReactivationSegment,
} from './types'

export type MyHonorEligibilityExclusion =
  | 'invalid_phone_e164'
  | 'consent_not_granted'
  | 'consent_evidence_incomplete'
  | 'consent_not_yet_obtained'
  | 'required_purpose_not_granted'
  | 'suppressed'
  | 'opted_out'
  | 'unresolved_complaint'
  | 'manual_hold'
  | 'source_snapshot_stale'
  | 'provider_marketing_limit'
  | 'cooling_period'
  | 'invalid_cooling_period'
  | 'invalid_frequency_policy'
  | 'monthly_frequency_cap'
  | 'frequency_cap'
  | 'invalid_last_marketing_timestamp'

export interface MyHonorReactivationEligibilityInput {
  segment: MyHonorReactivationSegment
  /** Must already be normalized by the ingestion boundary. */
  phoneE164: string
  consent: MyHonorMarketingContactEvent['consent']
  suppressed: boolean
  optedOut: boolean
  unresolvedComplaint: boolean
  manualHold?: boolean
  sourceUpdatedAt: string
  providerMarketingLimited?: boolean
  cooldownUntil?: string | null
  lastMarketingSentAt: string | null
  marketingSentLast30Days: number
  frequencyCapDays: number
  monthlyCap: number
  now?: Date
}

export interface MyHonorReactivationEligibilityResult {
  eligible: boolean
  requiredPurpose: MyHonorMarketingPurpose
  exclusions: MyHonorEligibilityExclusion[]
}

function validConsentEvidence(
  consent: MyHonorMarketingContactEvent['consent'],
): boolean {
  return Boolean(
    consent.status === 'granted'
    && consent.obtained_at
    && !consent.revoked_at
    && consent.cross_border_disclosed
    && consent.notice_version.trim()
    && consent.evidence_id.trim()
    && consent.source,
  )
}

/** All hard gates are evaluated so the audit record can explain every block. */
export function evaluateMyHonorReactivationEligibility(
  input: MyHonorReactivationEligibilityInput,
): MyHonorReactivationEligibilityResult {
  const exclusions: MyHonorEligibilityExclusion[] = []
  const requiredPurpose = requiredMarketingPurpose(input.segment)
  const now = input.now ?? new Date()

  if (!/^\+[1-9][0-9]{7,14}$/.test(input.phoneE164)) {
    exclusions.push('invalid_phone_e164')
  }
  if (input.consent.status !== 'granted') {
    exclusions.push('consent_not_granted')
  }
  if (!validConsentEvidence(input.consent)) {
    exclusions.push('consent_evidence_incomplete')
  }
  if (input.consent.status === 'granted' && input.consent.obtained_at) {
    const obtainedAt = Date.parse(input.consent.obtained_at)
    if (!Number.isFinite(obtainedAt) || obtainedAt > now.getTime()) {
      exclusions.push('consent_not_yet_obtained')
    }
  }
  if (!input.consent.purposes.includes(requiredPurpose)) {
    exclusions.push('required_purpose_not_granted')
  }
  if (input.suppressed) exclusions.push('suppressed')
  if (input.optedOut) exclusions.push('opted_out')
  if (input.unresolvedComplaint) exclusions.push('unresolved_complaint')
  if (input.manualHold) exclusions.push('manual_hold')
  const sourceUpdatedAt = Date.parse(input.sourceUpdatedAt)
  if (
    !Number.isFinite(sourceUpdatedAt)
    || sourceUpdatedAt > now.getTime() + 5 * 60_000
    || sourceUpdatedAt < now.getTime() - 24 * 60 * 60_000
  ) {
    exclusions.push('source_snapshot_stale')
  }
  if (input.providerMarketingLimited) exclusions.push('provider_marketing_limit')

  if (input.cooldownUntil) {
    const cooldownUntil = Date.parse(input.cooldownUntil)
    if (!Number.isFinite(cooldownUntil)) {
      exclusions.push('invalid_cooling_period')
    } else if (cooldownUntil > now.getTime()) {
      exclusions.push('cooling_period')
    }
  }

  if (
    !Number.isInteger(input.frequencyCapDays)
    || input.frequencyCapDays < 7
    || !Number.isInteger(input.monthlyCap)
    || input.monthlyCap < 1
    || input.monthlyCap > 3
    || !Number.isInteger(input.marketingSentLast30Days)
    || input.marketingSentLast30Days < 0
    || !Number.isFinite(now.getTime())
  ) {
    exclusions.push('invalid_frequency_policy')
  } else {
    const frequency = myHonorFrequencyExclusion({
      lastMarketingSentAt: input.lastMarketingSentAt,
      marketingSentLast30Days: input.marketingSentLast30Days,
      frequencyCapDays: input.frequencyCapDays,
      monthlyCap: input.monthlyCap,
    }, now)
    if (
      frequency === 'monthly_frequency_cap'
      || frequency === 'frequency_cap'
      || frequency === 'invalid_last_marketing_timestamp'
    ) {
      exclusions.push(frequency)
    } else if (frequency) {
      exclusions.push('invalid_frequency_policy')
    }
  }

  const unique = [...new Set(exclusions)]
  return {
    eligible: unique.length === 0,
    requiredPurpose,
    exclusions: unique,
  }
}
