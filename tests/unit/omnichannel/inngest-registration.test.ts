import { describe, expect, it } from 'vitest'
import { processOmnichannelMessage } from '@/lib/functions/process-omnichannel-message'
import { backfillOmnichannel } from '@/lib/functions/backfill-omnichannel'
import {
  omnichannelMaintenance,
  omnichannelOutboundDeliveryMaintenance,
} from '@/lib/functions/omnichannel-maintenance'

function triggersOf(value: unknown): unknown[] {
  return (value as { opts?: { triggers?: unknown[] } }).opts?.triggers ?? []
}

describe('omnichannel Inngest registration', () => {
  it('registers the live-message processor with the v4 trigger shape', () => {
    expect(triggersOf(processOmnichannelMessage)).toEqual([
      { event: 'omnichannel/message.received' },
    ])
  })

  it('registers the channel backfill processor with the v4 trigger shape', () => {
    expect(triggersOf(backfillOmnichannel)).toEqual([
      { event: 'omnichannel/backfill.requested' },
    ])
  })

  it('registers daily reconciliation and retention maintenance', () => {
    expect(triggersOf(omnichannelMaintenance)).toEqual([
      { cron: 'TZ=Asia/Almaty 15 4 * * *' },
    ])
  })

  it('registers an independent outbound fence reaper', () => {
    expect(triggersOf(omnichannelOutboundDeliveryMaintenance)).toEqual([
      { cron: '*/5 * * * *' },
    ])
  })
})
