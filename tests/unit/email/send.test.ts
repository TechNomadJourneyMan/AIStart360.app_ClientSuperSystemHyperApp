/**
 * Отправка транзакционных писем: идемпотентность, журнал доставки, повтор при
 * временной ошибке и честный отказ, когда ключа Resend нет.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  sendResult: { data: { id: 'res-1' }, error: null } as unknown,
  sendCalls: [] as Array<Record<string, unknown>>,
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  duplicateKeys: new Set<string>(),
  throwOnSend: null as string | null,
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>) => {
        s.sendCalls.push(payload)
        if (s.throwOnSend) {
          const msg = s.throwOnSend
          if (s.sendCalls.length < 2) throw new Error(msg)
        }
        return s.sendResult
      },
    }
  },
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        const key = row.dedupe_key as string | null
        if (key && s.duplicateKeys.has(key)) {
          return { select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }) }) }
        }
        if (key) s.duplicateKeys.add(key)
        s.rows.push(row)
        return { select: () => ({ single: async () => ({ data: { id: `row-${s.rows.length}` }, error: null }) }) }
      },
      update: (patch: Record<string, unknown>) => ({ eq: async () => { s.updates.push(patch); return { error: null } } }),
    }),
  }),
}))

const { sendTransactionalEmail } = await import('@/lib/email/send')

const input = (dedupeKey: string | null = null) => ({
  kind: 'questionnaire_completed' as const,
  to: 'user@company.kz',
  subject: 'Анкета заполнена',
  content: { title: 'Анкета заполнена' },
  userId: null,
  dedupeKey,
})

beforeEach(() => {
  // Здесь Resend замокан, поэтому отправку в тестах разрешаем осознанно.
  process.env.EMAIL_ALLOW_SEND_IN_TESTS = '1'
  process.env.RESEND_API_KEY = 'test-key'
  s.sendResult = { data: { id: 'res-1' }, error: null }
  s.sendCalls = []
  s.rows = []
  s.updates = []
  s.duplicateKeys = new Set()
  s.throwOnSend = null
})

describe('sendTransactionalEmail', () => {
  it('из тестов живое письмо не уходит без явного разрешения', async () => {
    delete process.env.EMAIL_ALLOW_SEND_IN_TESTS
    const res = await sendTransactionalEmail(input('q:guard'))
    expect(res.skipped).toBe(true)
    expect(s.sendCalls).toHaveLength(0)
  })

  it('отправляет письмо и пишет его в журнал доставки', async () => {
    const res = await sendTransactionalEmail(input('q:u1'))
    expect(res.ok).toBe(true)
    expect(res.providerId).toBe('res-1')
    expect(s.sendCalls).toHaveLength(1)
    expect(s.sendCalls[0].subject).toBe('Анкета заполнена')
    // И HTML, и текстовая версия — для почтовых клиентов без HTML.
    expect(String(s.sendCalls[0].html)).toContain('Анкета заполнена')
    expect(String(s.sendCalls[0].text)).toContain('Анкета заполнена')
    expect(s.rows).toHaveLength(1)
  })

  it('второй раз то же письмо не уходит', async () => {
    await sendTransactionalEmail(input('q:u1'))
    const again = await sendTransactionalEmail(input('q:u1'))
    expect(again.ok).toBe(true)
    expect(again.skipped).toBe(true)
    expect(s.sendCalls).toHaveLength(1)
  })

  it('без ключа идемпотентности письмо уходит каждый раз', async () => {
    await sendTransactionalEmail(input(null))
    await sendTransactionalEmail(input(null))
    expect(s.sendCalls).toHaveLength(2)
  })

  it('ошибка провайдера возвращается честно и освобождает ключ для повтора', async () => {
    s.sendResult = { data: null, error: { message: 'Domain not verified' } }
    const res = await sendTransactionalEmail(input('q:u2'))
    expect(res.ok).toBe(false)
    expect(res.error).toContain('Domain not verified')
    expect(s.updates.some((u) => u.status === 'failed' && u.dedupe_key === null)).toBe(true)
  })

  it('временную ошибку сети повторяет', async () => {
    s.throwOnSend = 'fetch failed'
    const res = await sendTransactionalEmail(input('q:u3'))
    expect(res.ok).toBe(true)
    expect(s.sendCalls).toHaveLength(2)
  })

  it('без RESEND_API_KEY не притворяется, что письмо ушло', async () => {
    delete process.env.RESEND_API_KEY
    const res = await sendTransactionalEmail(input('q:u4'))
    expect(res.ok).toBe(false)
    expect(res.error).toContain('RESEND_API_KEY')
    expect(s.sendCalls).toHaveLength(0)
  })
})
