import type { OmnichannelMessageStatus } from './types'

const RECOVERABLE_INBOUND_STATUSES = new Set<OmnichannelMessageStatus>([
  'received',
  'imported',
  'failed',
  'processing',
])

/**
 * A signed provider retry must be able to resume a row whose first inline
 * attempt failed after persistence or after claiming it for processing.
 * Final states stay terminal, and outbound rows are never scheduled.
 *
 * Auto-send remains protected by the database claim and the bridge's stable
 * idempotency key if two provider deliveries overlap.
 */
export function shouldQueueDuplicateOmnichannelMessage(input: {
  direction: 'in' | 'out'
  status: OmnichannelMessageStatus
}): boolean {
  return input.direction === 'in' && RECOVERABLE_INBOUND_STATUSES.has(input.status)
}
