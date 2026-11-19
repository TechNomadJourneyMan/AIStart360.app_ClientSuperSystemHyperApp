/**
 * hooks/useCrm.ts — what the screen says and refreshes after a logged touch (review, low):
 *   a touch whose queue update failed (500 queue_not_updated) is said as such, not as «зафиксирован».
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { crmKeys, logInteractionMutation, touchErrorText } from '@/hooks/useCrm'

/** Run the mutation as react-query does: mutationFn, then onSuccess / onError, then onSettled. */
async function runMutation(opts: ReturnType<typeof logInteractionMutation>, input: Parameters<typeof opts.mutationFn>[0]) {
  const o = opts as unknown as {
    mutationFn: (i: unknown) => Promise<unknown>
    onSuccess?: (d: unknown, i: unknown) => unknown
    onError?: (e: unknown, i: unknown) => unknown
    onSettled?: (d: unknown, e: unknown, i: unknown) => unknown
  }
  try {
    const data = await o.mutationFn(input)
    await o.onSuccess?.(data, input)
    await o.onSettled?.(data, null, input)
    return { data, error: null }
  } catch (error) {
    await o.onError?.(error, input)
    await o.onSettled?.(undefined, error, input)
    return { data: undefined, error }
  }
}

describe('logging a touch refreshes what the server changed (review, low)', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const spyQc = () => {
    const keys: unknown[] = []
    return { keys, qc: { invalidateQueries: (f: { queryKey: unknown }) => { keys.push(f.queryKey); return Promise.resolve() } } }
  }

  it("a contact closes the client's reminders on the server — the drawer's reminder list is refreshed too", async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true, data: { interaction: { id: 'i1' } } }), { status: 200 }))
    const { keys, qc } = spyQc()
    const r = await runMutation(logInteractionMutation(qc as never), { clientId: 'c1', kind: 'call' })
    expect(r.error).toBeNull()
    expect(keys).toEqual(expect.arrayContaining([crmKeys.today(), crmKeys.clientsRoot(), crmKeys.interactions('c1'), crmKeys.reminders('c1')]))
  })

  it('500 queue_not_updated: the touch is recorded — the timeline is refreshed and the screen says the queue was not updated', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      ok: false, error: 'queue_not_updated', code: 'queue_not_updated', message: 'Касание записано, но очередь «Кому звонить» не обновилась.',
    }), { status: 500 }))
    const { keys, qc } = spyQc()
    const r = await runMutation(logInteractionMutation(qc as never), { clientId: 'c1', kind: 'call' })
    expect(touchErrorText(r.error)).toBe('Касание записано, но очередь «Кому звонить» не обновилась.')
    expect(keys).toEqual(expect.arrayContaining([crmKeys.interactions('c1'), crmKeys.reminders('c1'), crmKeys.today()]))
  })
})

describe('touchErrorText', () => {
  it('«queue_not_updated»: the server says the touch is recorded but the queue is not', () => {
    const e = Object.assign(new Error('Касание записано, но очередь «Кому звонить» не обновилась.'), { code: 'queue_not_updated' })
    expect(touchErrorText(e)).toBe('Касание записано, но очередь «Кому звонить» не обновилась.')
  })

  it('anything else: the touch was not recorded (no raw error codes on screen)', () => {
    expect(touchErrorText(Object.assign(new Error('db_error'), { code: 'db_error' }))).toBe('Не удалось записать касание')
    expect(touchErrorText(new TypeError('Failed to fetch'))).toBe('Не удалось записать касание')
    expect(touchErrorText(null)).toBe('Не удалось записать касание')
  })
})
