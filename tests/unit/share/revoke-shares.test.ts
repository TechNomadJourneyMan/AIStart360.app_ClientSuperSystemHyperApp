/**
 * SR-19: revoking public report links never fails silently.
 *   • reassignment: a failed revocation is retried once, then logged and
 *     reported to staff (notifyStaff WARNING — a durable feed row);
 *   • access lost (blocked / archived / rejected): every live link created by
 *     the person is revoked; failures are reported the same way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const staff = vi.hoisted(() => ({ notify: vi.fn(async (_n: Record<string, unknown>) => ({ eventId: 'e', duplicate: false, deliveries: [] as unknown[] })) }))
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: staff.notify }))

const { revokeSharesOfAssignee, revokeSharesOfAssigneeChecked, revokeSharesOfCreator } = await import('@/lib/share/tokens')

const CLIENT = 'c0c0c0c0-0000-4000-8000-000000000001'
const EXPERT = 'e0e0e0e0-0000-4000-8000-000000000001'

type Step = { status: number; body?: unknown } | Error
let script: Step[] = []
const seen: Array<{ url: string; method: string; body?: string }> = []

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  script = []
  seen.length = 0
  staff.notify.mockClear()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), method: String(init?.method ?? 'GET'), body: init?.body as string | undefined })
    const step = script.shift() ?? { status: 500 }
    if (step instanceof Error) throw step
    return json(step.status, step.body ?? [])
  }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('revokeSharesOfAssignee (reassignment, R-136)', () => {
  it('revokes the live links of the previous assignee for the client companies', async () => {
    script = [{ status: 200, body: [{ id: 'co-1' }] }, { status: 200, body: [{ id: 's1' }, { id: 's2' }] }]
    expect(await revokeSharesOfAssigneeChecked(CLIENT, EXPERT)).toEqual({ ok: true, revoked: 2 })
    const patch = seen.find((c) => c.method === 'PATCH')!
    expect(patch.url).toContain(`createdById=eq.${EXPERT}`)
    expect(patch.url).toContain('revoked=eq.false')
    expect(JSON.parse(patch.body!)).toEqual({ revoked: true })
    expect(staff.notify).not.toHaveBeenCalled()
  })

  it('retries a transient failure once', async () => {
    script = [new Error('ECONNRESET'), { status: 200, body: [{ id: 'co-1' }] }, { status: 503 }, { status: 200, body: [{ id: 's1' }] }]
    expect(await revokeSharesOfAssigneeChecked(CLIENT, EXPERT)).toEqual({ ok: true, revoked: 1 })
  })

  it('a persistent failure is not swallowed: ok=false, logged, staff told', async () => {
    script = [{ status: 200, body: [{ id: 'co-1' }] }, { status: 500 }, { status: 500 }]
    const checked = await revokeSharesOfAssigneeChecked(CLIENT, EXPERT)
    expect(checked).toMatchObject({ ok: false, revoked: 0, error: 'HTTP 500' })

    script = [{ status: 200, body: [{ id: 'co-1' }] }, { status: 500 }, { status: 500 }]
    expect(await revokeSharesOfAssignee(CLIENT, EXPERT)).toBe(0)
    expect(console.error).toHaveBeenCalled()
    expect(staff.notify).toHaveBeenCalledTimes(1)
    expect(staff.notify.mock.calls[0][0]).toMatchObject({ level: 'WARNING', type: 'share.revoke_failed', entityId: EXPERT })
  })

  it('an unreadable company list is a failure too (it was «0 revoked» before)', async () => {
    script = [{ status: 500 }, { status: 500 }]
    expect(await revokeSharesOfAssigneeChecked(CLIENT, EXPERT)).toMatchObject({ ok: false })
  })

  it('nothing to do: malformed ids, same person, client without companies', async () => {
    expect(await revokeSharesOfAssigneeChecked('x', EXPERT)).toEqual({ ok: true, revoked: 0 })
    expect(await revokeSharesOfAssigneeChecked(EXPERT, EXPERT)).toEqual({ ok: true, revoked: 0 })
    script = [{ status: 200, body: [] }]
    expect(await revokeSharesOfAssigneeChecked(CLIENT, EXPERT)).toEqual({ ok: true, revoked: 0 })
  })
})

describe('revokeSharesOfCreator (blocked / archived / rejected, SR-19)', () => {
  it('revokes every live link the person created', async () => {
    script = [{ status: 200, body: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] }]
    expect(await revokeSharesOfCreator(EXPERT, 'status:blocked')).toEqual({ ok: true, revoked: 3 })
    expect(seen).toHaveLength(1)
    expect(seen[0].method).toBe('PATCH')
    expect(seen[0].url).toContain(`shared_reports?createdById=eq.${EXPERT}&revoked=eq.false`)
  })

  it('a failure is logged and reported to staff, never thrown', async () => {
    script = [new Error('down'), new Error('down')]
    const res = await revokeSharesOfCreator(EXPERT, 'status:rejected')
    expect(res).toMatchObject({ ok: false, error: 'down' })
    expect(staff.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'share.revoke_failed', entityId: EXPERT }))
  })

  it('a malformed id does nothing', async () => {
    expect(await revokeSharesOfCreator('nope', 'status:blocked')).toEqual({ ok: true, revoked: 0 })
    expect(seen).toHaveLength(0)
  })
})
