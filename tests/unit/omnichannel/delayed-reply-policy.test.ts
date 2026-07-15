import { describe, expect, it } from 'vitest'
import {
  DELAYED_REPLY_APOLOGY,
  DELAYED_REPLY_APOLOGY_AFTER_MS,
  DELAYED_REPLY_FRESH_INBOUND_MAX_AGE_MS,
  DELAYED_REPLY_HUMAN_AFTER_MS,
  assessDelayedReply,
  isConfirmedOutboundMessage,
  prependDelayedReplyApology,
} from '@/lib/omnichannel/delayed-reply-policy'
import type { OmnichannelMessage } from '@/lib/omnichannel/types'

const NOW_MS = new Date('2026-07-15T12:00:00.000Z').getTime()

function message(input: Partial<OmnichannelMessage> & { id: string }): OmnichannelMessage {
  const { id, ...overrides } = input
  return {
    id,
    conversationId: 'conversation-1',
    channel: 'whatsapp',
    externalMessageId: `provider-${id}`,
    direction: 'in',
    messageType: 'text',
    text: 'Хочу в Клуб',
    status: 'received',
    replyToExternalId: null,
    aiDraft: null,
    aiConfidence: null,
    aiReason: null,
    aiGenerated: false,
    metadata: { providerTimestampTrusted: true, live: true },
    occurredAt: new Date(NOW_MS).toISOString(),
    processedAt: null,
    ...overrides,
  }
}

function inboundAt(id: string, ageMs: number, overrides: Partial<OmnichannelMessage> = {}) {
  return message({
    id,
    status: 'imported',
    metadata: {
      providerTimestampTrusted: true,
      catchUp: true,
      live: false,
    },
    occurredAt: new Date(NOW_MS - ageMs).toISOString(),
    ...overrides,
  })
}

describe('delayed omnichannel reply policy', () => {
  it('keeps imported/catch-up rows draft-only even without an event force flag', () => {
    const current = inboundAt('historical', 2 * 60 * 60 * 1_000)
    expect(assessDelayedReply({ currentMessage: current, history: [current], nowMs: NOW_MS }))
      .toEqual({
        gate: 'draft',
        reason: 'historical_catch_up_draft_only',
        prependApology: false,
        unansweredAgeMs: null,
        unansweredMessageCount: 0,
      })
  })

  it('does not apologize for an unanswered gap shorter than one hour', () => {
    const earlier = inboundAt('earlier', DELAYED_REPLY_APOLOGY_AFTER_MS - 1)
    const current = message({ id: 'current' })
    expect(assessDelayedReply({ currentMessage: current, history: [earlier, current], nowMs: NOW_MS }))
      .toMatchObject({
        gate: 'normal',
        reason: 'earlier_unanswered_inbound_is_recent',
        prependApology: false,
      })
  })

  it('prepends one concise apology to a fresh follow-up after one hour', () => {
    const earlier = inboundAt('earlier', DELAYED_REPLY_APOLOGY_AFTER_MS)
    const current = message({ id: 'current' })
    const result = assessDelayedReply({
      currentMessage: current,
      history: [earlier, current],
      nowMs: NOW_MS,
    })

    expect(result).toMatchObject({
      gate: 'normal',
      reason: 'delayed_reply_apology_required',
      prependApology: true,
      unansweredMessageCount: 1,
    })
    expect(prependDelayedReplyApology('Подскажите Ваш город.', result)).toBe(
      `${DELAYED_REPLY_APOLOGY}\n\nПодскажите Ваш город.`,
    )
  })

  it('requires a person when unanswered context is at least 72 hours old', () => {
    const earlier = inboundAt('earlier', DELAYED_REPLY_HUMAN_AFTER_MS)
    const current = message({ id: 'current' })
    expect(assessDelayedReply({ currentMessage: current, history: [earlier, current], nowMs: NOW_MS }))
      .toMatchObject({
        gate: 'human',
        reason: 'very_stale_unanswered_context',
        prependApology: true,
      })
  })

  it('keeps the answer as a draft when the follow-up itself is no longer fresh', () => {
    const currentOccurredAt = NOW_MS - DELAYED_REPLY_FRESH_INBOUND_MAX_AGE_MS - 1
    const earlier = message({
      id: 'earlier',
      status: 'imported',
      metadata: { providerTimestampTrusted: true, catchUp: true, live: false },
      occurredAt: new Date(currentOccurredAt - 2 * 60 * 60 * 1_000).toISOString(),
    })
    const current = message({
      id: 'current',
      occurredAt: new Date(currentOccurredAt).toISOString(),
    })
    expect(assessDelayedReply({ currentMessage: current, history: [earlier, current], nowMs: NOW_MS }))
      .toMatchObject({
        gate: 'draft',
        reason: 'delayed_follow_up_not_fresh',
        prependApology: true,
      })
  })

  it('never auto-sends delayed context with an untrusted timestamp', () => {
    const earlier = inboundAt('earlier', 2 * 60 * 60 * 1_000)
    const current = message({
      id: 'current',
      metadata: { providerTimestampTrusted: false, live: true },
    })
    expect(assessDelayedReply({ currentMessage: current, history: [earlier, current], nowMs: NOW_MS }))
      .toMatchObject({ gate: 'draft', reason: 'delayed_reply_timestamp_ambiguous' })
  })

  it('treats a confirmed outbound after the older inbound as an answer', () => {
    const earlier = inboundAt('earlier', 2 * 60 * 60 * 1_000)
    const sent = message({
      id: 'sent',
      direction: 'out',
      status: 'delivered',
      text: 'Подскажите Ваш город.',
      occurredAt: new Date(NOW_MS - 90 * 60 * 1_000).toISOString(),
    })
    const current = message({ id: 'current' })
    expect(assessDelayedReply({ currentMessage: current, history: [earlier, sent, current], nowMs: NOW_MS }))
      .toMatchObject({
        gate: 'normal',
        reason: 'no_earlier_unanswered_inbound',
        prependApology: false,
      })
  })

  it('does not repeat an apology that was confirmed in an earlier episode', () => {
    const apology = message({
      id: 'apology',
      direction: 'out',
      status: 'sent',
      text: `${DELAYED_REPLY_APOLOGY}\n\nЧем помочь?`,
      metadata: { delayedReplyApologyIncluded: true },
      occurredAt: new Date(NOW_MS - 4 * 60 * 60 * 1_000).toISOString(),
    })
    const earlier = inboundAt('earlier', 2 * 60 * 60 * 1_000)
    const current = message({ id: 'current' })
    expect(assessDelayedReply({
      currentMessage: current,
      history: [apology, earlier, current],
      nowMs: NOW_MS,
    })).toMatchObject({
      gate: 'normal',
      reason: 'delayed_reply_apology_already_sent',
      prependApology: false,
    })
  })

  it('accepts provider-imported outbound history as confirmed, but not a failed row', () => {
    const importedOutbound = message({
      id: 'imported-out',
      direction: 'out',
      status: 'imported',
      metadata: { catchUp: true, fromMe: true },
    })
    const failedOutbound = message({
      id: 'failed-out',
      direction: 'out',
      status: 'failed',
    })
    expect(isConfirmedOutboundMessage(importedOutbound)).toBe(true)
    expect(isConfirmedOutboundMessage(failedOutbound)).toBe(false)
  })

  it('keeps the apology decorator idempotent', () => {
    const result = { prependApology: true }
    const once = prependDelayedReplyApology('Ответ', result)
    expect(prependDelayedReplyApology(once, result)).toBe(once)
  })
})
