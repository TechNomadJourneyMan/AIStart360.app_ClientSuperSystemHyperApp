/**
 * OCR for scans: image-only PDFs and photos (PNG / JPEG).
 *
 *   PDF → page images: pdf-parse v2 `getScreenshot()` (pdfjs-dist rendering on
 *         @napi-rs/canvas — both already installed as pdf-parse dependencies)
 *   photo → normalised PNG: sharp (EXIF rotation, grayscale, ≤ 3000 px)
 *   image → text: an OcrEngine
 *     local   tesseract.js (WASM) with language data from node_modules
 *             (@tesseract.js-data/*, see ./ocr-tessdata.ts) — fully offline
 *     remote  any caller registered with `registerRemoteOcr(fn)` (e.g. DeepSeek
 *             OCR through the providers router); a failed page falls back to
 *             the local engine
 *
 * Configuration (env):
 *   DOCUMENT_OCR_ENABLED    'false' disables OCR. Otherwise OCR is ON whenever
 *                           an engine can run (local language data present, or
 *                           a remote engine registered).
 *   DOCUMENT_OCR_LANGS      default "rus,eng"; "rus,eng,kaz" adds Kazakh
 *   DOCUMENT_OCR_MAX_PAGES  default 15, max 50 — pages rendered per PDF
 *   DOCUMENT_OCR_ENGINE     auto (default) | local | remote
 *   DOCUMENT_OCR_LANG_PATH  optional local folder with <lang>.traineddata[.gz]
 *                           (URLs are rejected — data is never downloaded)
 *
 * Every run is bounded by `deadlineAt`: a page that does not finish in time
 * stops the run (the tesseract worker thread is terminated). Pages recognised
 * so far are returned as a PARTIAL result (`partial: true`,
 * `stopReason: 'deadline'`); with no page at all the outcome is 'timeout'.
 * When OCR is off, unavailable or fails, callers mark the document
 * `needs_ocr` with an explanation — they never pretend it was processed.
 *
 * Every page records the engine that produced it, so parsed_data can show
 * "OCR (tesseract)" / "OCR (remote)" per document and per field.
 */
import { z } from 'zod'
import { parseOcrLangs, resolveLangData, stageLangData, type LangDataResolution, type OcrEnv } from './ocr-tessdata'

export { DEFAULT_OCR_LANGS, parseOcrLangs } from './ocr-tessdata'

// ─── Types ────────────────────────────────────────────────────────────────

export interface OcrResult {
  text: string
  confidence: number
  pages: number
  engine: string
}

export interface OcrOptions {
  langs?: string[]
  maxPages?: number
}

export interface OcrImage {
  page: number
  image: Buffer
  /** image/png for rendered PDF pages; the sniffed type for photos. */
  mime?: string
}

export interface OcrPage {
  page: number
  text: string
  /** 0..100 as reported by the engine; null when the engine reports none. */
  confidence: number | null
  /** Engine that produced this page ('tesseract', 'remote', …). */
  engine?: string
  /** Recognition time for this page. */
  ms?: number
}

export interface OcrRecognizeOptions {
  langs: string[]
  deadlineAt: number
}

export interface OcrEngine {
  readonly name: string
  readonly kind?: 'local' | 'remote'
  /**
   * Recognise as many pages as possible before `deadlineAt`. Pages that fail
   * or were not reached are simply absent from the result. Throw only when
   * the engine cannot run at all (missing data, worker init failure).
   */
  recognize(images: OcrImage[], opts: OcrRecognizeOptions): Promise<OcrPage[]>
}

export type OcrEngineMode = 'auto' | 'local' | 'remote'

export type OcrStopReason = 'deadline' | 'page_errors' | 'max_pages'

export interface OcrFallbackInfo {
  from: string
  to: string
  pages: number
  reason: string
}

export type OcrFailureReason = 'disabled' | 'unavailable' | 'no_pages' | 'failed' | 'timeout'

export type OcrOutcome =
  | {
      ok: true
      pages: OcrPage[]
      /** Pages in the document (PDF) — may exceed the rendered/recognised count. */
      totalPages: number
      /** Summary label: 'tesseract', 'remote', or 'remote+tesseract' when mixed. */
      engine: string
      /** Distinct engines that produced pages, by page count (desc). */
      engines?: string[]
      /** Mean page confidence 0..100 over pages that report one; null when none do. */
      meanConfidence: number | null
      /** Fewer pages recognised than the document has. */
      partial?: boolean
      stopReason?: OcrStopReason | null
      fallback?: OcrFallbackInfo | null
      langs?: string[]
      /** Pages rendered for OCR (≤ max pages). */
      renderedPages?: number
      ms?: number
    }
  | { ok: false; reason: OcrFailureReason; message: string }

// ─── Configuration ────────────────────────────────────────────────────────

export const DEFAULT_OCR_MAX_PAGES = 15
export const MAX_OCR_MAX_PAGES = 50
/** Upper bound for a single remote page call (the run deadline still applies). */
const REMOTE_PAGE_TIMEOUT_MS = 60_000
/** Grace on top of deadlineAt before the orchestrator stops waiting on an engine. */
const ENGINE_GRACE_MS = 2_000

export interface OcrConfig {
  /** False only when DOCUMENT_OCR_ENABLED=false. */
  allowed: boolean
  langs: string[]
  maxPages: number
  engine: OcrEngineMode
}

export function ocrConfig(env: OcrEnv = process.env): OcrConfig {
  const flag = (env.DOCUMENT_OCR_ENABLED ?? '').trim().toLowerCase()
  const maxRaw = Number.parseInt(env.DOCUMENT_OCR_MAX_PAGES ?? '', 10)
  const engineRaw = (env.DOCUMENT_OCR_ENGINE ?? '').trim().toLowerCase()
  return {
    allowed: !['false', '0', 'off', 'no'].includes(flag),
    langs: parseOcrLangs(env.DOCUMENT_OCR_LANGS),
    maxPages: Number.isFinite(maxRaw) && maxRaw > 0 ? Math.min(maxRaw, MAX_OCR_MAX_PAGES) : DEFAULT_OCR_MAX_PAGES,
    engine: engineRaw === 'local' || engineRaw === 'remote' ? engineRaw : 'auto',
  }
}

// ─── Engines ──────────────────────────────────────────────────────────────

const TIMEOUT = Symbol('ocr-timeout')

/** Resolve with the value, or TIMEOUT once `deadlineAt` passes. */
function until<T>(p: Promise<T>, deadlineAt: number): Promise<T | typeof TIMEOUT> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(TIMEOUT), Math.max(0, deadlineAt - Date.now()))
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

function errText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300)
}

/** Tesseract output confidence → 0..100 or null. */
function pageConfidence(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null
}

/**
 * Local engine: tesseract.js with offline language data. One worker per run
 * (≈1 s start-up); the worker is always terminated, including on deadline.
 */
export function tesseractOcrEngine(opts: { resolve?: (langs: string[]) => LangDataResolution } = {}): OcrEngine {
  return {
    name: 'tesseract',
    kind: 'local',
    async recognize(images, { langs, deadlineAt }) {
      const data = (opts.resolve ?? ((l: string[]) => resolveLangData(l)))(langs)
      if (!data.ok) throw new Error(data.message)
      const langPath = stageLangData(data.files)
      const { createWorker, OEM } = await import('tesseract.js')

      // tesseract.js never settles createWorker() when loading or initialising
      // the language data fails — it only reports through errorHandler (and
      // throws from its message handler when there is none).
      let failInit: (e: Error) => void = () => {}
      const initFailed = new Promise<never>((_, reject) => { failInit = reject })
      const workerP = createWorker(langs, OEM.LSTM_ONLY, {
        langPath, // local directory → read from disk, never fetched
        gzip: true,
        cacheMethod: 'none', // no reads/writes of ./<lang>.traineddata in cwd
        logger: () => {},
        errorHandler: (e: unknown) => failInit(new Error(`tesseract: ${errText(e)}`)),
      })
      const worker = await until(Promise.race([workerP, initFailed]), deadlineAt)
      if (worker === TIMEOUT) {
        workerP.then((w) => w.terminate()).catch(() => {})
        return []
      }

      const out: OcrPage[] = []
      try {
        for (const img of images) {
          if (Date.now() >= deadlineAt) break
          const started = Date.now()
          let res
          try {
            res = await until(worker.recognize(img.image), deadlineAt)
          } catch (err) {
            console.info('[ocr] tesseract page failed', img.page, errText(err))
            continue
          }
          if (res === TIMEOUT) break
          out.push({
            page: img.page,
            text: (res?.data?.text ?? '').trim(),
            confidence: pageConfidence(res?.data?.confidence),
            engine: 'tesseract',
            ms: Date.now() - started,
          })
        }
      } finally {
        await worker.terminate().catch(() => {})
      }
      return out
    },
  }
}

export interface RemoteOcrCallContext {
  page: number
  langs: string[]
  deadlineAt: number
  /** Aborted when the page runs past its time budget. */
  signal: AbortSignal
}

/** One page → text. Return null (or throw) on failure; confidence 0..1 or 0..100. */
export type RemoteOcrCall = (
  image: Buffer,
  mime: string,
  ctx?: RemoteOcrCallContext,
) => Promise<{ text: string; confidence?: number } | null>

const remoteResultSchema = z.object({
  text: z.string(),
  confidence: z.number().finite().nullish(),
})

/** Remote confidence may come as a 0..1 fraction or a 0..100 score. */
function normalizeRemoteConfidence(v: number | null | undefined): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null
  return Math.min(100, v <= 1 ? v * 100 : v)
}

/**
 * Remote engine around a page-level call. Pages whose call fails, returns
 * null / malformed data or times out are left out (the orchestrator sends
 * them to the local engine). After `maxConsecutiveFailures` failures in a row
 * the remaining pages are skipped too.
 */
export function remoteOcrEngine(
  call: RemoteOcrCall,
  opts: { name?: string; maxConsecutiveFailures?: number; pageTimeoutMs?: number } = {},
): OcrEngine {
  const name = opts.name ?? 'remote'
  const maxFailures = opts.maxConsecutiveFailures ?? 2
  const pageTimeoutMs = opts.pageTimeoutMs ?? REMOTE_PAGE_TIMEOUT_MS
  return {
    name,
    kind: 'remote',
    async recognize(images, { langs, deadlineAt }) {
      const out: OcrPage[] = []
      let failures = 0
      for (const img of images) {
        if (Date.now() >= deadlineAt || failures >= maxFailures) break
        const started = Date.now()
        const pageDeadline = Math.min(deadlineAt, started + pageTimeoutMs)
        const ac = new AbortController()
        let res: unknown
        try {
          res = await until(
            Promise.resolve(call(img.image, img.mime ?? 'image/png', { page: img.page, langs, deadlineAt: pageDeadline, signal: ac.signal })),
            pageDeadline,
          )
        } catch (err) {
          console.info('[ocr] remote page failed', img.page, errText(err))
          res = null
        }
        if (res === TIMEOUT) {
          ac.abort()
          failures += 1
          continue
        }
        const parsed = remoteResultSchema.safeParse(res)
        if (!parsed.success) {
          failures += 1
          continue
        }
        failures = 0
        out.push({
          page: img.page,
          text: parsed.data.text.trim(),
          confidence: normalizeRemoteConfidence(parsed.data.confidence),
          engine: name,
          ms: Date.now() - started,
        })
      }
      return out
    },
  }
}

// ─── Registry & selection ─────────────────────────────────────────────────

let engineOverride: OcrEngine | null = null
let localOverride: OcrEngine | null = null
let remoteEngine: OcrEngine | null = null
const defaultLocal = tesseractOcrEngine()

/** Replace the whole engine selection with one engine (tests). `null` restores selection. */
export function setOcrEngine(engine: OcrEngine | null): void {
  engineOverride = engine
}

/** Replace the local (tesseract) engine (tests). `null` restores tesseract. */
export function setLocalOcrEngine(engine: OcrEngine | null): void {
  localOverride = engine
}

/** Register the remote OCR caller (providers router). `null` unregisters. */
export function registerRemoteOcr(call: RemoteOcrCall | null, opts?: { name?: string; maxConsecutiveFailures?: number; pageTimeoutMs?: number }): void {
  remoteEngine = call ? remoteOcrEngine(call, opts) : null
}

export function hasRemoteOcr(): boolean {
  return remoteEngine !== null
}

export interface LocalOcrAvailability {
  ok: boolean
  missing: string[]
  message: string | null
}

export function localOcrAvailability(langs: string[] = ocrConfig().langs): LocalOcrAvailability {
  if (localOverride) return { ok: true, missing: [], message: null }
  const r = resolveLangData(langs)
  return r.ok ? { ok: true, missing: [], message: null } : { ok: false, missing: r.missing, message: r.message }
}

export interface OcrSelection {
  mode: OcrEngineMode
  primary: OcrEngine | null
  /** Engine for pages the primary did not deliver (local after remote). */
  fallback: OcrEngine | null
  /** Why the selection differs from the requested mode, if it does. */
  note: string | null
}

export function selectOcrEngines(cfg: OcrConfig = ocrConfig(), langs: string[] = cfg.langs): OcrSelection {
  if (engineOverride) return { mode: cfg.engine, primary: engineOverride, fallback: null, note: 'override' }
  const localAvail = localOcrAvailability(langs)
  const local = localAvail.ok ? (localOverride ?? defaultLocal) : null
  const localNote = localAvail.ok ? null : localAvail.message
  if (cfg.engine === 'local') return { mode: 'local', primary: local, fallback: null, note: localNote }
  if (remoteEngine) return { mode: cfg.engine, primary: remoteEngine, fallback: local, note: localNote }
  return {
    mode: cfg.engine,
    primary: local,
    fallback: null,
    note: cfg.engine === 'remote' ? `удалённый OCR не подключён — используется локальный${localNote ? `; ${localNote}` : ''}` : localNote,
  }
}

export interface OcrAvailability {
  enabled: boolean
  reason: 'ok' | 'disabled_by_env' | 'no_engine'
  mode: OcrEngineMode
  langs: string[]
  local: LocalOcrAvailability
  remote: boolean
  message: string | null
}

export function ocrAvailability(env: OcrEnv = process.env): OcrAvailability {
  const cfg = ocrConfig(env)
  const local = localOcrAvailability(cfg.langs)
  const remote = hasRemoteOcr()
  const base = { mode: cfg.engine, langs: cfg.langs, local, remote }
  if (!cfg.allowed) return { ...base, enabled: false, reason: 'disabled_by_env', message: 'OCR отключён (DOCUMENT_OCR_ENABLED=false)' }
  if (engineOverride) return { ...base, enabled: true, reason: 'ok', message: null }
  const canRun = cfg.engine === 'local' ? local.ok : local.ok || remote
  if (!canRun) return { ...base, enabled: false, reason: 'no_engine', message: local.message }
  return { ...base, enabled: true, reason: 'ok', message: null }
}

/** OCR runs by default whenever an engine can run; DOCUMENT_OCR_ENABLED=false turns it off. */
export function ocrEnabled(): boolean {
  return ocrAvailability().enabled
}

export function ocrEngineLabel(engine: string): string {
  return `OCR (${engine.split('+').join(' + ')})`
}

// ─── Input preparation ────────────────────────────────────────────────────

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
      first: opts.maxPages ?? DEFAULT_OCR_MAX_PAGES,
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

export function sniffImageMime(buf: Buffer): string {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  return 'application/octet-stream'
}

/** Photo → upright grayscale PNG ≤ 3000 px. Falls back to the original bytes. */
export async function prepareImage(buffer: Buffer): Promise<{ image: Buffer; mime: string }> {
  try {
    const sharp = (await import('sharp')).default
    const image = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .png()
      .toBuffer()
    return { image, mime: 'image/png' }
  } catch (err) {
    console.info('[ocr] image normalisation skipped', errText(err))
    return { image: buffer, mime: sniffImageMime(buffer) }
  }
}

// ─── Orchestration ────────────────────────────────────────────────────────

async function runEngine(engine: OcrEngine, images: OcrImage[], opts: OcrRecognizeOptions): Promise<{ pages: OcrPage[]; error: string | null }> {
  try {
    const res = await until(engine.recognize(images, opts), opts.deadlineAt + ENGINE_GRACE_MS)
    if (res === TIMEOUT) return { pages: [], error: 'deadline' }
    const wanted = new Set(images.map((i) => i.page))
    const pages = res
      .filter((p) => wanted.has(p.page) && typeof p.text === 'string')
      .map((p) => ({ ...p, confidence: pageConfidence(p.confidence), engine: p.engine ?? engine.name }))
    return { pages, error: null }
  } catch (err) {
    console.info(`[ocr] engine ${engine.name} failed`, errText(err))
    return { pages: [], error: errText(err) }
  }
}

function engineSummary(pages: OcrPage[]): string[] {
  const counts = new Map<string, number>()
  for (const p of pages) counts.set(p.engine ?? 'unknown', (counts.get(p.engine ?? 'unknown') ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e)
}

/** OCR a scanned PDF (first `maxPages` pages) or a single image. Never throws. */
export async function ocrDocument(
  buffer: Buffer,
  kind: 'pdf' | 'image',
  opts: { maxPages?: number; deadlineAt?: number; langs?: string[]; force?: boolean; scale?: number } = {},
): Promise<OcrOutcome> {
  const started = Date.now()
  const cfg = ocrConfig()
  if (!opts.force && !cfg.allowed && !engineOverride) {
    return { ok: false, reason: 'disabled', message: 'распознавание сканов (OCR) отключено настройкой DOCUMENT_OCR_ENABLED=false' }
  }
  const langs = opts.langs?.length ? parseOcrLangs(opts.langs.join(',')) : cfg.langs
  const selection = selectOcrEngines(cfg, langs)
  if (!selection.primary) {
    return { ok: false, reason: 'unavailable', message: `распознавание сканов (OCR) недоступно: ${selection.note ?? 'нет движка'}` }
  }
  const deadlineAt = opts.deadlineAt ?? Date.now() + 90_000
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? cfg.maxPages, MAX_OCR_MAX_PAGES))
  try {
    let total = 1
    let images: OcrImage[]
    if (kind === 'pdf') {
      const raster = await rasterizePdf(buffer, { maxPages, scale: opts.scale })
      total = raster.total
      images = raster.images.slice(0, maxPages).map((i) => ({ ...i, mime: 'image/png' }))
    } else {
      const prepared = await prepareImage(buffer)
      images = [{ page: 1, ...prepared }]
    }
    if (!images.length) return { ok: false, reason: 'no_pages', message: 'не удалось получить изображения страниц' }
    if (Date.now() >= deadlineAt) return { ok: false, reason: 'timeout', message: 'распознавание не уложилось во время' }

    const byPage = new Map<number, OcrPage>()
    const primary = await runEngine(selection.primary, images, { langs, deadlineAt })
    primary.pages.forEach((p) => byPage.set(p.page, p))

    let fallback: OcrFallbackInfo | null = null
    let fallbackError: string | null = null
    const missing = () => images.filter((i) => !byPage.has(i.page))
    if (selection.fallback && missing().length && Date.now() < deadlineAt) {
      const todo = missing()
      const res = await runEngine(selection.fallback, todo, { langs, deadlineAt })
      res.pages.forEach((p) => byPage.set(p.page, p))
      fallbackError = res.error
      fallback = {
        from: selection.primary.name,
        to: selection.fallback.name,
        pages: res.pages.length,
        reason: primary.error ? `ошибка: ${primary.error}` : `${todo.length} стр. не распознано`,
      }
    }

    const pages = [...byPage.values()].sort((a, b) => a.page - b.page)
    const deadlineHit = Date.now() >= deadlineAt
    if (!pages.length) {
      if (deadlineHit) return { ok: false, reason: 'timeout', message: 'распознавание не уложилось во время' }
      const why = fallbackError ?? primary.error
      return { ok: false, reason: 'failed', message: `распознавание завершилось ошибкой${why ? `: ${why}` : ''}` }
    }
    const engines = engineSummary(pages)
    const confs = pages.map((p) => p.confidence).filter((c): c is number => typeof c === 'number')
    const stopReason: OcrStopReason | null = missing().length
      ? (deadlineHit || primary.error === 'deadline' ? 'deadline' : 'page_errors')
      : total > images.length ? 'max_pages' : null
    return {
      ok: true,
      pages,
      totalPages: total,
      engine: engines.join('+'),
      engines,
      meanConfidence: confs.length ? confs.reduce((s, c) => s + c, 0) / confs.length : null,
      partial: pages.length < total,
      stopReason,
      fallback,
      langs,
      renderedPages: images.length,
      ms: Date.now() - started,
    }
  } catch (err) {
    console.info('[ocr] failed', errText(err))
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
    confidence: res.meanConfidence ?? 0,
    pages: res.pages.length,
    engine: res.engine,
  }
}
