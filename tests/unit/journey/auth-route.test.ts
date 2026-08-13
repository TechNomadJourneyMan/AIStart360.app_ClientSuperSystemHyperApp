import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyJourneyState } from '@/lib/journey/demo'

const mocks = vi.hoisted(() => ({
  resolveActor: vi.fn(),
  resolveAuthenticated: vi.fn(),
}))

vi.mock('@/lib/ai/structured', () => ({
  hasOpenRouterKey: () => true,
}))

vi.mock('@/lib/journey/http', async () => {
  const actual = await vi.importActual<typeof import('@/lib/journey/http')>(
    '@/lib/journey/http',
  )
  return {
    ...actual,
    resolveJourneyActor: mocks.resolveActor,
  }
})

vi.mock('@/lib/journey/auth-bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@/lib/journey/auth-bootstrap')>(
    '@/lib/journey/auth-bootstrap',
  )
  return { ...actual, resolveAuthenticatedJourneyState: mocks.resolveAuthenticated }
})

vi.mock('@/lib/journey/onboarding-seed', () => ({
  loadJourneyStateFromOnboarding: vi.fn(),
}))

import { GET } from '@/app/api/v1/journey/route'

describe('GET /api/v1/journey authenticated bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'production')
    mocks.resolveActor.mockResolvedValue('5cd75337-ff7a-49df-80ef-7cb63d7fe8c4')
  })

  it('sets a strict HttpOnly device cookie without returning its token in JSON', async () => {
    const deviceToken = 'raw-device-token-must-stay-out-of-json'
    const state = createEmptyJourneyState(
      'journey-user-5cd75337-ff7a-49df-80ef-7cb63d7fe8c4',
    )
    mocks.resolveAuthenticated.mockResolvedValue({
      state: {
        ...state,
        persistence: { mode: 'database', label: 'Сохранено в AIStart360' },
      },
      persistence: { mode: 'database', label: 'Сохранено в AIStart360' },
      deviceToken,
      switchedWorkspace: true,
    })

    const response = await GET(new Request('https://aistart360.vercel.app/api/v1/journey', {
      headers: {
        'x-journey-workspace-id': 'guest-stale-workspace',
        'x-journey-access-token': 'guest-token-with-enough-entropy',
      },
    }))
    const body = await response.json()
    const cookie = response.headers.get('set-cookie') ?? ''

    expect(response.status).toBe(200)
    expect(body.state.workspaceId).toBe(state.workspaceId)
    expect(body.credentialMode).toBe('cookie')
    expect(JSON.stringify(body)).not.toContain(deviceToken)
    expect(cookie).toContain('aistart_journey_device=')
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=Strict/i)
    expect(cookie).toContain('Path=/api/v1/journey')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
