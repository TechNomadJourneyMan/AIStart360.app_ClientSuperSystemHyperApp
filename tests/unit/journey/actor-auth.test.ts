import { beforeEach, describe, expect, it, vi } from 'vitest'

// Behavioural counterpart to the source-text assertions in device-sync.test.ts:
// those only prove the guard is written, not that it fires. Journey drives paid
// OpenRouter calls, so the production default must be a hard 401.
const auth = vi.hoisted(() => ({ getUser: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth })),
}))

import {
  JourneyAuthenticationError,
  journeyErrorResponse,
  resolveJourneyActor,
} from '@/lib/journey/http'

const anonymous = { data: { user: null }, error: null }

describe('resolveJourneyActor', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    auth.getUser.mockReset()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    vi.stubEnv('NEXT_PUBLIC_JOURNEY_PUBLIC_DEMO', '')
    vi.stubEnv('VERCEL_ENV', '')
  })

  it('binds the workspace to the signed-in Supabase user', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    vi.stubEnv('NODE_ENV', 'production')

    await expect(resolveJourneyActor()).resolves.toBe('user-1')
  })

  it('rejects an anonymous production caller', async () => {
    auth.getUser.mockResolvedValue(anonymous)
    vi.stubEnv('NODE_ENV', 'production')

    await expect(resolveJourneyActor()).rejects.toBeInstanceOf(JourneyAuthenticationError)
  })

  // A Vercel Preview URL is publicly reachable, so `VERCEL_ENV === 'preview'`
  // used to hand every preview deployment's paid AI routes to anonymous callers.
  it('does not reopen the routes on a Vercel Preview deployment', async () => {
    auth.getUser.mockResolvedValue(anonymous)
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'preview')

    await expect(resolveJourneyActor()).rejects.toBeInstanceOf(JourneyAuthenticationError)
  })

  it('allows an anonymous actor only on an explicit public-demo build', async () => {
    auth.getUser.mockResolvedValue(anonymous)
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_JOURNEY_PUBLIC_DEMO', '1')

    await expect(resolveJourneyActor()).resolves.toBeNull()
  })

  it('answers 401 JOURNEY_AUTH_REQUIRED instead of leaking a 500', async () => {
    const response = journeyErrorResponse(new JourneyAuthenticationError())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'JOURNEY_AUTH_REQUIRED' },
    })
  })
})
