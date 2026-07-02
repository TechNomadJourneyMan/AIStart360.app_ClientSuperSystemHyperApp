/**
 * lib/assistant/mascot/sanitize.ts — PII masking for LLM-bound text.
 *
 * The curated AssistantContext is already a whitelist (lib/assistant/context.ts),
 * but its QUALITATIVE survey answers are free text typed by the user — they can
 * carry emails, phone numbers or links that the model simply does not need.
 * These helpers scrub such fragments before the text reaches a prompt
 * (docs/TZ-mascot-assistant.md §11.5, §17.2).
 *
 * Deliberately conservative: only patterns that are unmistakably contact data
 * are replaced. Bare long numbers are LEFT ALONE — in this product they are
 * usually money amounts (₸), and masking them would corrupt the snapshot.
 *
 * Pure module — no imports, unit-tested in tests/unit/assistant-mascot/.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

// URLs (http/https/www). Kept before the phone pass so digits inside a URL
// don't get half-masked into garbage.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi

// Phone numbers as typed in KZ/RU practice: an optional +, then 7/8, then
// 9–10 more digits allowing space/dash/paren separators. Requires the
// separator-or-plus shape (or exactly 11 digits starting 7/8) so that plain
// money amounts ("12000000") never match.
const PHONE_RE =
  /(?:\+7|\b[78])[\s(-]?\d{3}[\s)-]?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g

/** Replace emails, URLs and phone numbers with neutral placeholders. */
export function maskPii(text: string): string {
  if (!text) return text
  return text
    .replace(URL_RE, '[ссылка скрыта]')
    .replace(EMAIL_RE, '[email скрыт]')
    .replace(PHONE_RE, '[телефон скрыт]')
}

/**
 * Sanitize one qualitative survey value on its way into a prompt:
 * PII-mask + trim + hard length cap (defense-in-depth against a pasted
 * document blob inflating the context).
 */
export function sanitizeQualitative(value: string, maxLen = 280): string {
  return maskPii(value).trim().slice(0, maxLen)
}
