/**
 * lib/comm/moderation.ts — the profanity rules of platform communication,
 * on top of lib/moderation/profanity.ts (its rules are not changed here).
 *
 *   inbound (user → platform)   stored as written; body_masked «б***» and
 *                               flags { profanity, words } for the staff feed;
 *                               the user gets PROFANITY_WARNING back on the
 *                               same channel at most once per 6 h per thread;
 *                               comm_threads.profanity_count + 1.
 *   staff outbound              refused: ProfanityError naming the field
 *                               (direct messages now, broadcast title / body
 *                               in phase 3 — use assertCleanOutbound).
 *   bot / AI outbound           masked before sending: sanitizeBotReply().
 *   the user's own feed         shows his text as written.
 */
import { dirtyField, findProfanity, maskProfanity, ProfanityError } from '@/lib/moderation/profanity'
import { shouldSendReceipt } from './state'
import type { CommMessageFlags } from './types'

export { PROFANITY_WARNING, ProfanityError } from '@/lib/moderation/profanity'

/** The automatic warning goes at most once per this many hours per thread. */
export const PROFANITY_WARN_EVERY_HOURS = 6

export interface InboundModeration {
  bodyMasked: string | null
  flags: CommMessageFlags
}

export function moderateInbound(body: string): InboundModeration {
  const found = findProfanity(body)
  if (!found.length) return { bodyMasked: null, flags: {} }
  return { bodyMasked: maskProfanity(body), flags: { profanity: true, words: found.length } }
}

export function shouldWarnProfanity(lastWarnedAt: string | null, now: Date): boolean {
  return shouldSendReceipt(lastWarnedAt, now, PROFANITY_WARN_EVERY_HOURS)
}

/** Every bot / AI reply passes through this before it is sent or stored. */
export function sanitizeBotReply(text: string): string {
  return maskProfanity(text)
}

/** Staff texts (message body / subject, broadcast title / body): throws ProfanityError(field). */
export function assertCleanOutbound(fields: Record<string, string | null | undefined>): void {
  const field = dirtyField(fields)
  if (field) throw new ProfanityError(field)
}

/** What staff see in the feed: the masked text when there is one. */
export function staffVisibleBody(m: { body: string; body_masked: string | null }): string {
  return m.body_masked ?? m.body
}
