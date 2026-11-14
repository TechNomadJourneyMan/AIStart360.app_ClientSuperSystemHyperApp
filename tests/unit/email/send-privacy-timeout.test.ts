/**
 * R-138 (part) — the recipient's e-mail went into the logs in clear text («[email] kind → user@…»).
 * It is masked now (u***@company.kz). INT-05 — the Resend call had no timeout: a hung provider held
 * a cron run or a request forever. It is bounded now, and an idempotency key makes a retry after a
 * timeout safe (Resend drops the second send with the same key).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  calls: [] as Array<{ payload: Record<string, unknown>; options: Record<string, unknown> | undefined }>,
  mode: 'ok' as 'ok' | 'hang' | 'hang-once',
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: (payload: Record<string, unknown>, options?: Record<string, unknown>) => {
        s.calls.push({ payload, options })
        if (s.mode === 'hang' || (s.mode === 'hang-once' && s.calls.length === 1)) return new Promise(() => {})
        return Promise.resolve({ data: { id: 'res-1' }, error: null })
      },
    }
  },
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'row-1' }, error: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}))

const { sendTransactionalEmail, maskEmail } = await import('@/lib/email/send')

const input = { kind: 'reminder' as const, to: 'aigerim.k@company.kz', subject: 'S', content: { title: 'T' }, userId: null, dedupeKey: null }
let lines: string[] = []

beforeEach(() => {
  process.env.EMAIL_ALLOW_SEND_IN_TESTS = '1'
  process.env.RESEND_API_KEY = 'test-key'
  process.env.RESEND_TIMEOUT_MS = '40'
  s.calls = []
  s.mode = 'ok'
  lines = []
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')) })
  }
})

afterEach(() => {
  delete process.env.RESEND_TIMEOUT_MS
  vi.restoreAllMocks()
})

describe('R-138 maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('aigerim.k@company.kz')).toBe('a***@company.kz')
    expect(maskEmail('x@y.kz')).toBe('x***@y.kz')
    expect(maskEmail('not-an-email')).toBe('***')
    expect(maskEmail('')).toBe('***')
  })

  it('never logs the full address', async () => {
    await sendTransactionalEmail(input)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join('\n')).not.toContain('aigerim.k@company.kz')
    expect(lines.join('\n')).toContain('a***@company.kz')
  })
})

describe('INT-05 Resend timeout', () => {
  it('sends with an idempotency key that stays the same across the retries of one letter', async () => {
    s.mode = 'hang-once'
    const res = await sendTransactionalEmail(input)
    expect(res.ok).toBe(true)
    expect(s.calls).toHaveLength(2)
    const key = s.calls[0].options?.idempotencyKey
    expect(typeof key).toBe('string')
    expect(s.calls[1].options?.idempotencyKey).toBe(key)
  })

  it('gives up a provider that never answers: an honest failure, not a hang', async () => {
    s.mode = 'hang'
    const started = Date.now()
    const res = await sendTransactionalEmail(input)
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/timeout/i)
  })
})
