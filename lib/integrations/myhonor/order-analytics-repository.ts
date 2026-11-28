import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase-service'
import {
  MYHONOR_ANALYTICS_SOURCE,
  myHonorAnalyticsOrderHash,
  myHonorAnalyticsRequestHash,
  type NormalizedMyHonorOrderAnalytics,
} from './order-analytics'

export type MyHonorAnalyticsStoredResult =
  | 'applied'
  | 'out_of_order'
  | 'duplicate_version'
  | 'conflict'

export type MyHonorAnalyticsIngestResult =
  | MyHonorAnalyticsStoredResult
  | 'duplicate'

export interface MyHonorAnalyticsBinding {
  userId: string
  companyId: string
}

export interface IngestedMyHonorOrderAnalytics {
  orderId: string | null
  result: MyHonorAnalyticsIngestResult
  originalResult: MyHonorAnalyticsStoredResult
  storedStatusVersion: number | null
  created: boolean
  applied: boolean
  conflict: boolean
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function databaseError(
  operation: string,
  error: { message?: string } | null,
): Error {
  return new Error(
    `${operation}: ${error?.message?.slice(0, 300) || 'database error'}`,
  )
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ingest myhonor analytics: database returned an invalid row')
  }
  return value as Record<string, unknown>
}

function storedResult(value: unknown): MyHonorAnalyticsStoredResult {
  if (
    value === 'applied'
    || value === 'out_of_order'
    || value === 'duplicate_version'
    || value === 'conflict'
  ) {
    return value
  }
  throw new Error('ingest myhonor analytics: invalid original_result')
}

function ingestResult(value: unknown): MyHonorAnalyticsIngestResult {
  if (value === 'duplicate') return value
  return storedResult(value)
}

function nullableUuid(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error('ingest myhonor analytics: invalid order_id')
  }
  return value
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('ingest myhonor analytics: invalid stored_status_version')
  }
  return value
}

export async function ingestMyHonorOrderAnalytics(
  input: {
    analytics: NormalizedMyHonorOrderAnalytics
    binding: MyHonorAnalyticsBinding
  },
  client: SupabaseClient = createServiceClient(),
): Promise<IngestedMyHonorOrderAnalytics> {
  const value = input.analytics
  const { items, ...order } = value.order
  const { data, error } = await client
    .rpc('ingest_myhonor_ecommerce_order', {
      p_user_id: input.binding.userId,
      p_company_id: input.binding.companyId,
      p_event_id: value.event_id,
      p_event_hash: myHonorAnalyticsRequestHash(value),
      p_order_hash: myHonorAnalyticsOrderHash(value),
      p_occurred_at: value.occurred_at,
      p_status_version: value.status_version,
      p_order: order,
      p_items: items,
    })
    .maybeSingle()

  if (error) throw databaseError('ingest myhonor analytics', error)
  const row = record(data)
  const result = ingestResult(row.event_result)
  const originalResult = storedResult(row.original_result)
  return {
    orderId: nullableUuid(row.order_id),
    result,
    originalResult,
    storedStatusVersion: nullableInteger(row.stored_status_version),
    created: row.created === true,
    applied: row.applied === true,
    conflict: row.conflict === true,
  }
}

export function myHonorAnalyticsSource(): typeof MYHONOR_ANALYTICS_SOURCE {
  return MYHONOR_ANALYTICS_SOURCE
}
