import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GIGA_TOKEN_FUTURE_SKEW_SECONDS,
  GIGA_TOKEN_MAX_AGE_SECONDS,
  signGigaRole,
  verifyGigaRole,
} from '@/lib/giga-cookie'
import { verifyGigaRoleEdge } from '@/lib/giga-cookie-edge'

const TEST_SECRET = 'test-only-giga-cookie-secret-with-sufficient-entropy'
const NOW_SECONDS = 1_800_000_000
const VALID_JTI = Buffer.alloc(16, 7).toString('base64url')
const ORIGINAL_SECRETS = {
  giga: process.env.GIGA_COOKIE_SECRET,
  auth: process.env.AUTH_SECRET,
  nextAuth: process.env.NEXTAUTH_SECRET,
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function signedClaims(claims: Record<string, unknown>, version = 'v1'): string {
  const encodedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signingInput = `${version}.${encodedPayload}`
  const signature = createHmac('sha256', TEST_SECRET).update(signingInput).digest('base64url')
  return `${signingInput}.${signature}`
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role: 'super_admin',
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + GIGA_TOKEN_MAX_AGE_SECONDS,
    jti: VALID_JTI,
    ...overrides,
  }
}

async function expectRejectedByNodeAndEdge(token: string | null | undefined) {
  expect(verifyGigaRole(token)).toBeNull()
  await expect(verifyGigaRoleEdge(token)).resolves.toBeNull()
}

describe('versioned giga break-glass cookie', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_SECONDS * 1000))
    process.env.GIGA_COOKIE_SECRET = TEST_SECRET
    delete process.env.AUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
  })

  afterEach(() => {
    vi.useRealTimers()
    restoreEnv('GIGA_COOKIE_SECRET', ORIGINAL_SECRETS.giga)
    restoreEnv('AUTH_SECRET', ORIGINAL_SECRETS.auth)
    restoreEnv('NEXTAUTH_SECRET', ORIGINAL_SECRETS.nextAuth)
  })

  it('mints role, iat, exp and a unique 128-bit jti and verifies in Node and Edge', async () => {
    const first = signGigaRole('super_admin')
    const second = signGigaRole('super_admin')
    const [version, encodedPayload] = first.split('.')
    const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))

    expect(version).toBe('v1')
    expect(first.split('.')).toHaveLength(3)
    expect(claims).toEqual({
      role: 'super_admin',
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + GIGA_TOKEN_MAX_AGE_SECONDS,
      jti: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
    })
    expect(first.split('.')[1]).not.toBe(second.split('.')[1])
    expect(verifyGigaRole(first)).toBe('super_admin')
    await expect(verifyGigaRoleEdge(first)).resolves.toBe('super_admin')
  })

  it('rejects the legacy indefinite role.signature format even with a valid HMAC', async () => {
    const role = 'super_admin'
    const signature = createHmac('sha256', TEST_SECRET).update(role).digest('base64url')
    await expectRejectedByNodeAndEdge(`${role}.${signature}`)
  })

  it('rejects expired tokens and tokens whose declared lifetime exceeds seven days', async () => {
    await expectRejectedByNodeAndEdge(signedClaims(validClaims({
      iat: NOW_SECONDS - 100,
      exp: NOW_SECONDS,
    })))
    await expectRejectedByNodeAndEdge(signedClaims(validClaims({
      exp: NOW_SECONDS + GIGA_TOKEN_MAX_AGE_SECONDS + 1,
    })))
  })

  it('allows only the configured clock skew and rejects farther-future issue times', async () => {
    const boundary = signedClaims(validClaims({
      iat: NOW_SECONDS + GIGA_TOKEN_FUTURE_SKEW_SECONDS,
      exp: NOW_SECONDS + GIGA_TOKEN_FUTURE_SKEW_SECONDS + GIGA_TOKEN_MAX_AGE_SECONDS,
    }))
    expect(verifyGigaRole(boundary)).toBe('super_admin')
    await expect(verifyGigaRoleEdge(boundary)).resolves.toBe('super_admin')

    const tooFar = signedClaims(validClaims({
      iat: NOW_SECONDS + GIGA_TOKEN_FUTURE_SKEW_SECONDS + 1,
      exp: NOW_SECONDS + GIGA_TOKEN_FUTURE_SKEW_SECONDS + 101,
    }))
    await expectRejectedByNodeAndEdge(tooFar)
  })

  it('keeps strict claim parsing identical between Node and Edge', async () => {
    const invalidTokens = [
      signedClaims(validClaims({ role: 'admin' })),
      signedClaims(validClaims({ iat: NOW_SECONDS + 0.5 })),
      signedClaims(validClaims({ exp: String(NOW_SECONDS + 100) })),
      signedClaims(validClaims({ jti: 'too-short' })),
      signedClaims({ ...validClaims(), extra: true }),
      signedClaims(validClaims(), 'v2'),
      `v1.${'a'.repeat(257)}.${'a'.repeat(43)}`,
    ]

    for (const token of invalidTokens) {
      await expectRejectedByNodeAndEdge(token)
    }
  })

  it('rejects tampering and malformed signatures in both runtimes', async () => {
    const token = signGigaRole('super_admin')
    const parts = token.split('.')
    const signature = parts[2]
    const changedFirstCharacter = signature[0] === 'A' ? 'B' : 'A'
    const tampered = `${parts[0]}.${parts[1]}.${changedFirstCharacter}${signature.slice(1)}`

    await expectRejectedByNodeAndEdge(tampered)
    await expectRejectedByNodeAndEdge(`${parts[0]}.${parts[1]}.AA`)
    await expectRejectedByNodeAndEdge(`${parts[0]}.${parts[1]}.${signature}.extra`)
  })

  it('fails closed without a signing secret and refuses non-break-glass roles', async () => {
    expect(() => signGigaRole('admin')).toThrow('Only the super_admin giga role may be signed')
    const token = signGigaRole('super_admin')

    delete process.env.GIGA_COOKIE_SECRET
    expect(verifyGigaRole(token)).toBeNull()
    await expect(verifyGigaRoleEdge(token)).resolves.toBeNull()
    expect(() => signGigaRole('super_admin')).toThrow(/not set/)
  })
})
