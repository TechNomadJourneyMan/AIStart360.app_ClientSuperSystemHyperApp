/**
 * lib/popups/types.ts — vocabulary of the cabinet pop-up layer
 * (docs/superpowers/specs/2026-10-18-point-b-design.md §12.2).
 *
 * Only expert messages exist as a source today (comm_messages with
 * author_kind = 'staff'); recommendations and insights arrive with Point B
 * phase 1+ and use the same candidate shape.
 */

export type PopupKind = 'expert_message' | 'recommendation' | 'insight'

export interface PopupCandidate {
  /** comm_messages.id for an expert message. */
  id: string
  kind: PopupKind
  display: 'card' | 'modal'
  /** Smaller = more important. */
  priority: number
  title: string
  body: string
  authorName: string | null
  authorSpecialty: string | null
  createdAt: string
  /** Deep link into the cabinet. */
  href: string | null
  /** The expert marked the message «важное / требует ответа». */
  important: boolean
  canReply: boolean
}

/** Per-pop-up state kept in comm_messages.metadata.popup. */
export interface PopupState {
  id: string
  seenAt?: string
  dismissedAt?: string
  snoozedUntil?: string
}

export interface PopupRules {
  /** Recommendation / insight cards per day. */
  cardsPerDay: number
  /** Modal windows per day (an important message that needs a reply is never dropped, only shown as a card). */
  modalPerDay: number
  /** Expert messages older than this are not pushed as pop-ups. */
  messageWindowDays: number
}

export interface PopupContext {
  now: Date
  pro: boolean
  impersonating: boolean
  doNotDisturbUntil: string | null
  /** Current pathname. */
  route: string
  /** Shown today: recommendation/insight cards (expert messages are not counted) and modal windows. */
  shownToday: { cards: number; modals: number }
}

export const DEFAULT_POPUP_RULES: PopupRules = { cardsPerDay: 3, modalPerDay: 1, messageWindowDays: 3 }

/** Snooze lengths offered to the user, in days. */
export const POPUP_SNOOZE_DAYS = [3, 7, 30] as const
export type PopupSnoozeDays = (typeof POPUP_SNOOZE_DAYS)[number]

export type PopupAction = 'seen' | 'dismiss' | 'snooze' | 'acted'
