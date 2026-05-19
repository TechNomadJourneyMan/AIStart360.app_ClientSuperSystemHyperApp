// Unit tests for the OCR fallback decision heuristic.
// We do NOT exercise `ocrPdfBuffer` here — running Tesseract in unit tests is
// prohibitively slow and pulls in heavy worker assets. The recognition path
// is covered by integration tests elsewhere (when added).

import { describe, expect, it } from 'vitest'
import { shouldFallbackToOcr } from '@/lib/documents/ocr'

const KB = 1024

describe('shouldFallbackToOcr', () => {
  it('returns true when text is empty and file is large (typical scanned PDF)', () => {
    expect(shouldFallbackToOcr('', 200 * KB)).toBe(true)
  })

  it('returns false when extracted text is substantial', () => {
    const longText = 'a'.repeat(5_000)
    expect(shouldFallbackToOcr(longText, 5 * 1024 * 1024)).toBe(false)
  })

  it('returns false when file is tiny even if text is empty (likely empty/corrupt PDF, not a scan)', () => {
    expect(shouldFallbackToOcr('', 10 * KB)).toBe(false)
  })

  it('returns false at the 200-char text boundary (>= 200 chars is "enough")', () => {
    const exactly200 = 'x'.repeat(200)
    expect(shouldFallbackToOcr(exactly200, 1024 * KB)).toBe(false)
  })

  it('returns true just below the 200-char text boundary on a large file', () => {
    const just199 = 'x'.repeat(199)
    expect(shouldFallbackToOcr(just199, 1024 * KB)).toBe(true)
  })

  it('returns false at the 50KB file-size boundary (must be strictly greater)', () => {
    expect(shouldFallbackToOcr('', 50 * KB)).toBe(false)
  })

  it('returns true just above the 50KB file-size boundary with empty text', () => {
    expect(shouldFallbackToOcr('', 50 * KB + 1)).toBe(true)
  })

  it('tolerates null-ish text input without throwing', () => {
    // shouldFallbackToOcr defends against undefined via `?? ''`
    expect(
      shouldFallbackToOcr(undefined as unknown as string, 500 * KB),
    ).toBe(true)
  })
})
