/**
 * Shared integration plumbing: error classification and sanitising
 * (lib/integrations/http.ts), the day planner (lib/integrations/period.ts) and
 * credential sealing (lib/integrations/credentials.ts — no plaintext fallback).
 */
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BudgetExhausted, classifyStatus, DeadlineReached, IntegrationError, requestJson, sanitizeMessage, take } from '@/lib/integrations/http'
import { addDays, advanceCursor, BACKFILL_DAYS, maxDaysFor, planDays, REFRESH_DAYS } from '@/lib/integrations/period'
import { CredentialsStorageNotReadyError, CredentialsUnavailableError, openCredentials, sealCredentials, secretValues } from '@/lib/integrations/credentials'
import { relaxWindow } from '@/lib/integrations/sync'

describe('http: classification and sanitising', () => {
  it('maps HTTP statuses to error kinds', () => {
    expect(classifyStatus(401)).toBe('auth')
    expect(classifyStatus(429)).toBe('rate_limit')
    expect(classifyStatus(500)).toBe('transient')
    expect(classifyStatus(503)).toBe('transient')
    expect(classifyStatus(403)).toBe('config')
    expect(classifyStatus(404)).toBe('config')
    expect(classifyStatus(409)).toBe('permanent')
  })

  it('never keeps a secret, a query string or a token-like run in a message', () => {
    const token = 'kaspi-token-0123456789-SECRET'
    const msg = sanitizeMessage(
      `GET https://kaspi.kz/shop/api/v2/orders?filter=x&token=${token} failed: Bearer ${token} eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9abcdefgh`,
      [token],
    )
    expect(msg).not.toContain(token)
    expect(msg).not.toContain('filter=x')
    expect(msg).not.toContain('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9')
    expect(msg).toContain('https://kaspi.kz/shop/api/v2/orders?…')
    expect(sanitizeMessage('x'.repeat(1000)).length).toBeLessThanOrEqual(300)
  })

  it('requestJson: 401 → auth, 429 → rate_limit with the provider hint, network → transient, budget enforced', async () => {
    const secrets = ['top-secret-value-123']
    const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch
    const ctx = (f: typeof fetch, remaining = 5) => ({ fetch: f, budget: { remaining }, secrets })

    const auth = await requestJson(ctx(respond(401, { errors: [{ error: 'bad top-secret-value-123' }] })), { url: 'https://x.test/a', label: 'Тест' }).catch((e) => e)
    expect(auth).toBeInstanceOf(IntegrationError)
    expect(auth.kind).toBe('auth')
    expect(auth.message).not.toContain('top-secret-value-123')

    const limited = await requestJson(ctx(respond(429, {}, { 'x-wait': '1500' })), {
      url: 'https://x.test/b', label: 'Тест', retryAfter: (h) => Number(h.get('x-wait')),
    }).catch((e) => e)
    expect(limited.kind).toBe('rate_limit')
    expect(limited.retryAfterMs).toBe(1500)

    const down = await requestJson(ctx((async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch), { url: 'https://x.test/c', label: 'Тест' }).catch((e) => e)
    expect(down.kind).toBe('transient')

    const budget = { remaining: 1 }
    take(budget)
    expect(() => take(budget)).toThrow(BudgetExhausted)
  })

  it('a passed deadline is DeadlineReached, never BudgetExhausted (it must not shrink the window)', () => {
    let err: unknown = null
    try {
      take({ remaining: 5, deadlineAt: Date.now() - 1 })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(DeadlineReached)
    expect(err).not.toBeInstanceOf(BudgetExhausted)
    // A spent budget stays BudgetExhausted even after the deadline.
    expect(() => take({ remaining: 0, deadlineAt: Date.now() - 1 })).toThrow(BudgetExhausted)
  })

  it('relaxWindow: a halved window doubles back after a run within half of the budget', () => {
    const adapter = { maxDaysPerRun: 7, requestBudget: 60 }
    expect(relaxWindow({ filled_to: '2026-10-01', window_days: 1 }, 6, adapter)).toEqual({ filled_to: '2026-10-01', window_days: 2 })
    expect(relaxWindow({ window_days: 4 }, 30, adapter)).toEqual({}) // 8 ≥ 7: back to the default
    expect(relaxWindow({ window_days: 2 }, 31, adapter)).toEqual({ window_days: 2 }) // not comfortable
    expect(relaxWindow({ window_days: 2 }, 0, adapter)).toEqual({ window_days: 2 }) // nothing fetched, no evidence
    expect(relaxWindow({ filled_to: '2026-10-01' }, 6, adapter)).toEqual({ filled_to: '2026-10-01' })
  })
})

describe('period: sync window planner', () => {
  const now = new Date('2026-10-06T10:00:00Z')

  it('fills the history from BACKFILL_DAYS ago in chunks, then refreshes the last days', () => {
    const first = planDays({}, now, 0, 7)!
    expect(first.from).toBe(addDays('2026-10-05', -(BACKFILL_DAYS - 1)))
    expect(first.days).toHaveLength(7)
    expect(first.refresh).toBe(false)

    const next = planDays(advanceCursor({}, first), now, 0, 7)!
    expect(next.from).toBe(addDays(first.to, 1))

    const filled = planDays({ filled_to: '2026-10-05' }, now, 0, 7)!
    expect(filled.refresh).toBe(true)
    expect(filled.days).toHaveLength(REFRESH_DAYS)
    expect(filled.to).toBe('2026-10-05')
  })

  it('uses the provider time zone for «yesterday» and honours a halved window', () => {
    // 22:00 UTC = 01:00 next day in Almaty (+5): yesterday is the UTC «today».
    const late = new Date('2026-10-06T22:00:00Z')
    expect(planDays({ filled_to: '2026-10-06' }, late, 300, 7)!.to).toBe('2026-10-06')
    expect(maxDaysFor({ window_days: 2 }, 7)).toBe(2)
    expect(maxDaysFor({ window_days: 50 }, 7)).toBe(7)
    expect(maxDaysFor({}, 7)).toBe(7)
  })
})

describe('credentials: sealed or refused', () => {
  const saved = process.env.SECRETS_ENCRYPTION_KEY
  beforeEach(() => { process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('hex') })
  afterEach(() => {
    if (saved === undefined) delete process.env.SECRETS_ENCRYPTION_KEY
    else process.env.SECRETS_ENCRYPTION_KEY = saved
  })

  it('round-trips through v1 ciphertext and masks JSON key parts', () => {
    const sealed = sealCredentials({ token: 'abc-123-secret' })
    expect(sealed.startsWith('v1:')).toBe(true)
    expect(sealed).not.toContain('abc-123-secret')
    expect(openCredentials(sealed)).toEqual({ token: 'abc-123-secret' })
    const vals = secretValues({ service_account_json: JSON.stringify({ private_key: '-----BEGIN PRIVATE KEY-----xyz', private_key_id: 'kid-0001' }) })
    expect(vals).toContain('kid-0001')
  })

  it('refuses to store without an encryption key (no plaintext fallback)', () => {
    delete process.env.SECRETS_ENCRYPTION_KEY
    expect(() => sealCredentials({ token: 'x' })).toThrow(CredentialsUnavailableError)
  })

  it('opening without a (valid) server key is «storage not ready», not a bad client key', () => {
    const sealed = sealCredentials({ token: 'abc-123-secret' })
    for (const key of [undefined, 'too-short']) {
      if (key === undefined) delete process.env.SECRETS_ENCRYPTION_KEY
      else process.env.SECRETS_ENCRYPTION_KEY = key
      let err: unknown = null
      try {
        openCredentials(sealed)
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(CredentialsStorageNotReadyError)
      expect(err).not.toBeInstanceOf(CredentialsUnavailableError)
    }
    // A valid key that does not open the value: the connection needs new credentials.
    process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('hex')
    expect(() => openCredentials(sealed)).toThrow(CredentialsUnavailableError)
  })
})
