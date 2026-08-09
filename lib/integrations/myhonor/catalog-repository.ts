import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase-service'
import type { MyHonorPublicProduct } from '@/lib/integrations/ecommerce/myhonor-public'

interface CatalogBinding {
  userId: string
  companyId: string
}

interface PersistedCatalogResult {
  upsertedCount: number
  latestSyncedAt: string | null
}

export type CatalogSweepStatus =
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'superseded'

export interface CatalogSweepProgress {
  sweepId: string
  status: CatalogSweepStatus
  generation: number
  manifestHash: string
  expectedProductCount: number
  pageSize: number
  nextOffset: number
  seenProductCount: number
  activeProductCount: number
  tombstonedProductCount: number
  failureCode: string | null
  startedAt: string
  completedAt: string | null
  failedAt: string | null
}

export interface CatalogSweepPageResult extends CatalogSweepProgress {
  accepted: boolean
  reason: string | null
}

interface PersistableProduct {
  external_id: string
  sku: string
  name: string
  url: string
  image_url: string | null
  brand: string | null
  description: string | null
  price: number
  currency: 'KZT'
  availability:
    | 'in_stock'
    | 'out_of_stock'
    | 'preorder'
    | 'discontinued'
    | 'unknown'
  source_hash: string
  synced_at: string
}

function availability(
  value: string | null,
): PersistableProduct['availability'] {
  const normalized = value?.toLowerCase().replace(/[^a-z]/g, '') ?? ''
  if (normalized.endsWith('instock')) return 'in_stock'
  if (normalized.endsWith('outofstock')) return 'out_of_stock'
  if (normalized.endsWith('preorder')) return 'preorder'
  if (normalized.endsWith('discontinued')) return 'discontinued'
  return 'unknown'
}

function skuFromUrl(value: string): string {
  const slug = new URL(value).pathname.split('/').filter(Boolean).at(-1)
  return `MYHONOR-${slug || 'PRODUCT'}`.slice(0, 160)
}

function canonicalHash(value: Omit<PersistableProduct, 'source_hash'>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function normalizeMyHonorCatalogProduct(
  product: MyHonorPublicProduct,
): PersistableProduct {
  const offer = product.offers[0]
  if (!offer) throw new Error('catalog product has no KZT offer')

  const normalizedWithoutHash: Omit<PersistableProduct, 'source_hash'> = {
    external_id: product.externalId,
    sku: skuFromUrl(product.url),
    name: product.name.slice(0, 300),
    url: product.url,
    image_url: product.images[0]?.slice(0, 1000) ?? null,
    brand: product.brand?.slice(0, 160) ?? null,
    description: product.description?.slice(0, 2000) ?? null,
    price: offer.price,
    currency: 'KZT',
    availability: availability(offer.availability),
    synced_at: product.syncedAt,
  }
  return {
    ...normalizedWithoutHash,
    source_hash: canonicalHash(normalizedWithoutHash),
  }
}

function integer(value: unknown, field = 'count'): number {
  const result = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`sync myhonor catalog: invalid ${field}`)
  }
  return result
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new Error(`sync myhonor catalog: invalid ${field}`)
  }
  return value
}

function catalogSweep(
  value: unknown,
  context: string,
): CatalogSweepProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context}: database returned an invalid row`)
  }
  const row = value as Record<string, unknown>
  const status = row.sweep_status
  if (
    status !== 'in_progress'
    && status !== 'completed'
    && status !== 'failed'
    && status !== 'superseded'
  ) {
    throw new Error(`${context}: invalid sweep_status`)
  }
  if (
    typeof row.sweep_id !== 'string'
    || typeof row.manifest_hash !== 'string'
    || !/^[a-f0-9]{64}$/.test(row.manifest_hash)
    || typeof row.started_at !== 'string'
  ) {
    throw new Error(`${context}: invalid sweep identity`)
  }
  return {
    sweepId: row.sweep_id,
    status,
    generation: integer(row.generation, 'generation'),
    manifestHash: row.manifest_hash,
    expectedProductCount: integer(
      row.expected_product_count,
      'expected_product_count',
    ),
    pageSize: integer(row.page_size, 'page_size'),
    nextOffset: integer(row.next_offset, 'next_offset'),
    seenProductCount: integer(row.seen_product_count, 'seen_product_count'),
    activeProductCount: integer(
      row.active_product_count,
      'active_product_count',
    ),
    tombstonedProductCount: integer(
      row.tombstoned_product_count,
      'tombstoned_product_count',
    ),
    failureCode: nullableString(row.failure_code, 'failure_code'),
    startedAt: row.started_at,
    completedAt: nullableString(row.completed_at, 'completed_at'),
    failedAt: nullableString(row.failed_at, 'failed_at'),
  }
}

export async function persistMyHonorCatalogProducts(
  input: {
    binding: CatalogBinding
    products: MyHonorPublicProduct[]
    sweepStartedAt?: string
  },
  client: SupabaseClient = createServiceClient(),
): Promise<PersistedCatalogResult> {
  if (input.products.length === 0) {
    return { upsertedCount: 0, latestSyncedAt: null }
  }
  const sweepStartedAt = input.sweepStartedAt
    ? new Date(input.sweepStartedAt).getTime() + 1
    : null
  if (
    sweepStartedAt !== null
    && !Number.isFinite(sweepStartedAt)
  ) {
    throw new Error('sync myhonor catalog: invalid sweep_started_at')
  }
  const products = input.products.map((product) => normalizeMyHonorCatalogProduct(
    sweepStartedAt !== null
      && new Date(product.syncedAt).getTime() < sweepStartedAt
      ? { ...product, syncedAt: new Date(sweepStartedAt).toISOString() }
      : product,
  ))
  const { data, error } = await client
    .rpc('sync_myhonor_ecommerce_catalog', {
      p_user_id: input.binding.userId,
      p_company_id: input.binding.companyId,
      p_products: products,
    })
    .maybeSingle()

  if (error) {
    throw new Error(
      `sync myhonor catalog: ${error.message?.slice(0, 300) || 'database error'}`,
    )
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('sync myhonor catalog: database returned an invalid row')
  }
  const row = data as Record<string, unknown>
  const latest = row.latest_synced_at
  if (latest !== null && latest !== undefined && typeof latest !== 'string') {
    throw new Error('sync myhonor catalog: invalid latest_synced_at')
  }
  return {
    upsertedCount: integer(row.upserted_count),
    latestSyncedAt: (latest as string | null | undefined) ?? null,
  }
}

export async function beginMyHonorCatalogSweep(
  input: {
    binding: CatalogBinding
    manifestHash: string
    manifestProductIds: string[]
    pageSize: number
  },
  client: SupabaseClient = createServiceClient(),
): Promise<CatalogSweepProgress> {
  const { data, error } = await client
    .rpc('begin_myhonor_ecommerce_catalog_sweep', {
      p_user_id: input.binding.userId,
      p_company_id: input.binding.companyId,
      p_manifest_hash: input.manifestHash,
      p_manifest_product_ids: input.manifestProductIds,
      p_page_size: input.pageSize,
    })
    .maybeSingle()
  if (error) {
    throw new Error(
      `begin myhonor catalog sweep: ${error.message?.slice(0, 300) || 'database error'}`,
    )
  }
  return catalogSweep(data, 'begin myhonor catalog sweep')
}

export async function getMyHonorCatalogSweep(
  input: {
    binding: CatalogBinding
    sweepId?: string | null
  },
  client: SupabaseClient = createServiceClient(),
): Promise<CatalogSweepProgress | null> {
  const { data, error } = await client
    .rpc('get_myhonor_ecommerce_catalog_sweep', {
      p_user_id: input.binding.userId,
      p_company_id: input.binding.companyId,
      p_sweep_id: input.sweepId ?? null,
    })
    .maybeSingle()
  if (error) {
    throw new Error(
      `get myhonor catalog sweep: ${error.message?.slice(0, 300) || 'database error'}`,
    )
  }
  return data ? catalogSweep(data, 'get myhonor catalog sweep') : null
}

export async function recordMyHonorCatalogSweepPage(
  input: {
    binding: CatalogBinding
    sweepId: string
    manifestHash: string
    offset: number
    productExternalIds: string[]
  },
  client: SupabaseClient = createServiceClient(),
): Promise<CatalogSweepPageResult> {
  const { data, error } = await client
    .rpc('record_myhonor_ecommerce_catalog_sweep_page', {
      p_user_id: input.binding.userId,
      p_company_id: input.binding.companyId,
      p_sweep_id: input.sweepId,
      p_manifest_hash: input.manifestHash,
      p_offset: input.offset,
      p_product_external_ids: input.productExternalIds,
    })
    .maybeSingle()
  if (error) {
    throw new Error(
      `record myhonor catalog sweep page: ${error.message?.slice(0, 300) || 'database error'}`,
    )
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      'record myhonor catalog sweep page: database returned an invalid row',
    )
  }
  const row = data as Record<string, unknown>
  if (typeof row.accepted !== 'boolean') {
    throw new Error(
      'record myhonor catalog sweep page: invalid accepted flag',
    )
  }
  return {
    ...catalogSweep(data, 'record myhonor catalog sweep page'),
    accepted: row.accepted,
    reason: nullableString(row.reason, 'reason'),
  }
}

export async function failMyHonorCatalogSweep(
  input: {
    binding: CatalogBinding
    sweepId: string
    failureCode: string
  },
  client: SupabaseClient = createServiceClient(),
): Promise<CatalogSweepProgress> {
  const { data, error } = await client
    .rpc('fail_myhonor_ecommerce_catalog_sweep', {
      p_user_id: input.binding.userId,
      p_company_id: input.binding.companyId,
      p_sweep_id: input.sweepId,
      p_failure_code: input.failureCode,
    })
    .maybeSingle()
  if (error) {
    throw new Error(
      `fail myhonor catalog sweep: ${error.message?.slice(0, 300) || 'database error'}`,
    )
  }
  return catalogSweep(data, 'fail myhonor catalog sweep')
}
