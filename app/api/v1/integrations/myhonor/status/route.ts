export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyHonorAnalyticsConfiguration } from '@/lib/integrations/myhonor/order-analytics'

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

function answerValue(answer: unknown): string | null {
  const value =
    answer && typeof answer === 'object' && 'value' in answer
      ? (answer as { value?: unknown }).value
      : answer
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isMyHonorWebsite(value: string | null): boolean {
  if (!value) return false
  try {
    const candidate = value.includes('://') ? value : `https://${value}`
    const hostname = new URL(candidate).hostname.toLowerCase()
    return hostname === 'myhonor.shop' || hostname === 'www.myhonor.shop'
  } catch {
    return false
  }
}

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const [
    companyResult,
    surveyResult,
    productsResult,
    ordersResult,
    latestProductResult,
    latestOrderResult,
    ingestStateResult,
    catalogStateResult,
    latestCatalogSweepResult,
  ] = await Promise.all([
    supabase
      .from('companies')
      .select('id,name')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('survey_answers')
      .select('question_key,answer')
      .eq('user_id', user.id)
      .in('question_key', ['ec_website', 's1_website', 's1_company_name']),
    supabase
      .from('ecommerce_products')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('source', 'myhonor.shop')
      .eq('catalog_active', true)
      .not('catalog_synced_at', 'is', null),
    supabase
      .from('ecommerce_orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('source', 'myhonor.shop'),
    supabase
      .from('ecommerce_products')
      .select('catalog_synced_at')
      .eq('user_id', user.id)
      .eq('source', 'myhonor.shop')
      .not('catalog_synced_at', 'is', null)
      .order('catalog_synced_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('ecommerce_orders')
      .select('synced_at')
      .eq('user_id', user.id)
      .eq('source', 'myhonor.shop')
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('ecommerce_order_ingest_state')
      .select(
        'last_applied_at,last_received_at,applied_events,ignored_events,conflict_events',
      )
      .eq('user_id', user.id)
      .eq('source', 'myhonor.shop')
      .maybeSingle(),
    supabase
      .from('ecommerce_catalog_sync_state')
      .select(
        'expected_product_count,active_product_count,last_completed_at,tombstoned_product_count',
      )
      .eq('user_id', user.id)
      .eq('source', 'myhonor.shop')
      .maybeSingle(),
    supabase
      .from('ecommerce_catalog_sweeps')
      .select(
        'id,status,generation,manifest_hash,expected_product_count,page_size,next_offset,seen_product_count,active_product_count,tombstoned_product_count,failure_code,started_at,completed_at,failed_at',
      )
      .eq('user_id', user.id)
      .eq('source', 'myhonor.shop')
      .order('generation', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const survey = new Map(
    (surveyResult.data ?? []).map((row) => [
      String(row.question_key),
      answerValue(row.answer),
    ]),
  )
  const companyName =
    companyResult.data?.name ??
    survey.get('s1_company_name') ??
    null
  const website =
    survey.get('ec_website') ??
    survey.get('s1_website') ??
    null
  const tableReady =
    !productsResult.error &&
    !ordersResult.error &&
    !latestProductResult.error &&
    !latestOrderResult.error &&
    !ingestStateResult.error &&
    !catalogStateResult.error &&
    !latestCatalogSweepResult.error
  const productCount = tableReady ? productsResult.count ?? 0 : 0
  const orderCount = tableReady ? ordersResult.count ?? 0 : 0
  const configuration = getMyHonorAnalyticsConfiguration()
  const bindingReady =
    configuration.ready
    && configuration.userId === user.id
    && configuration.companyId === String(companyResult.data?.id ?? '')
  const latestSweep = latestCatalogSweepResult.data
  const enabled =
    isMyHonorWebsite(website) ||
    /honor/i.test(companyName ?? '') ||
    productCount > 0 ||
    orderCount > 0 ||
    bindingReady

  if (!enabled) {
    return json({
      ok: true,
      data: {
        enabled: false,
        state: 'not_applicable',
      },
    })
  }

  let state:
    | 'live'
    | 'catalog_connected'
    | 'catalog_syncing'
    | 'catalog_sync_failed'
    | 'awaiting_first_sync'
    | 'configuration_required'
    | 'migration_required'
  if (!tableReady) {
    state = 'migration_required'
  } else if (!bindingReady) {
    state = 'configuration_required'
  } else if (latestSweep?.status === 'in_progress') {
    state = 'catalog_syncing'
  } else if (
    latestSweep?.status === 'failed'
    || latestSweep?.status === 'superseded'
  ) {
    state = 'catalog_sync_failed'
  } else if (!catalogStateResult.data?.last_completed_at && productCount > 0) {
    state = 'catalog_syncing'
  } else if (Number(ingestStateResult.data?.applied_events ?? 0) > 0) {
    state = 'live'
  } else if (productCount > 0) {
    state = 'catalog_connected'
  } else {
    state = 'awaiting_first_sync'
  }

  return json({
    ok: true,
    data: {
      enabled: true,
      provider: 'myhonor',
      company: companyName ?? 'HONOR GROUP',
      store_url: 'https://myhonor.shop',
      state,
      catalog: {
        count: productCount,
        synced_at: latestProductResult.data?.catalog_synced_at ?? null,
        complete: latestSweep
          ? latestSweep.status === 'completed'
          : Boolean(catalogStateResult.data?.last_completed_at),
        published_complete: Boolean(
          catalogStateResult.data?.last_completed_at,
        ),
        expected_count:
          Number(
            latestSweep?.expected_product_count
              ?? catalogStateResult.data?.expected_product_count
              ?? 0,
          ) || null,
        completed_at: catalogStateResult.data?.last_completed_at ?? null,
        tombstoned_count:
          Number(catalogStateResult.data?.tombstoned_product_count ?? 0),
        sweep: latestSweep ? {
          id: String(latestSweep.id),
          status: latestSweep.status,
          generation: Number(latestSweep.generation),
          manifest_hash: latestSweep.manifest_hash,
          expected_count: Number(latestSweep.expected_product_count),
          page_size: Number(latestSweep.page_size),
          next_offset: Number(latestSweep.next_offset),
          seen_count: Number(latestSweep.seen_product_count),
          active_count: Number(latestSweep.active_product_count),
          tombstoned_count: Number(latestSweep.tombstoned_product_count),
          failure_code: latestSweep.failure_code ?? null,
          started_at: latestSweep.started_at,
          completed_at: latestSweep.completed_at ?? null,
          failed_at: latestSweep.failed_at ?? null,
        } : null,
      },
      orders: {
        count: orderCount,
        synced_at: latestOrderResult.data?.synced_at ?? null,
      },
      ingest: {
        applied_events: Number(ingestStateResult.data?.applied_events ?? 0),
        ignored_events: Number(ingestStateResult.data?.ignored_events ?? 0),
        conflict_events: Number(ingestStateResult.data?.conflict_events ?? 0),
        last_applied_at: ingestStateResult.data?.last_applied_at ?? null,
        last_received_at: ingestStateResult.data?.last_received_at ?? null,
      },
      privacy: {
        customer_identity: 'pseudonymous',
        raw_email_stored: false,
        raw_phone_stored: false,
      },
    },
  })
}
