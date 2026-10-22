/**
 * lib/popups/select.ts — which pop-ups the cabinet shows right now
 * (pure, no IO; spec §12.2).
 *
 *   - impersonation → nothing (an admin driving the cabinet must not see, or
 *     mark as seen, the user's messages);
 *   - wizard / sign-in / messages pages → nothing;
 *   - expert messages: no daily caps, only the age window; the user cannot
 *     switch them off, «не беспокоить» does not hide them;
 *   - recommendations and insights: PRO only, hidden by «не беспокоить»,
 *     at most `cardsPerDay` cards a day;
 *   - modal: an important expert message, or a critical Point B insight (an
 *     invite with display 'modal', e.g. a cash gap in the first months) —
 *     `modalPerDay` a day together; when the modal budget is spent an important
 *     message (or a critical insight) is shown as a card, never dropped;
 *   - dismissed / snoozed are hidden; a card already seen is not repeated.
 *
 * The result is ordered by `priority`, then newest first.
 */
import type { PopupCandidate, PopupContext, PopupRules, PopupState } from './types'

const SUPPRESSED_PREFIXES = ['/client/messages', '/client/onboarding', '/client/survey', '/login', '/register', '/client/waiting-room']

/** Pages where nothing may pop up (the wizard, sign-in, the conversation itself). */
export function isPopupSuppressedRoute(route: string): boolean {
  const path = route.split(/[?#]/)[0]
  return SUPPRESSED_PREFIXES.some((p) => path === p || path.startsWith(p))
}

const DAY_MS = 86_400_000

function futureIso(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && t > now.getTime()
}

export function selectPopups(
  candidates: PopupCandidate[],
  states: Record<string, PopupState>,
  ctx: PopupContext,
  rules: PopupRules,
): PopupCandidate[] {
  if (ctx.impersonating || isPopupSuppressedRoute(ctx.route)) return []
  const { now } = ctx
  const dnd = futureIso(ctx.doNotDisturbUntil, now)
  const windowStart = now.getTime() - Math.max(0, rules.messageWindowDays) * DAY_MS

  const eligible = candidates.filter((c) => {
    const st = states[c.id]
    if (st?.dismissedAt || futureIso(st?.snoozedUntil, now)) return false
    if (st?.seenAt && c.display === 'card') return false
    if (c.kind === 'expert_message') {
      const t = new Date(c.createdAt).getTime()
      return Number.isFinite(t) && t >= windowStart
    }
    return ctx.pro && !dnd
  })

  eligible.sort((a, b) => a.priority - b.priority || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))

  let modalsLeft = Math.max(0, rules.modalPerDay - ctx.shownToday.modals)
  let cardsLeft = Math.max(0, rules.cardsPerDay - ctx.shownToday.cards)
  const out: PopupCandidate[] = []
  for (const c of eligible) {
    let display: PopupCandidate['display'] = 'card'
    if (c.kind === 'expert_message') {
      if (c.important && c.display === 'modal' && modalsLeft > 0) {
        display = 'modal'
        modalsLeft -= 1
      }
    } else {
      if (cardsLeft <= 0) continue
      cardsLeft -= 1
      if (c.display === 'modal' && modalsLeft > 0) {
        display = 'modal'
        modalsLeft -= 1
      }
    }
    out.push(display === c.display ? c : { ...c, display })
  }
  return out
}
