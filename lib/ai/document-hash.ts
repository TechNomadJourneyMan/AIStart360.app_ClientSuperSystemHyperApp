/**
 * Document hashing — used for:
 *   1. Idempotency on upload (same bytes = same document, no re-insert).
 *   2. Extraction cache key (same hash = reuse existing ai_extractions, skip LLM).
 *
 * Node-only module (uses `node:crypto`). Do NOT import from client components.
 */

import { createHash } from 'node:crypto'

/** Compute sha256 hex digest of raw bytes. */
export function hashBytes(bytes: Buffer | Uint8Array | ArrayBuffer): string {
  const hash = createHash('sha256')
  if (bytes instanceof ArrayBuffer) {
    hash.update(Buffer.from(bytes))
  } else {
    hash.update(bytes as Buffer)
  }
  return hash.digest('hex')
}

/**
 * Hash a readable stream incrementally. For files > 100 MB prefer this over
 * buffering into memory. Returns sha256 hex.
 */
export async function hashStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const hash = createHash('sha256')
  const reader = stream.getReader()
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) hash.update(value)
    }
  } finally {
    reader.releaseLock()
  }
  return hash.digest('hex')
}

/** Stable hash of survey answers (for idempotency when re-submitting same answers). */
export function hashSurveyAnswers(answers: Record<string, unknown>): string {
  // Deterministic serialization: sort keys then JSON
  const sortedKeys = Object.keys(answers).sort()
  const payload = JSON.stringify(sortedKeys.map((k) => [k, answers[k]]))
  return createHash('sha256').update(payload).digest('hex')
}

/**
 * Short hash for UI display — first 8 hex chars.
 * Not cryptographically meaningful; just for debug labels.
 */
export function shortHash(fullHash: string): string {
  return fullHash.slice(0, 8)
}
