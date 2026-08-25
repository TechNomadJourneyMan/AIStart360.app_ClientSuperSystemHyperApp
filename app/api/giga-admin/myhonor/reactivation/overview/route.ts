export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getGigaActor } from '@/lib/admin/giga-actor'
import {
  getMyHonorReactivationOverview,
  listMyHonorReactivationCampaigns,
} from '@/lib/integrations/myhonor/reactivation/repository'
import { getMyHonorReactivationConfiguration } from '@/lib/integrations/myhonor/reactivation/types'

const CAMPAIGN_STATES = ['draft', 'approved', 'running', 'paused', 'completed'] as const
const RECIPIENT_STATES = [
  'preview',
  'holdout',
  'excluded',
  'queued',
  'leased',
  'authorized',
  'accepted',
  'sent',
  'delivered',
  'read',
  'failed',
  'delivery_unknown',
  'cancelled',
] as const
const EXCLUSION_REASONS = [
  'missing_consent',
  'global_suppression',
  'unresolved_complaint',
  'frequency_cap',
  'monthly_frequency_cap',
  'inactive_product',
  'invalid_recommendation',
  'application_ineligible',
  'identity_changed',
  'provider_cooldown',
  'campaign_completed',
] as const

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function count(value: unknown, field: string): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw new Error(`invalid aggregate count: ${field}`)
  }
  return value
}

function countRecord(
  value: unknown,
  allowed: readonly string[],
  field: string,
): Record<string, number> {
  const source = record(value)
  if (!source) throw new Error(`invalid aggregate object: ${field}`)
  return Object.fromEntries(allowed.flatMap((key) => {
    if (!(key in source)) return []
    return [[key, count(source[key], `${field}.${key}`)]]
  }))
}

function sum(values: Record<string, number>, keys?: readonly string[]): number {
  return (keys ?? Object.keys(values)).reduce(
    (total, key) => total + (values[key] ?? 0),
    0,
  )
}

function emptyOverview() {
  return {
    campaign_count: 0,
    recipient_count: 0,
    queued_count: 0,
    accepted_count: 0,
    excluded_count: 0,
    holdout_count: 0,
    states: {} as Record<string, number>,
    contacts: {
      total: 0,
      with_effective_consent: 0,
      globally_suppressed: 0,
      provider_marketing_limited: 0,
    },
    exclusion_reasons: {} as Record<string, number>,
  }
}

function safeGlobalOverview(
  value: Record<string, unknown>,
  configured: boolean,
) {
  if (value.scope !== 'global') {
    if (!configured && value.configured === false) return emptyOverview()
    throw new Error('global reactivation overview was not returned')
  }
  const campaignStates = countRecord(
    value.campaign_states,
    CAMPAIGN_STATES,
    'campaign_states',
  )
  const recipientStates = countRecord(
    value.recipient_states,
    RECIPIENT_STATES,
    'recipient_states',
  )
  const rawContacts = record(value.contacts)
  if (!rawContacts) throw new Error('invalid aggregate object: contacts')
  const contacts = {
    total: count(rawContacts.total, 'contacts.total'),
    with_effective_consent: count(
      rawContacts.with_effective_consent,
      'contacts.with_effective_consent',
    ),
    globally_suppressed: count(
      rawContacts.globally_suppressed,
      'contacts.globally_suppressed',
    ),
    provider_marketing_limited: count(
      rawContacts.provider_marketing_limited,
      'contacts.provider_marketing_limited',
    ),
  }
  const exclusionReasons = value.exclusion_reasons === undefined
    ? {}
    : countRecord(value.exclusion_reasons, EXCLUSION_REASONS, 'exclusion_reasons')

  return {
    campaign_count: sum(campaignStates),
    recipient_count: sum(recipientStates),
    queued_count: recipientStates.queued ?? 0,
    accepted_count: sum(recipientStates, ['accepted', 'sent', 'delivered', 'read']),
    excluded_count: recipientStates.excluded ?? 0,
    holdout_count: recipientStates.holdout ?? 0,
    states: campaignStates,
    contacts,
    exclusion_reasons: exclusionReasons,
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await getGigaActor(req))) {
    return NextResponse.json(
      { ok: false, error: { code: 'forbidden', message: 'Forbidden' } },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const configuration = getMyHonorReactivationConfiguration()
  try {
    const [rawOverview, campaigns] = await Promise.all([
      getMyHonorReactivationOverview(),
      listMyHonorReactivationCampaigns({ limit: 10 }),
    ])
    const overview = safeGlobalOverview(rawOverview, configuration.ingestReady)
    return NextResponse.json({
      ok: true,
      overview,
      recent_campaigns: campaigns.slice(0, 10),
      readiness: {
        ingest_ready: configuration.ingestReady,
        send_enabled: configuration.sendEnabled,
        send_ready: configuration.sendReady,
        missing_for_ingest: configuration.missingForIngest,
        missing_for_send: configuration.missingForSend,
      },
    }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'reactivation_store_unavailable',
          message: 'Reactivation overview is temporarily unavailable',
        },
      },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } },
    )
  }
}
