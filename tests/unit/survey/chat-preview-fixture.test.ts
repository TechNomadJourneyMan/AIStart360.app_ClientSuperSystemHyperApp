/**
 * The dev preview of the chat (?mode=chat) plays a recorded scenario: its
 * cards come from the real server code and pass the number guard — every
 * number on a card is in the client's words of that card.
 */
import { describe, expect, it } from 'vitest'
import { previewChatMessages, previewChatTransport, previewTranscript } from '@/app/dev/survey-preview/chat-fixture'
import { clientNumbers } from '@/lib/survey/chat/guard'
import { extractNumbers } from '@/lib/point-b/insights/numbers'

describe('chat preview fixture', () => {
  it('cards are grounded in the client words', () => {
    const cards = previewChatMessages().filter((m) => m.proposal)
    expect(cards.length).toBeGreaterThanOrEqual(3)
    for (const m of cards) {
      const p = m.proposal!
      const words = clientNumbers([p.quote])
      const range = (p.envelope.range as number[] | undefined) ?? []
      for (const n of range) {
        const mantissa = String(n / 1_000_000)
        expect(words.has(mantissa) || words.has(String(n)), `${p.key}: ${n}`).toBe(true)
      }
      if (typeof p.envelope.value === 'number' && !range.length) expect(extractNumbers(p.quote)).toContain(String(p.envelope.value))
    }
    const revenue = cards.find((m) => m.key === 's1_current_revenue_month')!.proposal!
    expect(revenue.display).toBe('≈ 5 500 000 ₸ (5 000 000 – 6 000 000 ₸)')
  })

  it('the transport answers without network', async () => {
    const t = previewChatTransport()
    const view = await t.load()
    expect(view.question?.key).toBe('s1_current_revenue_month')
    expect((await t.post({ action: 'where' })).messages[0].kind).toBe('where')
    expect((await t.post({ action: 'unknown', focusKey: 's1_employee_count' })).messages[0].proposal).toMatchObject({ id: null, envelope: { value: null, unknown: true } })
    expect(await t.decide('x', { decision: 'apply' })).toEqual({ status: 'applied' })
    expect(previewTranscript()[0].messages.length).toBe(view.messages.length)
  })
})
