import { beforeEach, describe, expect, it, vi } from 'vitest'

const dependencies = vi.hoisted(() => ({
  getUser: vi.fn(),
  configuration: vi.fn(),
  sweep: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: dependencies.getUser },
    from: (table: string) => {
      let selection = ''
      const result = () => {
        if (table === 'companies') {
          return { data: { id: 'company-1', name: 'HONOR GROUP' }, error: null }
        }
        if (table === 'survey_answers') {
          return {
            data: [{
              question_key: 'ec_website',
              answer: { value: 'https://myhonor.shop' },
            }],
            error: null,
          }
        }
        if (table === 'ecommerce_products' && selection === 'id') {
          return { data: null, error: null, count: 88 }
        }
        if (table === 'ecommerce_products') {
          return {
            data: { catalog_synced_at: '2026-07-29T04:00:00.000Z' },
            error: null,
          }
        }
        if (table === 'ecommerce_orders' && selection === 'id') {
          return { data: null, error: null, count: 3 }
        }
        if (table === 'ecommerce_orders') {
          return {
            data: { synced_at: '2026-07-29T04:01:00.000Z' },
            error: null,
          }
        }
        if (table === 'ecommerce_order_ingest_state') {
          return {
            data: {
              applied_events: 3,
              ignored_events: 0,
              conflict_events: 0,
              last_applied_at: '2026-07-29T04:01:00.000Z',
              last_received_at: '2026-07-29T04:01:00.000Z',
            },
            error: null,
          }
        }
        if (table === 'ecommerce_catalog_sync_state') {
          return {
            data: {
              expected_product_count: 88,
              active_product_count: 88,
              last_completed_at: '2026-07-29T03:00:00.000Z',
              tombstoned_product_count: 1,
            },
            error: null,
          }
        }
        if (table === 'ecommerce_catalog_sweeps') {
          return { data: dependencies.sweep, error: null }
        }
        throw new Error(`Unexpected table ${table}`)
      }
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      Object.assign(builder, {
        select: (value: string) => {
          selection = value
          return builder
        },
        eq: chain,
        in: chain,
        not: chain,
        order: chain,
        limit: chain,
        maybeSingle: async () => result(),
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(result()).then(resolve, reject),
      })
      return builder
    },
  }),
}))

vi.mock('@/lib/integrations/myhonor/order-analytics', () => ({
  getMyHonorAnalyticsConfiguration: dependencies.configuration,
}))

import { GET } from '@/app/api/v1/integrations/myhonor/status/route'

function sweep(status: 'in_progress' | 'failed') {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status,
    generation: 2,
    manifest_hash: 'f'.repeat(64),
    expected_product_count: 88,
    page_size: 24,
    next_offset: 24,
    seen_product_count: 24,
    active_product_count: 0,
    tombstoned_product_count: 0,
    failure_code: status === 'failed' ? 'manifest_changed' : null,
    started_at: '2026-07-29T04:02:00.000Z',
    completed_at: null,
    failed_at:
      status === 'failed' ? '2026-07-29T04:03:00.000Z' : null,
  }
}

describe('MyHonor integration status', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    dependencies.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    dependencies.configuration.mockReturnValue({
      ready: true,
      missing: [],
      userId: 'user-1',
      companyId: 'company-1',
      replayWindowSeconds: 300,
    })
  })

  it('shows a new in-progress sweep even when an older snapshot is complete', async () => {
    dependencies.sweep = sweep('in_progress')

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      state: 'catalog_syncing',
      catalog: {
        count: 88,
        complete: false,
        published_complete: true,
        sweep: {
          status: 'in_progress',
          seen_count: 24,
          expected_count: 88,
        },
      },
    })
  })

  it('keeps a failed attempt durable without hiding the published catalog', async () => {
    dependencies.sweep = sweep('failed')

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      state: 'catalog_sync_failed',
      catalog: {
        count: 88,
        complete: false,
        published_complete: true,
        completed_at: '2026-07-29T03:00:00.000Z',
        sweep: {
          status: 'failed',
          failure_code: 'manifest_changed',
        },
      },
    })
  })
})
