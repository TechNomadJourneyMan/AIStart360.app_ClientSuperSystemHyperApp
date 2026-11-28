import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MyHonorPublicProduct } from '@/lib/integrations/ecommerce/myhonor-public'
import {
  beginMyHonorCatalogSweep,
  failMyHonorCatalogSweep,
  getMyHonorCatalogSweep,
  normalizeMyHonorCatalogProduct,
  persistMyHonorCatalogProducts,
  recordMyHonorCatalogSweepPage,
} from '@/lib/integrations/myhonor/catalog-repository'

const sweepId = '11111111-1111-4111-8111-111111111111'
const manifestHash = 'f'.repeat(64)

function product(): MyHonorPublicProduct {
  return {
    externalId: `myhonor:${'a'.repeat(64)}`,
    name: 'HONOR X9c',
    url: 'https://myhonor.shop/product/honor-x9c',
    images: ['https://cdn.example.kz/honor-x9c.webp'],
    brand: 'HONOR',
    description: 'Смартфон',
    offers: [{
      price: 199_990,
      priceCurrency: 'KZT',
      availability: 'https://schema.org/InStock',
      url: 'https://myhonor.shop/product/honor-x9c',
    }],
    syncedAt: '2026-07-29T04:00:00.000Z',
    provenance: {
      provider: 'myhonor-public',
      method: 'schema.org/Product JSON-LD',
      sourceUrl: 'https://myhonor.shop/product/honor-x9c',
      sitemapUrl: 'https://myhonor.shop/sitemap.xml',
      retrievedAt: '2026-07-29T04:00:00.000Z',
    },
  }
}

function databaseSweep(overrides: Record<string, unknown> = {}) {
  return {
    sweep_id: sweepId,
    sweep_status: 'in_progress',
    generation: 3,
    manifest_hash: manifestHash,
    expected_product_count: 88,
    page_size: 24,
    next_offset: 24,
    seen_product_count: 24,
    active_product_count: 0,
    tombstoned_product_count: 0,
    failure_code: null,
    started_at: '2026-07-29T04:00:01.000Z',
    completed_at: null,
    failed_at: null,
    ...overrides,
  }
}

function clientReturning(
  data: unknown,
  error: unknown = null,
): { client: SupabaseClient; rpc: ReturnType<typeof vi.fn> } {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error })
  const rpc = vi.fn().mockReturnValue({ maybeSingle })
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  }
}

describe('MyHonor catalog repository', () => {
  it('normalizes public JSON-LD into the strict analytics product shape', () => {
    expect(normalizeMyHonorCatalogProduct(product())).toMatchObject({
      external_id: `myhonor:${'a'.repeat(64)}`,
      sku: 'MYHONOR-honor-x9c',
      name: 'HONOR X9c',
      price: 199_990,
      currency: 'KZT',
      availability: 'in_stock',
      source_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it('persists a page after flooring its sync time to the DB sweep start', async () => {
    const { client, rpc } = clientReturning({
      upserted_count: 1,
      latest_synced_at: '2026-07-29T04:00:01.000Z',
    })

    await expect(persistMyHonorCatalogProducts({
      binding: {
        userId: '00000000-0000-4000-8000-000000000001',
        companyId: 'myhonor-company',
      },
      products: [product()],
      sweepStartedAt: '2026-07-29T04:00:01.000Z',
    }, client)).resolves.toEqual({
      upsertedCount: 1,
      latestSyncedAt: '2026-07-29T04:00:01.000Z',
    })

    expect(rpc).toHaveBeenCalledWith(
      'sync_myhonor_ecommerce_catalog',
      expect.objectContaining({
        p_user_id: '00000000-0000-4000-8000-000000000001',
        p_company_id: 'myhonor-company',
        p_products: [expect.objectContaining({
          external_id: `myhonor:${'a'.repeat(64)}`,
          synced_at: '2026-07-29T04:00:01.001Z',
        })],
      }),
    )
  })

  it('begins a sweep with the ordered frozen manifest', async () => {
    const { client, rpc } = clientReturning(databaseSweep({
      next_offset: 0,
      seen_product_count: 0,
    }))
    const ids = [`myhonor:${'a'.repeat(64)}`]

    await expect(beginMyHonorCatalogSweep({
      binding: { userId: 'user-1', companyId: 'company-1' },
      manifestHash,
      manifestProductIds: ids,
      pageSize: 24,
    }, client)).resolves.toMatchObject({
      sweepId,
      status: 'in_progress',
      generation: 3,
      manifestHash,
      nextOffset: 0,
    })
    expect(rpc).toHaveBeenCalledWith(
      'begin_myhonor_ecommerce_catalog_sweep',
      {
        p_user_id: 'user-1',
        p_company_id: 'company-1',
        p_manifest_hash: manifestHash,
        p_manifest_product_ids: ids,
        p_page_size: 24,
      },
    )
  })

  it('loads the server cursor and returns null when no active sweep exists', async () => {
    const first = clientReturning(databaseSweep())
    await expect(getMyHonorCatalogSweep({
      binding: { userId: 'user-1', companyId: 'company-1' },
      sweepId,
    }, first.client)).resolves.toMatchObject({
      sweepId,
      nextOffset: 24,
      seenProductCount: 24,
    })
    expect(first.rpc).toHaveBeenCalledWith(
      'get_myhonor_ecommerce_catalog_sweep',
      {
        p_user_id: 'user-1',
        p_company_id: 'company-1',
        p_sweep_id: sweepId,
      },
    )

    const empty = clientReturning(null)
    await expect(getMyHonorCatalogSweep({
      binding: { userId: 'user-1', companyId: 'company-1' },
    }, empty.client)).resolves.toBeNull()
  })

  it('records only the exact ordered page through the fenced RPC', async () => {
    const row = {
      ...databaseSweep({
        sweep_status: 'completed',
        next_offset: 88,
        seen_product_count: 88,
        active_product_count: 88,
        tombstoned_product_count: 2,
        completed_at: '2026-07-29T04:04:00.000Z',
      }),
      accepted: true,
      reason: null,
    }
    const { client, rpc } = clientReturning(row)
    const ids = [`myhonor:${'a'.repeat(64)}`]

    await expect(recordMyHonorCatalogSweepPage({
      binding: { userId: 'user-1', companyId: 'company-1' },
      sweepId,
      manifestHash,
      offset: 72,
      productExternalIds: ids,
    }, client)).resolves.toMatchObject({
      accepted: true,
      status: 'completed',
      activeProductCount: 88,
      tombstonedProductCount: 2,
    })
    expect(rpc).toHaveBeenCalledWith(
      'record_myhonor_ecommerce_catalog_sweep_page',
      {
        p_user_id: 'user-1',
        p_company_id: 'company-1',
        p_sweep_id: sweepId,
        p_manifest_hash: manifestHash,
        p_offset: 72,
        p_product_external_ids: ids,
      },
    )
  })

  it('persists a safe durable failure code for the active sweep', async () => {
    const { client, rpc } = clientReturning(databaseSweep({
      sweep_status: 'failed',
      failure_code: 'manifest_changed',
      failed_at: '2026-07-29T04:03:00.000Z',
    }))

    await expect(failMyHonorCatalogSweep({
      binding: { userId: 'user-1', companyId: 'company-1' },
      sweepId,
      failureCode: 'manifest_changed',
    }, client)).resolves.toMatchObject({
      status: 'failed',
      failureCode: 'manifest_changed',
    })
    expect(rpc).toHaveBeenCalledWith(
      'fail_myhonor_ecommerce_catalog_sweep',
      {
        p_user_id: 'user-1',
        p_company_id: 'company-1',
        p_sweep_id: sweepId,
        p_failure_code: 'manifest_changed',
      },
    )
  })
})
