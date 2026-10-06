/**
 * OCR for scans: image-only PDFs and photos (PNG / JPEG).
 *
 *   PDF → page images: pdf-parse v2 `getScreenshot()` (pdfjs-dist rendering on
 *         @napi-rs/canvas — both already installed as pdf-parse dependencies;
 *         no new packages)
 *   image → text: tesseract.js (rus+eng)
 *
 * OCR is OFF unless DOCUMENT_OCR_ENABLED=true: tesseract downloads its
 * language data (~15–20 MB for rus+eng) from a CDN on first use and needs
 * seconds per page, which a serverless function may not afford. When OCR is
 * off or fails, callers mark the document `needs_ocr` with an explanation —
 * they never pretend it was processed.
 *
 * The recognizer is injectable (`setOcrEngine`) so the pipeline can be tested
 * without tesseract.
 */
import { tmpdir } from 'node:os'

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

export interface OcrPage {
  page: number
  text: string
  /** 0..100 as reported by the engine. */
  confidence: number
}

export interface OcrEngine {
  readonly name: string
  recognize(images: Array<{ page: number; image: Buffer }>, opts: { langs: string[]; deadlineAt: number }): Promise<OcrPage[]>
}

export type OcrOutcome =
  | { ok: true; pages: OcrPage[]; totalPages: number; engine: string; meanConfidence: number }
  | { ok: false; reason: 'disabled' | 'no_pages' | 'failed' | 'timeout'; message: string }

export function ocrEnabled(): boolean {
  return process.env.DOCUMENT_OCR_ENABLED === 'true'
}

/**
 * Heuristic gate: did the primary text extractor (`pdf-parse`) return so
 * little text that the file is almost certainly image-only?
 * True only when the text is < 200 chars AND the file is > 50 KB.
 */
export function shouldFallbackToOcr(extractedText: string, fileSize: number): boolean {
  const textLen = (extractedText ?? '').length
  return textLen < 200 && fileSize > 50 * 1024
}

/** Render the first `maxPages` PDF pages to PNG. */
export async function rasterizePdf(buffer: Buffer, opts: { maxPages?: number; scale?: number } = {}): Promise<{ total: number; images: Array<{ page: number; image: Buffer }> }> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: buffer })
  try {
    const shots = await parser.getScreenshot({
      first: opts.maxPages ?? 5,
      scale: opts.scale ?? 2,
      imageBuffer: true,
      imageDataUrl: false,
    })
    return {
      total: shots.total,
      images: shots.pages.filter((p) => p.data?.length).map((p) => ({ page: p.pageNumber, image: Buffer.from(p.data) })),
    }
  } finally {
    await parser.destroy().catch(() => {})
  }
}

const tesseractEngine: OcrEngine = {
  name: 'tesseract',
  async recognize(images, { langs, deadlineAt }) {
    const { createWorker } = await import('tesseract.js')
    const worker = await createWorker(langs, 1, { cachePath: tmpdir() })
    try {
      const out: OcrPage[] = []
      for (const { page, image } of images) {
        if (Date.now() > deadlineAt) break
        const res = await worker.recognize(image)
        out.push({ page, text: (res?.data?.text ?? '').trim(), confidence: Number(res?.data?.confidence ?? 0) })
      }
      return out
    } finally {
      await worker.terminate().catch(() => {})
    }
  },
}

let engineOverride: OcrEngine | null = null

/** Swap the recognizer (tests). `null` restores tesseract. */
export function setOcrEngine(engine: OcrEngine | null): void {
  engineOverride = engine
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve('timeout'), Math.max(0, ms))
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

/** OCR a scanned PDF (first `maxPages` pages) or a single image. Never throws. */
export async function ocrDocument(
  buffer: Buffer,
  kind: 'pdf' | 'image',
  opts: { maxPages?: number; deadlineAt?: number; langs?: string[]; force?: boolean } = {},
): Promise<OcrOutcome> {
  if (!opts.force && !ocrEnabled() && !engineOverride) {
    return { ok: false, reason: 'disabled', message: 'распознавание сканов (OCR) не включено' }
  }
  const deadlineAt = opts.deadlineAt ?? Date.now() + 90_000
  try {
    const raster = kind === 'pdf'
      ? await rasterizePdf(buffer, { maxPages: opts.maxPages ?? 5 })
      : { total: 1, images: [{ page: 1, image: buffer }] }
    if (!raster.images.length) return { ok: false, reason: 'no_pages', message: 'не удалось получить изображения страниц' }
    const engine = engineOverride ?? tesseractEngine
    const pages = await withTimeout(
      engine.recognize(raster.images, { langs: opts.langs ?? ['rus', 'eng'], deadlineAt }),
      deadlineAt - Date.now(),
    )
    if (pages === 'timeout') return { ok: false, reason: 'timeout', message: 'распознавание не уложилось во время' }
    const meanConfidence = pages.length ? pages.reduce((s, p) => s + p.confidence, 0) / pages.length : 0
    return { ok: true, pages, totalPages: raster.total, engine: engine.name, meanConfidence }
  } catch (err) {
    console.info('[ocr] failed', err instanceof Error ? err.message : String(err))
    return { ok: false, reason: 'failed', message: 'распознавание завершилось ошибкой' }
  }
}

/**
 * Back-compat wrapper: OCR a PDF buffer into one text blob. Rasterises first
 * (tesseract does not read PDFs). Returns null on any failure.
 */
export async function ocrPdfBuffer(buf: Buffer, opts?: OcrOptions): Promise<OcrResult | null> {
  const res = await ocrDocument(buf, 'pdf', { maxPages: opts?.maxPages ?? 10, langs: opts?.langs, force: true })
  if (!res.ok) return null
  return {
    text: res.pages.map((p) => p.text).join('\n\n').trim(),
    confidence: res.meanConfidence,
    pages: res.pages.length,
    engine: 'tesseract',
  }
}
