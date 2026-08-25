import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { loadStoreOverview } from '@/lib/store/loader'

type Row = Record<string, unknown>

interface QueryCall {
  table: string
  operation: 'eq' | 'in'
  column: string
  value: unknown
}

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = []
  private from = 0
  private to = Number.POSITIVE_INFINITY
  private maximum = Number.POSITIVE_INFINITY

  constructor(
    private readonly table: string,
    private readonly rows: Row[],
    private readonly calls: QueryCall[],
  ) {}

  select(): this {
    return this
  }

  eq(column: string, value: unknown): this {
    this.calls.push({ table: this.table, operation: 'eq', column, value })
    this.filters.push((row) => row[column] === value)
    return this
  }

  in(column: string, value: unknown[]): this {
    this.calls.push({ table: this.table, operation: 'in', column, value })
    this.filters.push((row) => value.includes(row[column]))
    return this
  }

  order(): this {
    return this
  }

  limit(maximum: number): this {
    this.maximum = maximum
    return this
  }

  range(from: number, to: number): this {
    this.from = from
    this.to = to
    return this
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return { data: this.result()[0] ?? null, error: null }
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onFulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.result(), error: null }).then(onFulfilled, onRejected)
  }

  private result(): Row[] {
    return this.rows
      .filter((row) => this.filters.every((filter) => filter(row)))
      .slice(this.from, Math.min(this.to + 1, this.from + this.maximum))
  }
}

class ErrorQuery {
  select(): this { return this }
  eq(): this { return this }
  order(): this { return this }
  range(): this { return this }

  then<TResult1 = { data: null; error: { message: string } }, TResult2 = never>(
    onFulfilled?: ((value: { data: null; error: { message: string } }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: null, error: { message: 'relation does not exist' } })
      .then(onFulfilled, onRejected)
  }
}

function fakeSupabase(tables: Record<string, Row[]>): {
  client: SupabaseClient
  calls: QueryCall[]
} {
  const calls: QueryCall[] = []
  return {
    client: {
      from(table: string) {
        return new FakeQuery(table, tables[table] ?? [], calls)
      },
    } as unknown as SupabaseClient,
    calls,
  }
}

function importRun(input: {
  id: string
  kind: 'prices' | 'inventory' | 'sales'
  scope: string
  publishedAt: string
  status?: 'published' | 'superseded'
  periodStart?: string
  periodEnd?: string
}): Row {
  return {
    id: input.id,
    user_id: 'user-1',
    company_id: 'company-1',
    import_kind: input.kind,
    scope_key: input.scope,
    status: input.status ?? 'published',
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    row_count: 1,
    published_at: input.publishedAt,
  }
}

describe('Store loader publication scopes', () => {
  it('merges four current warehouse snapshots and excludes superseded facts', async () => {
    const inventoryRuns = ['astana', 'astana-kaspi', 'uka', 'main'].map((warehouse, index) =>
      importRun({
        id: `inventory-${warehouse}`,
        kind: 'inventory',
        scope: `warehouse:${warehouse}`,
        publishedAt: `2026-08-0${index + 1}T10:00:00.000Z`,
      }),
    )
    const variants = Array.from({ length: 4 }, (_, index) => ({
      id: `variant-${index + 1}`,
      user_id: 'user-1',
      company_id: 'company-1',
      sku: `SKU-${index + 1}`,
      name: `Товар ${index + 1}`,
      is_active: true,
    }))
    const warehouses = ['Астана', 'Kaspi Астана', 'Усть-Каменогорск', 'Центральный склад']
      .map((name, index) => ({
        id: `warehouse-${index + 1}`,
        user_id: 'user-1',
        company_id: 'company-1',
        name,
      }))
    const currentInventory = inventoryRuns.map((run, index) => ({
      import_run_id: run.id,
      user_id: 'user-1',
      variant_id: `variant-${index + 1}`,
      warehouse_id: `warehouse-${index + 1}`,
      snapshot_date: '2026-07-31',
      quantity_available: index + 1,
      quantity_reserved: 0,
    }))

    const { client, calls } = fakeSupabase({
      companies: [{ id: 'company-1', user_id: 'user-1', name: 'HONOR Kazakhstan' }],
      store_import_runs: [
        ...inventoryRuns,
        importRun({
          id: 'inventory-astana-old',
          kind: 'inventory',
          scope: 'warehouse:astana',
          status: 'superseded',
          publishedAt: '2026-08-10T10:00:00.000Z',
        }),
        importRun({
          id: 'sales-current',
          kind: 'sales',
          scope: 'month:2026-07',
          publishedAt: '2026-08-08T10:00:00.000Z',
          periodStart: '2026-07-01',
          periodEnd: '2026-07-31',
        }),
        importRun({
          id: 'sales-corrected-june',
          kind: 'sales',
          scope: 'month:2026-06',
          // The June correction is published after July, but must not roll the
          // dashboard back to an older factual month.
          publishedAt: '2026-08-10T10:00:00.000Z',
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
        }),
        importRun({
          id: 'prices-global',
          kind: 'prices',
          scope: 'global',
          publishedAt: '2026-08-07T10:00:00.000Z',
        }),
        importRun({
          id: 'prices-non-global',
          kind: 'prices',
          scope: 'legacy-regional',
          publishedAt: '2026-08-09T10:00:00.000Z',
        }),
      ],
      store_product_variants: variants,
      store_warehouses: warehouses,
      store_inventory_snapshots: [
        ...currentInventory,
        {
          import_run_id: 'inventory-astana-old',
          user_id: 'user-1',
          variant_id: 'variant-1',
          warehouse_id: 'warehouse-1',
          snapshot_date: '2026-07-01',
          quantity_available: 9_999,
          quantity_reserved: 0,
        },
      ],
      store_price_snapshots: [
        ...variants.map((variant) => ({
          import_run_id: 'prices-global',
          user_id: 'user-1',
          variant_id: variant.id,
          snapshot_date: '2026-08-07',
          purchase_price: 10,
          retail_price: 20,
        })),
        {
          import_run_id: 'prices-non-global',
          user_id: 'user-1',
          variant_id: 'variant-1',
          snapshot_date: '2026-08-09',
          purchase_price: 1_000,
          retail_price: 2_000,
        },
      ],
      store_sales_lines: [
        {
          id: 'sale-current',
          import_run_id: 'sales-current',
          user_id: 'user-1',
          external_line_id: 'current-1',
          variant_id: 'variant-1',
          warehouse_id: 'warehouse-1',
          sku_snapshot: 'SKU-1',
          name_snapshot: 'Товар 1',
          channel: 'retail_store',
          occurred_on: '2026-07-15',
          quantity: 1,
          list_amount: 100,
          net_revenue: 100,
          cost_amount: 60,
          discount_amount: 0,
        },
        {
          id: 'sale-old-scope',
          import_run_id: 'sales-corrected-june',
          user_id: 'user-1',
          external_line_id: 'old-1',
          variant_id: 'variant-1',
          warehouse_id: 'warehouse-1',
          sku_snapshot: 'SKU-1',
          name_snapshot: 'Товар 1',
          channel: 'retail_store',
          occurred_on: '2026-06-15',
          quantity: 100,
          list_amount: 10_000,
          net_revenue: 10_000,
          cost_amount: 6_000,
          discount_amount: 0,
        },
      ],
      ecommerce_products: [],
      ecommerce_orders: [],
      ecommerce_order_items: [],
    })

    const overview = await loadStoreOverview(client, 'user-1')

    expect(overview.availability).toEqual({ sales: true, inventory: true, prices: true })
    expect(overview.inventory.warehouses).toHaveLength(4)
    expect(overview.inventory.availableUnits).toBe(10)
    expect(overview.inventory.inventoryCost).toBe(100)
    expect(overview.inventory.inventoryRetail).toBe(200)
    expect(overview.metrics.revenue).toBe(100)
    expect(overview.period).toEqual({ from: '2026-07-01', to: '2026-07-31' })

    const inventoryRunFilter = calls.find((call) =>
      call.table === 'store_inventory_snapshots'
      && call.operation === 'in'
      && call.column === 'import_run_id',
    )
    expect(new Set(inventoryRunFilter?.value as string[])).toEqual(new Set([
      'inventory-astana',
      'inventory-astana-kaspi',
      'inventory-uka',
      'inventory-main',
    ]))
    const salesRunFilter = calls.find((call) =>
      call.table === 'store_sales_lines'
      && call.operation === 'in'
      && call.column === 'import_run_id',
    )
    expect(new Set(salesRunFilter?.value as string[])).toEqual(new Set([
      'sales-current',
      'sales-corrected-june',
    ]))
    expect(overview.analytics?.history.map((period) => period.month)).toEqual([
      '2026-06',
      '2026-07',
    ])
    expect(overview.analytics?.windows.latestPublished.metrics.revenue).toBe(100)
    expect(calls).toContainEqual({
      table: 'store_price_snapshots',
      operation: 'eq',
      column: 'import_run_id',
      value: 'prices-global',
    })
    expect(calls).toContainEqual({
      table: 'store_import_runs',
      operation: 'eq',
      column: 'status',
      value: 'published',
    })
  })

  it('falls back without failing when the optional financial schema is absent', async () => {
    const { client: baseClient } = fakeSupabase({
      companies: [{ id: 'company-1', user_id: 'user-1', name: 'HONOR Kazakhstan' }],
      store_import_runs: [],
      ecommerce_products: [{
        id: 'product-1',
        user_id: 'user-1',
        source: 'myhonor.shop',
        sku: 'HONOR-1',
        name: 'HONOR',
        price: 10_000,
        availability: 'in_stock',
        image_url: null,
        catalog_active: true,
        catalog_synced_at: '2026-08-10T10:00:00.000Z',
      }],
      ecommerce_orders: [],
      ecommerce_order_items: [],
    })
    const client = {
      from(table: string) {
        if (table === 'store_financial_periods') return new ErrorQuery()
        return baseClient.from(table)
      },
    } as unknown as SupabaseClient

    const overview = await loadStoreOverview(client, 'user-1')

    expect(overview.catalog.products).toBe(1)
    expect(overview.analytics?.schemaVersion).toBe(2)
    expect(overview.analytics?.pnl.coverage).toBe('unavailable')
    expect(overview.limitations).toContain(
      'Расширенный финансовый импорт ещё не опубликован; P&L собран только из доступных продаж.',
    )
  })

  it('joins only published owner-scoped financial periods into the main DTO', async () => {
    const { client } = fakeSupabase({
      companies: [{ id: 'company-1', user_id: 'user-1', name: 'HONOR Kazakhstan' }],
      store_import_runs: [],
      ecommerce_products: [],
      ecommerce_orders: [],
      ecommerce_order_items: [],
      store_financial_imports: [{
        id: 'financial-1',
        user_id: 'user-1',
        company_id: 'company-1',
        status: 'published',
        published_at: '2026-08-24T10:00:00.000Z',
        source_sha256: 'a'.repeat(64),
      }],
      store_financial_periods: [{
        import_id: 'financial-1',
        user_id: 'user-1',
        company_id: 'company-1',
        period_month: '2026-07-01',
        revenue: 28_053_253,
        cost_amount: 17_139_974.46,
        reported_gross_profit: 10_913_279.29,
        period_expenses: 18_973_632.38,
        bonuses: 3_000_000,
        write_offs: 2_000_000,
        ebitda: -8_060_353.09,
        completeness: 'complete',
        note: 'Округление P&L 0,75 ₸',
        scope_key: 'month:2026-07',
        source_sheet: 'P&L',
        superseded_at: null,
      }],
    })

    const overview = await loadStoreOverview(client, 'user-1')

    expect(overview.availability.sales).toBe(true)
    expect(overview.period).toEqual({ from: '2026-07-01', to: '2026-07-31' })
    expect(overview.metrics).toMatchObject({
      revenue: 28_053_253,
      cost: 17_139_974.46,
      grossProfit: 10_913_278.54,
    })
    expect(overview.analytics?.windows.latestPublished).toMatchObject({
      source: 'financial_report',
      coverage: 'complete',
      scopeKey: 'month:2026-07',
    })
    expect(overview.analytics?.pnl.periods).toEqual([
      expect.objectContaining({
        month: '2026-07',
        grossProfit: 10_913_279.29,
        ebitda: -8_060_353.09,
      }),
    ])
  })
})
