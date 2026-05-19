/**
 * OCR fallback for image-only / scanned PDFs.
 *
 * `pdf-parse` silently returns empty text on PDFs that contain only rasterized
 * images (scans, photographed pages, image-export PDFs). This module provides:
 *
 *   1. `shouldFallbackToOcr()` — cheap heuristic to decide whether to invoke
 *      OCR, based on the (likely empty) text returned by `pdf-parse` and the
 *      original file size.
 *   2. `ocrPdfBuffer()` — runs Tesseract.js over the PDF buffer and returns
 *      best-effort text. Never throws — returns `null` on any error.
 *
 * NOTE: OCR is slow (seconds-to-minutes per page). Callers must gate this
 * behind `shouldFallbackToOcr()` and respect `maxPages`. Default langs target
 * Russian + English business documents.
 *
 * Integration into `lib/documents/parse.ts` / `extract.ts` is deliberately
 * deferred — see review note on those files.
 */

import { createWorker } from 'tesseract.js'

export interface OcrResult {
  text: string
  confidence: number
  pages: number
  engine: 'tesseract'
}

export interface OcrOptions {
  langs?: string[]
  maxPages?: number
}

/**
 * Heuristic gate: did the primary text extractor (`pdf-parse`) return so
 * little text that the file is almost certainly image-only?
 *
 * Returns `true` only when BOTH:
 *   - extracted text length < 200 chars (essentially empty)
 *   - file size > 50 KB (large enough to plausibly contain real content)
 *
 * A small file with no text is more likely a genuinely empty / corrupt PDF
 * than a scanned page, so we skip OCR there to avoid wasted work.
 */
export function shouldFallbackToOcr(
  extractedText: string,
  fileSize: number,
): boolean {
  const textLen = (extractedText ?? '').length
  return textLen < 200 && fileSize > 50 * 1024
}

/**
 * Run Tesseract OCR over a PDF buffer.
 *
 * Tesseract.js can accept a buffer directly for single-image inputs; for
 * multi-page PDFs it internally rasterizes via its bundled worker. We pass
 * the buffer as-is and let the worker handle decoding. If rasterization
 * fails (older tesseract.js builds, missing native deps in certain
 * runtimes), we swallow and return `null` — the caller falls back to the
 * empty-text path.
 *
 * Returns `null` on any failure. Never throws.
 */
export async function ocrPdfBuffer(
  buf: Buffer,
  opts?: OcrOptions,
): Promise<OcrResult | null> {
  const langs = opts?.langs ?? ['rus', 'eng']
  const maxPages = opts?.maxPages ?? 10
  const langStr = langs.join('+')
  const start = Date.now()

  let worker: Awaited<ReturnType<typeof createWorker>> | null = null
  try {
    console.info('[ocr] starting', {
      langs: langStr,
      maxPages,
      bytes: buf.byteLength,
    })

    worker = await createWorker(langs)

    // tesseract.js accepts Buffer / Uint8Array via the recognize API.
    // For multi-page PDFs the worker rasterizes internally; we cannot
    // easily enforce maxPages at the worker level, so it is honored
    // primarily as documentation + a hook for future per-page splitting.
    const result = await worker.recognize(buf)

    const text = (result?.data?.text ?? '').trim()
    const confidence =
      typeof result?.data?.confidence === 'number'
        ? result.data.confidence
        : 0

    const elapsedMs = Date.now() - start
    console.info('[ocr] done', {
      chars: text.length,
      confidence,
      elapsedMs,
    })

    return {
      text,
      confidence,
      pages: 0, // unknown from single recognize() call; left as 0 sentinel
      engine: 'tesseract',
    }
  } catch (err) {
    const elapsedMs = Date.now() - start
    console.info('[ocr] failed', {
      elapsedMs,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  } finally {
    if (worker) {
      try {
        await worker.terminate()
      } catch {
        // ignore termination errors — worker may already be gone
      }
    }
  }
}
