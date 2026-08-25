import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadVerifiedMyHonorProducts } from '@/lib/integrations/myhonor/reactivation/catalog'
import { getMyHonorReactivationConfiguration } from '@/lib/integrations/myhonor/reactivation/types'

function configuration() {
  return getMyHonorReactivationConfiguration({
    MYHONOR_REACTIVATION_API_KEY: 'integration-secret-with-at-least-32-bytes',
    MYHONOR_REACTIVATION_MASTER_KEY: Buffer.alloc(32, 3).toString('base64'),
    MYHONOR_REACTIVATION_OWNER_USER_ID: '123e4567-e89b-42d3-a456-426614174000',
    MYHONOR_REACTIVATION_COMPANY_ID: 'company-1',
  })
}

function fakeClient(
  data: Record<string, unknown[]>,
  observedInFilters: Array<{ table: string; column: string; values: unknown[] }> = [],
): SupabaseClient {
  return {
    from(table: string) {
      const result = { data: data[table] ?? [], error: null }
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: (column: string, values: unknown[]) => {
          observedInFilters.push({ table, column, values })
          return builder
        },
        order: () => builder,
        limit: () => builder,
        then: (resolve: (value: typeof result) => unknown) =>
          Promise.resolve(resolve(result)),
      }
      return builder
    },
  } as unknown as SupabaseClient
}

describe('MyHonor reactivation verified catalog loader', () => {
  it('joins only canonical products to active variants and net published stock', async () => {
    const productId = 'myhonor:' + 'a'.repeat(64)
    const products = await loadVerifiedMyHonorProducts({
      configuration: configuration(),
      now: new Date('2026-08-25T10:00:00Z'),
    }, fakeClient({
      ecommerce_products: [{
        id: 'product-db-1',
        external_id: productId,
        name: 'Ботинки зимние Honor Terra',
        url: 'https://myhonor.shop/product/botinki-zimnie-honor-terra',
        description: 'Зимняя обувь для охоты и активного отдыха',
        price: 42_000,
        currency: 'KZT',
        availability: 'in_stock',
        catalog_active: true,
        catalog_synced_at: '2026-08-25T05:00:00Z',
      }],
      store_product_variants: [{
        id: 'variant-1',
        ecommerce_product_id: 'product-db-1',
        name: 'Honor Terra размер 42',
        category: 'Обувь',
        size: '42',
        color: 'коричневый',
        is_active: true,
      }],
      store_import_runs: [
        { id: 'inventory-run-1', import_kind: 'inventory', published_at: '2026-08-25T06:00:00Z' },
        { id: 'price-run-1', import_kind: 'prices', published_at: '2026-08-25T06:00:00Z' },
      ],
      store_warehouses: [{
        id: 'warehouse-1', code: 'ALM-1', city: 'Алматы', is_active: true,
      }],
      store_price_snapshots: [{
        variant_id: 'variant-1', import_run_id: 'price-run-1', retail_price: 39_000,
      }],
      store_inventory_snapshots: [{
        variant_id: 'variant-1',
        warehouse_id: 'warehouse-1',
        import_run_id: 'inventory-run-1',
        quantity_available: 5,
        quantity_reserved: 2,
      }],
    }))

    expect(products).toHaveLength(1)
    expect(products[0]).toMatchObject({
      id: productId,
      priceKzt: 42_000,
      interests: expect.arrayContaining(['hunting', 'footwear']),
      seasons: ['winter'],
      variants: [{
        id: 'variant-1',
        priceKzt: 39_000,
        stocks: [{
          warehouseCode: 'ALM-1',
          city: 'Алматы',
          availableQuantity: 3,
        }],
      }],
    })
  })

  it('fails closed when no published inventory run exists', async () => {
    const products = await loadVerifiedMyHonorProducts({
      configuration: configuration(),
      now: new Date('2026-08-25T10:00:00Z'),
    }, fakeClient({
      ecommerce_products: [],
      store_product_variants: [],
      store_import_runs: [],
      store_warehouses: [],
    }))
    expect(products).toEqual([])
  })

  it('queries only the latest published stock run so stale positive stock cannot survive', async () => {
    const observedInFilters: Array<{
      table: string
      column: string
      values: unknown[]
    }> = []
    await loadVerifiedMyHonorProducts({
      configuration: configuration(),
      now: new Date('2026-08-25T10:00:00Z'),
    }, fakeClient({
      ecommerce_products: [],
      store_product_variants: [],
      store_import_runs: [
        { id: 'inventory-new', import_kind: 'inventory', published_at: '2026-08-25T07:00:00Z' },
        { id: 'inventory-old', import_kind: 'inventory', published_at: '2026-08-24T07:00:00Z' },
        { id: 'prices-new', import_kind: 'prices', published_at: '2026-08-25T06:00:00Z' },
        { id: 'prices-old', import_kind: 'prices', published_at: '2026-08-24T06:00:00Z' },
      ],
      store_warehouses: [],
      store_price_snapshots: [],
      store_inventory_snapshots: [],
    }, observedInFilters))

    expect(observedInFilters).toContainEqual({
      table: 'store_price_snapshots',
      column: 'import_run_id',
      values: ['prices-new'],
    })
    expect(observedInFilters).toContainEqual({
      table: 'store_inventory_snapshots',
      column: 'import_run_id',
      values: ['inventory-new'],
    })
  })

  it('rejects a product with a non-KZT source currency instead of relabelling it', async () => {
    const productId = 'myhonor:' + 'b'.repeat(64)
    const products = await loadVerifiedMyHonorProducts({
      configuration: configuration(),
      now: new Date('2026-08-25T10:00:00Z'),
    }, fakeClient({
      ecommerce_products: [{
        id: 'product-db-2',
        external_id: productId,
        name: 'Куртка Honor',
        url: 'https://myhonor.shop/product/kurtka-honor',
        description: 'Outdoor',
        price: 100,
        currency: 'USD',
        availability: 'in_stock',
        catalog_active: true,
        catalog_synced_at: '2026-08-25T05:00:00Z',
      }],
      store_product_variants: [{
        id: 'variant-2',
        ecommerce_product_id: 'product-db-2',
        name: 'Куртка Honor L',
        category: 'Куртки',
        size: 'L',
        color: 'зелёный',
        is_active: true,
      }],
      store_import_runs: [{
        id: 'inventory-run-2',
        import_kind: 'inventory',
        published_at: '2026-08-25T06:00:00Z',
      }],
      store_warehouses: [{
        id: 'warehouse-2', code: 'AST-1', city: 'Астана', is_active: true,
      }],
      store_inventory_snapshots: [{
        variant_id: 'variant-2',
        warehouse_id: 'warehouse-2',
        import_run_id: 'inventory-run-2',
        quantity_available: 2,
        quantity_reserved: 0,
      }],
    }))

    expect(products).toEqual([])
  })

  it('ignores a stale variant price run instead of reviving its override', async () => {
    const productId = 'myhonor:' + 'c'.repeat(64)
    const observedInFilters: Array<{
      table: string
      column: string
      values: unknown[]
    }> = []
    const products = await loadVerifiedMyHonorProducts({
      configuration: configuration(),
      now: new Date('2026-08-25T10:00:00Z'),
    }, fakeClient({
      ecommerce_products: [{
        id: 'product-db-3',
        external_id: productId,
        name: 'Куртка Honor',
        url: 'https://myhonor.shop/product/kurtka-honor',
        description: 'Outdoor',
        price: 42_000,
        currency: 'KZT',
        availability: 'in_stock',
        catalog_active: true,
        catalog_synced_at: '2026-08-25T05:00:00Z',
      }],
      store_product_variants: [{
        id: 'variant-3',
        ecommerce_product_id: 'product-db-3',
        name: 'Куртка Honor L',
        category: 'Куртки',
        size: 'L',
        color: 'зелёный',
        is_active: true,
      }],
      store_import_runs: [
        { id: 'inventory-run-3', import_kind: 'inventory', published_at: '2026-08-25T06:00:00Z' },
        { id: 'stale-price-run', import_kind: 'prices', published_at: '2026-08-22T06:00:00Z' },
      ],
      store_warehouses: [{
        id: 'warehouse-3', code: 'ALM-1', city: 'Алматы', is_active: true,
      }],
      store_price_snapshots: [{
        variant_id: 'variant-3', import_run_id: 'stale-price-run', retail_price: 1,
      }],
      store_inventory_snapshots: [{
        variant_id: 'variant-3',
        warehouse_id: 'warehouse-3',
        import_run_id: 'inventory-run-3',
        quantity_available: 1,
        quantity_reserved: 0,
      }],
    }, observedInFilters))

    expect(observedInFilters).not.toContainEqual({
      table: 'store_price_snapshots',
      column: 'import_run_id',
      values: ['stale-price-run'],
    })
    expect(products[0]?.variants[0]?.priceKzt).toBeNull()
    expect(products[0]?.priceKzt).toBe(42_000)
  })
})
