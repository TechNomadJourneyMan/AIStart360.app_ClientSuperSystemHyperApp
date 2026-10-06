/**
 * Legacy row fallback (lib/documents/extract-rows.ts, used by the journey
 * documents route) masks personal data before the prompt too, and maps the
 * pseudonyms back in the rows the model returns.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  calls: [] as Array<{ system: string; user: string }>,
  respond: (_user: string): string | null => null,
}))
vi.mock('@/lib/ai/openrouter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/openrouter')>()),
  hasOpenRouterKey: () => true,
  chatWithOpenRouter: async (opts: { system: string; user: string }) => {
    state.calls.push(opts)
    return state.respond(opts.user)
  },
}))

import { extractSalesRows } from '@/lib/documents/extract-rows'

beforeEach(() => {
  state.calls = []
  state.respond = () => null
})

describe('legacy row fallback', () => {
  it('sends pseudonyms instead of names / phones and restores them in the rows', async () => {
    const csv = 'Покупатель;Мобильный телефон;Чек;Когда\nИванова Анна;+7 701 123 45 67;15 000;05.03.2025\n'
    // The model answers with what it saw: the pseudonyms of its prompt.
    state.respond = (user) => {
      const m = /\n(ID-[0-9a-f]{8});(ID-[0-9a-f]{8});15 000;05\.03\.2025/.exec(user)
      return m ? JSON.stringify({ rows: [{ client_id: m[2], client_name: m[1], amount: 15000, occurred_at: '2025-03-05' }] }) : null
    }
    const rows = await extractSalesRows(csv, { fileName: 'sales.csv', mimeType: 'text/csv' })

    expect(state.calls).toHaveLength(1)
    expect(state.calls[0].user).not.toMatch(/Иванова|Анна|701 123 45 67/)
    expect(state.calls[0].user).toContain('15 000')
    expect(state.calls[0].system).not.toMatch(/use the phone digits/)
    expect(rows).toEqual([expect.objectContaining({ client_id: '77011234567', client_name: 'Иванова Анна', amount: 15000 })])
  })
})
