/**
 * OCR fallback for image-only / scanned PDFs.
 *
 * `pdf-parse` silently returns empty text on PDFs that contain only rasterized
 * images (scans, photographed pages, image-export PDFs). This module provides:
 *
 *   1. `shouldFallbackToOcr()` — cheap heuristic to decide whether to invoke
 *      OCR, based on the (likely empty) text returned by `pdf-parse` and the
 *      original file size.
 *   2. `ocrPdfBuffer()` — rasterizes a bounded number of PDF pages with the
 *      already-installed pdf-parse worker, then runs Tesseract.js over each
 *      PNG. Never throws — returns `null` on any error.
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
 * Tesseract.js does not decode PDF containers. Rasterize pages first, then
 * recognize the resulting PNG buffers. The page cap prevents a scanned annual
 * report from consuming an unbounded Vercel invocation.
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

    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buf })
    let pageImages: Array<{ data: Uint8Array }> = []
    try {
      const screenshots = await parser.getScreenshot({
        scale: 1.5,
        first: Math.max(1, maxPages),
        imageDataUrl: false,
        imageBuffer: true,
      })
      pageImages = screenshots.pages.slice(0, maxPages)
    } finally {
      await parser.destroy().catch(() => undefined)
    }
    if (pageImages.length === 0) return null

    worker = await createWorker(langStr)

    const pageTexts: string[] = []
    let confidenceTotal = 0
    let confidenceCount = 0
    for (const page of pageImages) {
      const result = await worker.recognize(Buffer.from(page.data))
      const pageText = (result?.data?.text ?? '').trim()
      if (pageText) pageTexts.push(pageText)
      if (typeof result?.data?.confidence === 'number') {
        confidenceTotal += result.data.confidence
        confidenceCount += 1
      }
    }

    const text = pageTexts.join('\n\n').trim()
    const confidence = confidenceCount > 0 ? confidenceTotal / confidenceCount : 0

    const elapsedMs = Date.now() - start
    console.info('[ocr] done', {
      chars: text.length,
      confidence,
      elapsedMs,
    })

    return {
      text,
      confidence,
      pages: pageImages.length,
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

/** OCR a standalone PNG/JPEG upload. */
export async function ocrImageBuffer(
  buf: Buffer,
  opts?: Pick<OcrOptions, 'langs'>,
): Promise<OcrResult | null> {
  const langs = opts?.langs ?? ['rus', 'eng']
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null
  try {
    worker = await createWorker(langs.join('+'))
    const result = await worker.recognize(buf)
    const text = (result?.data?.text ?? '').trim()
    return {
      text,
      confidence:
        typeof result?.data?.confidence === 'number'
          ? result.data.confidence
          : 0,
      pages: 1,
      engine: 'tesseract',
    }
  } catch (error) {
    console.info('[ocr] image recognition failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  } finally {
    if (worker) {
      await worker.terminate().catch(() => undefined)
    }
  }
}
