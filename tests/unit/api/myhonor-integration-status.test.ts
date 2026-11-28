import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dependencies = vi.hoisted(() => ({ authorize: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ from: dependencies.from }),
}))
vi.mock('@/lib/integrations/myhonor/access', () => ({ authorizeMyHonorAccount: dependencies.authorize }))
import { GET } from '@/app/api/v1/integrations/myhonor/status/route'

function query(result: Record<string, unknown>) {
  const promise = Promise.resolve(result)
  const chain = {
    select: vi.fn(), eq: vi.fn(), not: vi.fn(), order: vi.fn(), limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result), then: promise.then.bind(promise),
  }
  for (const method of ['select', 'eq', 'not', 'order', 'limit'] as const) chain[method].mockReturnValue(chain)
  return chain
}

describe('MyHonor status scope', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    dependencies.authorize.mockResolvedValue({
      ok: true, userId: 'owner-1', company: { id: 'company-1', name: 'Selected company' },
    })
  })

  it('does not query integration data before owner/company authorization', async () => {
    dependencies.authorize.mockResolvedValue({
      ok: false, error: { status: 403, code: 'integration_not_bound' },
    })
    const response = await GET(new NextRequest('https://portal.example.test/api/v1/integrations/myhonor/status?company_id=other'))
    expect(response.status).toBe(403)
    expect(dependencies.from).not.toHaveBeenCalled()
  })

  it('scopes every source by exact owner and company and reports waiting without first events', async () => {
    const chains: ReturnType<typeof query>[] = []
    dependencies.from.mockImplementation(() => {
      const chain = query({ data: null, count: 0, error: null })
      chains.push(chain)
      return chain
    })
    const response = await GET(new NextRequest('https://portal.example.test/api/v1/integrations/myhonor/status?company_id=company-1'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(body.data).toMatchObject({
      company: 'Selected company', state: 'awaiting_first_sync',
      catalog: { coverage: 'public_partial', retirement_enabled: false, complete: false, published_complete: false },
    })
    expect(chains).toHaveLength(7)
    for (const chain of chains) {
      expect(chain.eq).toHaveBeenCalledWith('user_id', 'owner-1')
      expect(chain.eq).toHaveBeenCalledWith('company_id', 'company-1')
      expect(chain.eq).toHaveBeenCalledWith('source', 'myhonor.shop')
    }
  })

  it('reports missing schema rather than claiming a working integration', async () => {
    dependencies.from.mockImplementation(() => query({ data: null, error: { message: 'missing relation' } }))
    const response = await GET(new NextRequest('https://portal.example.test/api/v1/integrations/myhonor/status'))
    expect((await response.json()).data.state).toBe('migration_required')
  })
})
