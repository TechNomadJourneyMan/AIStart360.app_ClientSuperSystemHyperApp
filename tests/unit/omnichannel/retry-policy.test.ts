import { describe, expect, it } from 'vitest'
import { shouldQueueDuplicateOmnichannelMessage } from '@/lib/omnichannel/retry-policy'
import type { OmnichannelMessageStatus } from '@/lib/omnichannel/types'

describe('omnichannel duplicate retry policy', () => {
  it.each<OmnichannelMessageStatus>([
    'received',
    'imported',
    'failed',
    'processing',
  ])('resumes a recoverable inbound row in %s', (status) => {
    expect(shouldQueueDuplicateOmnichannelMessage({ direction: 'in', status })).toBe(true)
  })

  it.each<OmnichannelMessageStatus>([
    'drafted',
    'needs_human',
    'sending',
    'replied',
    'ignored',
    'superseded',
  ])('keeps the terminal or claimed inbound row %s closed', (status) => {
    expect(shouldQueueDuplicateOmnichannelMessage({ direction: 'in', status })).toBe(false)
  })

  it('never schedules an outbound duplicate', () => {
    expect(shouldQueueDuplicateOmnichannelMessage({
      direction: 'out',
      status: 'failed',
    })).toBe(false)
  })
})
