import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const rateLimit = vi.hoisted(() => ({ limit: vi.fn() }))
const audit = vi.hoisted(() => ({ log: vi.fn() }))

vi.mock('@/lib/rate-limit', () => ({
  authRateLimit: { limit: rateLimit.limit },
}))
vi.mock('@/lib/audit', () => ({ logAudit: audit.log }))

import { GIGA_COOKIE_NAME, GIGA_TOKEN_MAX_AGE_SECONDS, verifyGigaRole } from '@/lib/giga-cookie'
import { POST } from '@/app/api/giga-admin/auth/route'

const ORIGINAL_ADMIN_PASSWORD = process.env.GIGA_ADMIN_PASSWORD
const ORIGINAL_COOKIE_SECRET = process.env.GIGA_COOKIE_SECRET
const ADMIN_PASSWORD = 'correct horse battery staple'

function request(
  body: BodyInit | null,
  contentType = 'application/json',
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest('http://localhost/api/giga-admin/auth', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-forwarded-for': '203.0.113.10',
      ...headers,
    },
    body,
  })
}

function jsonRequest(value: unknown): NextRequest {
  return request(JSON.stringify(value))
}

describe('POST /api/giga-admin/auth hardening', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    rateLimit.limit.mockResolvedValue({ success: true })
    audit.log.mockResolvedValue(undefined)
    process.env.GIGA_ADMIN_PASSWORD = ADMIN_PASSWORD
    process.env.GIGA_COOKIE_SECRET = 'route-test-cookie-secret-with-sufficient-entropy'
  })

  afterEach(() => {
    if (ORIGINAL_ADMIN_PASSWORD === undefined) delete process.env.GIGA_ADMIN_PASSWORD
    else process.env.GIGA_ADMIN_PASSWORD = ORIGINAL_ADMIN_PASSWORD
    if (ORIGINAL_COOKIE_SECRET === undefined) delete process.env.GIGA_COOKIE_SECRET
    else process.env.GIGA_COOKIE_SECRET = ORIGINAL_COOKIE_SECRET
  })

  it('sets the versioned, expiring HttpOnly cookie after a valid password', async () => {
    const response = await POST(jsonRequest({ password: ADMIN_PASSWORD }))

    expect(response.status).toBe(200)
    const cookie = response.cookies.get(GIGA_COOKIE_NAME)
    expect(cookie?.value.startsWith('v1.')).toBe(true)
    expect(verifyGigaRole(cookie?.value)).toBe('super_admin')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')
    expect(cookie?.maxAge).toBe(GIGA_TOKEN_MAX_AGE_SECONDS)
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'admin.login',
      performedBy: 'giga:super_admin',
    }))
  })

  it('rejects wrong passwords of both equal and unequal lengths', async () => {
    const sameLengthWrong = `${ADMIN_PASSWORD.slice(0, -1)}x`

    const first = await POST(jsonRequest({ password: sameLengthWrong }))
    const second = await POST(jsonRequest({ password: 'wrong' }))

    expect(first.status).toBe(401)
    expect(second.status).toBe(401)
    expect(audit.log).toHaveBeenCalledTimes(2)
    expect(audit.log).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: 'admin.login_failed',
    }))
  })

  it('enforces JSON media type and a strict one-field object schema', async () => {
    const wrongMediaType = await POST(request(JSON.stringify({ password: ADMIN_PASSWORD }), 'text/plain'))
    const malformed = await POST(request('{"password":'))
    const array = await POST(jsonRequest([ADMIN_PASSWORD]))
    const extraField = await POST(jsonRequest({ password: ADMIN_PASSWORD, role: 'super_admin' }))
    const empty = await POST(jsonRequest({ password: '' }))

    expect(wrongMediaType.status).toBe(415)
    expect(malformed.status).toBe(400)
    expect(array.status).toBe(400)
    expect(extraField.status).toBe(400)
    expect(empty.status).toBe(400)
    expect(audit.log).not.toHaveBeenCalled()
  })

  it('bounds the streamed body and password in characters and UTF-8 bytes', async () => {
    const oversizedBody = await POST(request('x'.repeat(2_049)))
    const tooManyCharacters = await POST(jsonRequest({ password: 'a'.repeat(513) }))
    const tooManyUtf8Bytes = await POST(jsonRequest({ password: '界'.repeat(342) }))

    expect(oversizedBody.status).toBe(413)
    expect(tooManyCharacters.status).toBe(400)
    expect(tooManyUtf8Bytes.status).toBe(400)
    expect(audit.log).not.toHaveBeenCalled()
  })

  it('fails closed when the configured password itself violates the bound', async () => {
    process.env.GIGA_ADMIN_PASSWORD = 'a'.repeat(513)
    const response = await POST(jsonRequest({ password: 'a'.repeat(512) }))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Not configured' })
    expect(audit.log).not.toHaveBeenCalled()
  })

  it('applies the rate limit before reading or comparing the password', async () => {
    rateLimit.limit.mockResolvedValueOnce({ success: false })
    const response = await POST(request(null, 'text/plain'))

    expect(response.status).toBe(429)
    expect(audit.log).not.toHaveBeenCalled()
  })
})
