/**
 * Attachments in transactional email (report review copy to experts, 103):
 * passed to Resend as `attachments: [{ filename, content, contentType }]`
 * (resend.com/docs/api-reference/emails/send-email — content as buffer or
 * Base64, max 40 MB per email after Base64), never written to the delivery
 * log, refused before the network when too large; without RESEND_API_KEY the
 * send is refused honestly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({ sendCalls: [] as Array<Record<string, unknown>>, rows: [] as Array<Record<string, unknown>> }))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: async (payload: Record<string, unknown>) => { s.sendCalls.push(payload); return { data: { id: 'res-1' }, error: null } } }
  },
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => { s.rows.push(row); return { select: () => ({ single: async () => ({ data: { id: 'row-1' }, error: null }) }) } },
      update: (patch: Record<string, unknown>) => ({ eq: async () => { s.rows.push(patch); return { error: null } } }),
    }),
  }),
}))

const { sendTransactionalEmail } = await import('@/lib/email/send')

const PDF = Buffer.from('%PDF-1.7 report')
const base = {
  kind: 'report_review' as const,
  to: 'expert@aistart360.test',
  subject: 'Отчёт на проверке',
  content: { title: 'Отчёт на проверке' },
  dedupeKey: 'report_review:v1:u1',
}

describe('sendTransactionalEmail attachments', () => {
  beforeEach(() => {
    s.sendCalls.length = 0
    s.rows.length = 0
    process.env.EMAIL_ALLOW_SEND_IN_TESTS = '1'
    process.env.RESEND_API_KEY = 're_test_key'
  })
  afterEach(() => {
    delete process.env.EMAIL_ALLOW_SEND_IN_TESTS
    delete process.env.RESEND_API_KEY
  })

  it('passes the PDF to Resend and keeps it out of the delivery log', async () => {
    const res = await sendTransactionalEmail({ ...base, attachments: [{ filename: 'aistart360-point_a-v3-2026-10-06-review.pdf', content: PDF, contentType: 'application/pdf' }] })
    expect(res).toMatchObject({ ok: true, providerId: 'res-1' })
    expect(s.sendCalls[0].attachments).toEqual([{ filename: 'aistart360-point_a-v3-2026-10-06-review.pdf', content: PDF, contentType: 'application/pdf' }])
    expect(JSON.stringify(s.rows)).not.toContain('PDF-1.7')
    expect(JSON.stringify(s.rows)).not.toContain('attachments')
  })

  it('sends no attachments key when there are none', async () => {
    await sendTransactionalEmail({ ...base, dedupeKey: null })
    expect(s.sendCalls[0]).not.toHaveProperty('attachments')
  })

  it('refuses attachments over 40 MB after Base64 before calling Resend', async () => {
    const big = { length: 31 * 1024 * 1024 } as unknown as Buffer
    const res = await sendTransactionalEmail({ ...base, attachments: [{ filename: 'big.pdf', content: big }] })
    expect(res.ok).toBe(false)
    expect(s.sendCalls).toHaveLength(0)
  })

  it('without RESEND_API_KEY nothing is sent and the result says why', async () => {
    delete process.env.RESEND_API_KEY
    const res = await sendTransactionalEmail({ ...base, attachments: [{ filename: 'r.pdf', content: PDF }] })
    expect(res).toEqual({ ok: false, error: 'RESEND_API_KEY не задан' })
    expect(s.sendCalls).toHaveLength(0)
  })
})
