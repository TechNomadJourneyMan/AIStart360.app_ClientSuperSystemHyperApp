import type { OmnichannelMessage } from './types'

const MINUTE_MS = 60 * 1_000
const HOUR_MS = 60 * MINUTE_MS

/** A shorter gap usually reads more naturally without a formal apology. */
export const DELAYED_REPLY_APOLOGY_AFTER_MS = HOUR_MS
/** Older unanswered context is too easy to misread without a person. */
export const DELAYED_REPLY_HUMAN_AFTER_MS = 72 * HOUR_MS
/** The apology policy is only allowed to auto-send on a genuinely fresh event. */
export const DELAYED_REPLY_FRESH_INBOUND_MAX_AGE_MS = 15 * MINUTE_MS
export const DELAYED_REPLY_APOLOGY = 'Извините, что ответили не сразу.'

const CONFIRMED_OUTBOUND_STATUSES = new Set([
  'sent',
  'delivered',
  'read',
])

function parsedTime(value: string | null | undefined): number | null {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function metadataFlag(message: OmnichannelMessage, key: string): boolean {
  return message.metadata[key] === true
}

/**
 * Imported provider history is a confirmation when it is an outbound row: the
 * provider itself reported that the account sent it. Draft/failed placeholders
 * are intentionally excluded so they cannot suppress a needed answer.
 */
export function isConfirmedOutboundMessage(message: OmnichannelMessage): boolean {
  if (message.direction !== 'out') return false
  if (CONFIRMED_OUTBOUND_STATUSES.has(message.status)) return true
  return message.status === 'imported'
    && (
      metadataFlag(message, 'catchUp')
      || metadataFlag(message, 'offline')
      || metadataFlag(message, 'historicalOutbound')
      || metadataFlag(message, 'fromMe')
    )
}

/** Defense in depth: callers must never rely only on an event's force_draft flag. */
export function isHistoricalCatchUpMessage(message: OmnichannelMessage): boolean {
  return message.status === 'imported'
    || message.metadata.live === false
    || metadataFlag(message, 'catchUp')
    || metadataFlag(message, 'offline')
}

function hasSentDelayApology(history: OmnichannelMessage[]): boolean {
  return history.some((message) => {
    if (!isConfirmedOutboundMessage(message)) return false
    if (metadataFlag(message, 'delayedReplyApologyIncluded')) return true
    const text = message.text ?? ''
    return /извин(?:ите|яемся)[^.!?\n]{0,80}(?:не\s+сразу|задерж|долг)/iu.test(text)
  })
}

export type DelayedReplyGate = 'normal' | 'draft' | 'human'

export interface DelayedReplyAssessment {
  gate: DelayedReplyGate
  reason: string
  prependApology: boolean
  unansweredAgeMs: number | null
  unansweredMessageCount: number
}

function assessment(
  gate: DelayedReplyGate,
  reason: string,
  input: {
    prependApology?: boolean
    unansweredAgeMs?: number | null
    unansweredMessageCount?: number
  } = {},
): DelayedReplyAssessment {
  return {
    gate,
    reason,
    prependApology: input.prependApology === true,
    unansweredAgeMs: input.unansweredAgeMs ?? null,
    unansweredMessageCount: input.unansweredMessageCount ?? 0,
  }
}

/**
 * Finds inbound rows before the current one that have no confirmed outbound
 * after them. A fresh follow-up may receive a single apology; old or ambiguous
 * context is retained as a draft/escalation and can never auto-send.
 */
export function assessDelayedReply(input: {
  currentMessage: OmnichannelMessage
  history: OmnichannelMessage[]
  forceDraft?: boolean
  nowMs?: number
}): DelayedReplyAssessment {
  const current = input.currentMessage
  if (input.forceDraft || isHistoricalCatchUpMessage(current)) {
    return assessment('draft', 'historical_catch_up_draft_only')
  }

  const currentIndex = input.history.findIndex((message) => message.id === current.id)
  const beforeCurrent = currentIndex >= 0
    ? input.history.slice(0, currentIndex)
    : input.history.filter((message) => {
        const messageMs = parsedTime(message.occurredAt)
        const currentMs = parsedTime(current.occurredAt)
        return message.id !== current.id
          && messageMs !== null
          && currentMs !== null
          && messageMs <= currentMs
      })

  let lastConfirmedOutboundIndex = -1
  beforeCurrent.forEach((message, index) => {
    if (isConfirmedOutboundMessage(message)) lastConfirmedOutboundIndex = index
  })
  const unanswered = beforeCurrent
    .slice(lastConfirmedOutboundIndex + 1)
    .filter((message) => message.direction === 'in')
  if (unanswered.length === 0) {
    return assessment('normal', 'no_earlier_unanswered_inbound')
  }

  const currentMs = parsedTime(current.occurredAt)
  const unansweredTimes = unanswered.map((message) => parsedTime(message.occurredAt))
  if (
    currentMs === null
    || current.metadata.providerTimestampTrusted !== true
    || unansweredTimes.some((value) => value === null)
  ) {
    return assessment('draft', 'delayed_reply_timestamp_ambiguous', {
      unansweredMessageCount: unanswered.length,
    })
  }

  const earliestMs = Math.min(...unansweredTimes as number[])
  const unansweredAgeMs = currentMs - earliestMs
  if (unansweredAgeMs < -5 * MINUTE_MS) {
    return assessment('draft', 'delayed_reply_history_order_ambiguous', {
      unansweredAgeMs,
      unansweredMessageCount: unanswered.length,
    })
  }
  if (unansweredAgeMs < DELAYED_REPLY_APOLOGY_AFTER_MS) {
    return assessment('normal', 'earlier_unanswered_inbound_is_recent', {
      unansweredAgeMs: Math.max(0, unansweredAgeMs),
      unansweredMessageCount: unanswered.length,
    })
  }

  const apologyAlreadySent = hasSentDelayApology(beforeCurrent)
  const prependApology = !apologyAlreadySent
  if (unansweredAgeMs >= DELAYED_REPLY_HUMAN_AFTER_MS) {
    return assessment('human', 'very_stale_unanswered_context', {
      prependApology,
      unansweredAgeMs,
      unansweredMessageCount: unanswered.length,
    })
  }

  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs! : Date.now()
  const currentAgeMs = nowMs - currentMs
  if (
    currentAgeMs < -5 * MINUTE_MS
    || currentAgeMs > DELAYED_REPLY_FRESH_INBOUND_MAX_AGE_MS
  ) {
    return assessment('draft', 'delayed_follow_up_not_fresh', {
      prependApology,
      unansweredAgeMs,
      unansweredMessageCount: unanswered.length,
    })
  }

  return assessment('normal', prependApology
    ? 'delayed_reply_apology_required'
    : 'delayed_reply_apology_already_sent', {
    prependApology,
    unansweredAgeMs,
    unansweredMessageCount: unanswered.length,
  })
}

export function prependDelayedReplyApology(
  answer: string,
  assessmentResult: Pick<DelayedReplyAssessment, 'prependApology'>,
): string {
  const trimmed = answer.trim()
  if (!assessmentResult.prependApology || !trimmed) return trimmed
  if (trimmed.startsWith(DELAYED_REPLY_APOLOGY)) return trimmed
  return `${DELAYED_REPLY_APOLOGY}\n\n${trimmed}`
}

