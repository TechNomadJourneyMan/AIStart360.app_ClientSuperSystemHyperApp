const MIN_TYPING_SECONDS = 2
const MAX_TYPING_SECONDS = 6

function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * A deterministic delay is important for Inngest replays: the same message
 * must always schedule the same durable sleep. Answer length provides the
 * human-looking typing component and the stable message id adds 0-1s jitter.
 */
export function humanTypingDelaySeconds(text: string, stableMessageId: string): number {
  const characterCount = Array.from(text.trim()).length
  const lengthSeconds = Math.min(3, Math.floor(characterCount / 90))
  const stableJitter = stableHash(stableMessageId) % 2
  return Math.min(
    MAX_TYPING_SECONDS,
    Math.max(MIN_TYPING_SECONDS, MIN_TYPING_SECONDS + lengthSeconds + stableJitter),
  )
}
