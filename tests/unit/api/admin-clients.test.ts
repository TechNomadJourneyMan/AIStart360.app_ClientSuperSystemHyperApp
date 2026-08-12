import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const dependencies = vi.hoisted(() => ({
  guard: vi.fn(),
  serviceFactory: vi.fn(),
  serverFactory: vi.fn(),
  rateLimited: vi.fn(),
  verifyStepUp: vi.fn(),
  from: vi.fn(),
  profileSelect: vi.fn(),
  profileEq: vi.fn(),
  profileMaybeSingle: vi.fn(),
  profileUpsert: vi.fn(),
  securitySelect: vi.fn(),
  securityEq: vi.fn(),
  securityMaybeSingle: vi.fn(),
  passkeySelect: vi.fn(),
  passkeyEq: vi.fn(),
  companyInsert: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  serverFrom: vi.fn(),
  serverProfilesSelect: vi.fn(),
  serverProfilesNot: vi.fn(),
  serverProfilesOrder: vi.fn(),
}))

vi.mock('@/lib/supabase-admin-guard', () => ({
  requireSupabaseAdmin: dependencies.guard,
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: dependencies.serviceFactory,
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: dependencies.serverFactory,
}))

vi.mock('@/lib/rate-limit', () => ({
  isRateLimitedKey: dependencies.rateLimited,
}))

vi.mock('@/lib/mfa/step-up', () => ({
  MFA_COOKIE_NAME: 'aistart360_mfa',
  verifyStepUp: dependencies.verifyStepUp,
}))

import { GET, POST } from '@/app/api/v1/admin/clients/route'

const endpoint = 'https://portal.example.kz/api/v1/admin/clients'
const actorId = '00000000-0000-4000-8000-000000000001'
const clientId = '00000000-0000-4000-8000-000000000002'
const password = 'Safe-Customer-Password-2026!'
const validBody = {
  email: 'New.Client@Example.kz',
  password,
  fullName: 'New Client',
  companyName: 'New Commerce Company',
  industry: 'Retail',
  stage: 'Growth',
}

function postRequest(
  body: unknown = validBody,
  options: {
    origin?: string | null
    cookie?: boolean
    contentType?: string
    rawBody?: string
  } = {},
): NextRequest {
  const headers = new Headers()
  if (options.origin !== null) {
    headers.set('origin', options.origin ?? 'https://portal.example.kz')
  }
  if (options.cookie !== false) headers.set('cookie', 'aistart360_mfa=valid-step-up')
  headers.set('content-type', options.contentType ?? 'application/json')
  return new NextRequest(endpoint, {
    method: 'POST',
    headers,
    body: options.rawBody ?? JSON.stringify(body),
  })
}

describe('POST /api/v1/admin/clients', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    dependencies.guard.mockResolvedValue({
      user: { id: actorId, email: 'admin@example.kz' },
      role: 'admin',
    })
    dependencies.rateLimited.mockResolvedValue(false)
    dependencies.verifyStepUp.mockReturnValue(true)

    dependencies.profileMaybeSingle.mockResolvedValue({
      data: { role: 'admin', status: 'approved' },
      error: null,
    })
    dependencies.profileEq.mockReturnValue({ maybeSingle: dependencies.profileMaybeSingle })
    dependencies.profileSelect.mockReturnValue({ eq: dependencies.profileEq })
    dependencies.profileUpsert.mockResolvedValue({ error: null })

    dependencies.securityMaybeSingle.mockResolvedValue({
      data: { totp_enabled: true },
      error: null,
    })
    dependencies.securityEq.mockReturnValue({ maybeSingle: dependencies.securityMaybeSingle })
    dependencies.securitySelect.mockReturnValue({ eq: dependencies.securityEq })

    dependencies.passkeyEq.mockResolvedValue({ data: null, count: 0, error: null })
    dependencies.passkeySelect.mockReturnValue({ eq: dependencies.passkeyEq })
    dependencies.companyInsert.mockResolvedValue({ error: null })

    dependencies.createUser.mockResolvedValue({
      data: { user: { id: clientId } },
      error: null,
    })
    dependencies.deleteUser.mockResolvedValue({ data: {}, error: null })

    dependencies.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: dependencies.profileSelect,
          upsert: dependencies.profileUpsert,
        }
      }
      if (table === 'user_security') return { select: dependencies.securitySelect }
      if (table === 'webauthn_credentials') return { select: dependencies.passkeySelect }
      if (table === 'companies') return { insert: dependencies.companyInsert }
      throw new Error(`unexpected table: ${table}`)
    })

    dependencies.serviceFactory.mockReturnValue({
      auth: { admin: { createUser: dependencies.createUser, deleteUser: dependencies.deleteUser } },
      from: dependencies.from,
    })
  })

  it('requires an authenticated admin session before privileged reads', async () => {
    dependencies.guard.mockResolvedValue({
      error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }),
    })

    const response = await POST(postRequest())

    expect(response.status).toBe(401)
    expect(dependencies.serviceFactory).not.toHaveBeenCalled()
    expect(dependencies.createUser).not.toHaveBeenCalled()
  })

  it('rejects missing and cross-site origins before service-role access', async () => {
    const missing = await POST(postRequest(validBody, { origin: null }))
    const crossSite = await POST(postRequest(validBody, { origin: 'https://evil.example' }))

    expect(missing.status).toBe(403)
    expect(crossSite.status).toBe(403)
    expect(await crossSite.json()).toEqual({ ok: false, error: 'invalid_origin' })
    expect(dependencies.serviceFactory).not.toHaveBeenCalled()
  })

  it.each([
    ['client role', { role: 'client', status: 'approved' }],
    ['blocked admin', { role: 'admin', status: 'blocked' }],
    ['unapproved super admin', { role: 'super_admin', status: 'pending_approval' }],
    ['missing profile', null],
  ] as Array<[string, { role: string; status: string } | null]>)('fails closed for a trusted %s profile', async (_label, profile) => {
    dependencies.profileMaybeSingle.mockResolvedValue({ data: profile, error: null })

    const response = await POST(postRequest())

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, error: 'forbidden' })
    expect(dependencies.createUser).not.toHaveBeenCalled()
  })

  it('fails closed when the trusted profile cannot be read', async () => {
    dependencies.profileMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: 'database_unavailable', message: 'internal detail' },
    })

    const response = await POST(postRequest())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, error: 'authorization_unavailable' })
    expect(dependencies.createUser).not.toHaveBeenCalled()
  })

  it('requires actual TOTP or passkey enrollment and a user-bound step-up cookie', async () => {
    dependencies.securityMaybeSingle.mockResolvedValue({
      data: { totp_enabled: false },
      error: null,
    })
    const notEnrolled = await POST(postRequest())
    expect(notEnrolled.status).toBe(403)
    expect(await notEnrolled.json()).toEqual({ ok: false, error: 'mfa_enrollment_required' })

    dependencies.passkeyEq.mockResolvedValue({ data: null, count: 1, error: null })
    dependencies.verifyStepUp.mockReturnValue(false)
    const notSteppedUp = await POST(postRequest())
    expect(notSteppedUp.status).toBe(403)
    expect(await notSteppedUp.json()).toEqual({ ok: false, error: 'mfa_step_up_required' })
    expect(dependencies.verifyStepUp).toHaveBeenCalledWith('valid-step-up', actorId)
    expect(dependencies.createUser).not.toHaveBeenCalled()
  })

  it('rate-limits by the trusted actor before reading the password body', async () => {
    dependencies.rateLimited.mockResolvedValue(true)

    const response = await POST(postRequest())

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ ok: false, error: 'rate_limited' })
    expect(dependencies.rateLimited).toHaveBeenCalledWith(
      actorId,
      'admin:client-create',
      { max: 5, windowMs: 10 * 60_000 },
    )
    expect(dependencies.createUser).not.toHaveBeenCalled()
  })

  it('rejects extra authority and identity fields with a strict schema', async () => {
    const response = await POST(postRequest({
      ...validBody,
      userId: actorId,
      companyId: 'attacker-company',
      role: 'super_admin',
      status: 'approved',
      vertical: 'generic',
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, error: 'invalid_request' })
    expect(dependencies.createUser).not.toHaveBeenCalled()
  })

  it('creates a fixed ecommerce client and exactly one company without exposing IDs or password', async () => {
    const response = await POST(postRequest())
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toEqual({ ok: true })
    expect(JSON.stringify(payload)).not.toContain(clientId)
    expect(JSON.stringify(payload)).not.toContain(password)
    expect(dependencies.createUser).toHaveBeenCalledWith({
      email: 'new.client@example.kz',
      password,
      email_confirm: true,
      app_metadata: { role: 'client', status: 'approved', vertical: 'ecommerce' },
      user_metadata: {
        full_name: 'New Client',
        organization: 'New Commerce Company',
        vertical: 'ecommerce',
      },
    })
    expect(dependencies.profileUpsert).toHaveBeenCalledWith({
      id: clientId,
      email: 'new.client@example.kz',
      full_name: 'New Client',
      organization: 'New Commerce Company',
      role: 'client',
      status: 'approved',
      vertical: 'ecommerce',
      approved_at: expect.any(String),
      approved_by: actorId,
    }, { onConflict: 'id' })
    expect(dependencies.companyInsert).toHaveBeenCalledTimes(1)
    expect(dependencies.companyInsert).toHaveBeenCalledWith({
      user_id: clientId,
      name: 'New Commerce Company',
      industry: 'Retail',
      stage: 'Growth',
    })
    expect(dependencies.deleteUser).not.toHaveBeenCalled()
  })

  it('maps duplicate email to an opaque 409 without touching profile or company', async () => {
    dependencies.createUser.mockResolvedValue({
      data: { user: null },
      error: {
        code: 'email_exists',
        status: 422,
        message: 'A user with this email already exists',
      },
    })

    const response = await POST(postRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ ok: false, error: 'email_already_exists' })
    expect(dependencies.profileUpsert).not.toHaveBeenCalled()
    expect(dependencies.companyInsert).not.toHaveBeenCalled()
    expect(dependencies.deleteUser).not.toHaveBeenCalled()
  })

  it('deletes the newly created auth user when the profile write fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dependencies.profileUpsert.mockResolvedValue({
      error: { code: 'profile_write_failed', message: `private ${clientId} ${password}` },
    })

    const response = await POST(postRequest())
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ ok: false, error: 'client_creation_failed' })
    expect(JSON.stringify(payload)).not.toContain(clientId)
    expect(JSON.stringify(payload)).not.toContain(password)
    expect(dependencies.deleteUser).toHaveBeenCalledWith(clientId)
    expect(dependencies.companyInsert).not.toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).not.toContain(clientId)
    expect(JSON.stringify(log.mock.calls)).not.toContain(password)
    log.mockRestore()
  })

  it('deletes the newly created auth user when the company insert fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dependencies.companyInsert.mockResolvedValue({
      error: { code: 'company_write_failed', message: `private ${clientId} ${password}` },
    })

    const response = await POST(postRequest())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, error: 'client_creation_failed' })
    expect(dependencies.deleteUser).toHaveBeenCalledWith(clientId)
    expect(JSON.stringify(log.mock.calls)).not.toContain(clientId)
    expect(JSON.stringify(log.mock.calls)).not.toContain(password)
    log.mockRestore()
  })
})

describe('GET /api/v1/admin/clients', () => {
  it('keeps the existing read path on the session-bound server client', async () => {
    vi.clearAllMocks()
    dependencies.guard.mockResolvedValue({
      user: { id: actorId, email: 'admin@example.kz' },
      role: 'admin',
    })
    dependencies.serverProfilesOrder.mockResolvedValue({ data: [], error: null })
    dependencies.serverProfilesNot.mockReturnValue({ order: dependencies.serverProfilesOrder })
    dependencies.serverProfilesSelect.mockReturnValue({ not: dependencies.serverProfilesNot })
    dependencies.serverFrom.mockReturnValue({ select: dependencies.serverProfilesSelect })
    dependencies.serverFactory.mockReturnValue({ from: dependencies.serverFrom })

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, data: [] })
    expect(dependencies.serverFactory).toHaveBeenCalledTimes(1)
    expect(dependencies.serviceFactory).not.toHaveBeenCalled()
  })
})
