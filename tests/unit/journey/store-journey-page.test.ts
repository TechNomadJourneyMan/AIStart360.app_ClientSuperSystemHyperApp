import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  cookiesGet: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`)
  }),
  access: vi.fn(),
  mfa: vi.fn(),
  load: vi.fn(),
  build: vi.fn(),
}))

vi.mock('next/cache', () => ({ unstable_noStore: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: () => ({ get: mocks.cookiesGet }) }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock('@/lib/store/access', () => ({
  hasStoreMfaStepUp: mocks.mfa,
  resolveStoreAccess: mocks.access,
}))
vi.mock('@/lib/store/loader', () => ({ loadStoreOverview: mocks.load }))
vi.mock('@/lib/journey/store-seed', () => ({ buildStoreJourneyState: mocks.build }))

import StoreJourneyPage from '@/app/client/journey/store/page'

describe('/client/journey/store server boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cookiesGet.mockReturnValue({ value: 'step-up' })
    mocks.mfa.mockReturnValue(true)
    mocks.access.mockResolvedValue('allowed')
    mocks.load.mockResolvedValue({ companyName: 'Store owner' })
    mocks.build.mockReturnValue({ workspaceId: 'store-journey-user-1' })
  })

  it('redirects an anonymous request before Store data is loaded', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    await expect(StoreJourneyPage()).rejects.toThrow('REDIRECT:/login?from=%2Fclient%2Fjourney%2Fstore')
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('requires Store MFA step-up before access and loader calls', async () => {
    const user = { id: 'user-1', user_metadata: { mfa_totp: true } }
    mocks.getUser.mockResolvedValue({ data: { user }, error: null })
    mocks.mfa.mockReturnValue(false)
    await expect(StoreJourneyPage()).rejects.toThrow('REDIRECT:/2fa?from=%2Fclient%2Fjourney%2Fstore')
    expect(mocks.access).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('fails closed for a role/status rejected by the Store policy', async () => {
    const user = { id: 'user-1', user_metadata: {} }
    mocks.getUser.mockResolvedValue({ data: { user }, error: null })
    mocks.access.mockResolvedValue('forbidden')
    await expect(StoreJourneyPage()).rejects.toThrow('REDIRECT:/dashboard')
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('derives owner scope only from the verified session user', async () => {
    const user = { id: 'user-1', user_metadata: {} }
    const overview = { companyName: 'Store owner' }
    const state = { workspaceId: 'store-journey-user-1' }
    mocks.getUser.mockResolvedValue({ data: { user }, error: null })
    mocks.load.mockResolvedValue(overview)
    mocks.build.mockReturnValue(state)

    const element = await StoreJourneyPage()
    expect(mocks.access).toHaveBeenCalledWith(expect.anything(), 'user-1')
    expect(mocks.load).toHaveBeenCalledWith(expect.anything(), 'user-1')
    expect(mocks.build).toHaveBeenCalledWith(overview, {
      workspaceId: 'store-journey-user-1',
    })
    expect(element.props).toEqual({ state, overview })
  })
})
