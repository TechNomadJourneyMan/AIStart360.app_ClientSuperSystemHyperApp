import { describe, expect, it } from 'vitest'
import { humanTypingDelaySeconds } from '@/lib/omnichannel/human-reply-timing'

describe('human WhatsApp reply timing', () => {
  it('is stable for an Inngest replay of the same message', () => {
    const first = humanTypingDelaySeconds('Добрый день!', 'message-1')
    const replay = humanTypingDelaySeconds('Добрый день!', 'message-1')
    expect(replay).toBe(first)
  })

  it('stays within the short presence window', () => {
    for (const id of ['a', 'b', 'c', 'message-123']) {
      expect(humanTypingDelaySeconds('', id)).toBeGreaterThanOrEqual(2)
      expect(humanTypingDelaySeconds('я'.repeat(2000), id)).toBeLessThanOrEqual(6)
    }
  })

  it('does not get shorter as the answer grows for the same message', () => {
    const lengths = [10, 90, 180, 270, 1000]
    const delays = lengths.map((length) =>
      humanTypingDelaySeconds('👍'.repeat(length), 'stable-message'),
    )
    expect(delays).toEqual([...delays].sort((a, b) => a - b))
  })
})
