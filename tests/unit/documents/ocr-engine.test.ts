/**
 * OCR engine selection, remote → local fallback, offline language data,
 * deadlines and provenance in parsed_data. tesseract.js is mocked here (the
 * real recognition test lives in ocr-tesseract-real.test.ts).
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tess = vi.hoisted(() => ({
  createWorker: vi.fn(),
  terminate: vi.fn(async () => {}),
  recognize: vi.fn(),
}))
vi.mock('tesseract.js', () => ({
  OEM: { TESSERACT_ONLY: 0, LSTM_ONLY: 1, TESSERACT_LSTM_COMBINED: 2, DEFAULT: 3 },
  createWorker: tess.createWorker,
}))

import type { LlmJsonResult } from '@/lib/ai/gateway'
import type { LlmJsonFn } from '@/lib/documents/extraction'
import {
  DEFAULT_OCR_MAX_PAGES,
  ocrAvailability,
  ocrConfig,
  ocrDocument,
  registerRemoteOcr,
  remoteOcrEngine,
  selectOcrEngines,
  setLocalOcrEngine,
  setOcrEngine,
  tesseractOcrEngine,
  type OcrEngine,
} from '@/lib/documents/ocr'
import { isUrlLike, parseOcrLangs, resolveLangData, stageLangData, TESSDATA_VARIANT } from '@/lib/documents/ocr-tessdata'
import { runDocumentPipeline, type PipelineInput } from '@/lib/documents/pipeline'
import { preflightDocument } from '@/lib/documents/preflight'

const OCR_ENV = ['DOCUMENT_OCR_ENABLED', 'DOCUMENT_OCR_LANGS', 'DOCUMENT_OCR_MAX_PAGES', 'DOCUMENT_OCR_ENGINE', 'DOCUMENT_OCR_LANG_PATH'] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of OCR_ENV) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  tess.createWorker.mockReset()
  tess.recognize.mockReset()
  tess.terminate.mockClear()
})

afterEach(() => {
  for (const k of OCR_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  setOcrEngine(null)
  setLocalOcrEngine(null)
  registerRemoteOcr(null)
})

/** Fake engine: per-page text, optional failures / delays, records calls. */
function fakeEngine(name: string, opts: { fail?: number[]; delayMs?: number; hangFrom?: number; confidence?: number } = {}) {
  const calls: number[][] = []
  const engine: OcrEngine = {
    name,
    kind: name === 'remote' ? 'remote' : 'local',
    async recognize(images, { deadlineAt }) {
      calls.push(images.map((i) => i.page))
      const out = []
      for (const img of images) {
        if (opts.hangFrom !== undefined && img.page >= opts.hangFrom) {
          await new Promise((r) => setTimeout(r, Math.max(0, deadlineAt - Date.now()) + 50))
          break
        }
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
        if (opts.fail?.includes(img.page)) continue
        out.push({ page: img.page, text: `Страница ${img.page}: выручка за 2025 год 7 000 000 тенге (${name})`, confidence: opts.confidence ?? 80 })
      }
      return out
    },
  }
  return { engine, calls }
}

async function tinyPng(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 20, channels: 3, background: '#ffffff' } }).png().toBuffer()
}

function scanPdf(pages: number): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument()
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    for (let i = 0; i < pages; i += 1) {
      if (i > 0) doc.addPage()
      doc.rect(20, 20, 200, 200).fill('#222')
    }
    doc.end()
  })
}

// ─── Configuration ────────────────────────────────────────────────────────

describe('ocrConfig', () => {
  it('defaults: on, rus+eng, 15 pages, auto engine', () => {
    expect(ocrConfig({})).toEqual({ allowed: true, langs: ['rus', 'eng'], maxPages: DEFAULT_OCR_MAX_PAGES, engine: 'auto' })
    expect(DEFAULT_OCR_MAX_PAGES).toBe(15)
  })

  it('DOCUMENT_OCR_ENABLED=false disables; langs / pages / engine are parsed and clamped', () => {
    const cfg = ocrConfig({ DOCUMENT_OCR_ENABLED: 'false', DOCUMENT_OCR_LANGS: 'rus+eng, kaz', DOCUMENT_OCR_MAX_PAGES: '500', DOCUMENT_OCR_ENGINE: 'REMOTE' })
    expect(cfg).toEqual({ allowed: false, langs: ['rus', 'eng', 'kaz'], maxPages: 50, engine: 'remote' })
    expect(ocrConfig({ DOCUMENT_OCR_MAX_PAGES: 'abc', DOCUMENT_OCR_ENGINE: 'gpu' })).toMatchObject({ maxPages: 15, engine: 'auto' })
    expect(parseOcrLangs('../etc, https://x')).toEqual(['rus', 'eng'])
  })

  it('is enabled by default because the language data is bundled; false still disables', () => {
    expect(ocrAvailability()).toMatchObject({ enabled: true, reason: 'ok', local: { ok: true } })
    process.env.DOCUMENT_OCR_ENABLED = 'false'
    expect(ocrAvailability()).toMatchObject({ enabled: false, reason: 'disabled_by_env' })
  })

  it('missing language data → not enabled, with a clear message', () => {
    process.env.DOCUMENT_OCR_LANGS = 'rus,deu'
    const a = ocrAvailability()
    expect(a.enabled).toBe(false)
    expect(a.reason).toBe('no_engine')
    expect(a.message).toMatch(/deu/)
  })
})

// ─── Offline language data ────────────────────────────────────────────────

describe('offline language data', () => {
  it('rus, eng and kaz resolve to the LSTM-only files in node_modules', () => {
    const r = resolveLangData(['rus', 'eng', 'kaz'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const f of r.files) {
      expect(f.file).toContain(path.join('node_modules', '@tesseract.js-data', f.lang, TESSDATA_VARIANT))
      expect(f.file.endsWith(`${f.lang}.traineddata.gz`)).toBe(true)
    }
  })

  it('stages one local directory (never a URL) that holds every language', () => {
    const r = resolveLangData(['rus', 'eng'])
    if (!r.ok) throw new Error(r.message)
    const dir = stageLangData(r.files)
    expect(isUrlLike(dir)).toBe(false)
    expect(path.isAbsolute(dir)).toBe(true)
    expect(existsSync(path.join(dir, 'rus.traineddata.gz'))).toBe(true)
    expect(existsSync(path.join(dir, 'eng.traineddata.gz'))).toBe(true)
  })

  it('a URL in DOCUMENT_OCR_LANG_PATH is refused, unknown languages are reported', () => {
    const url = resolveLangData(['rus'], { DOCUMENT_OCR_LANG_PATH: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/rus' })
    expect(url.ok).toBe(false)
    if (!url.ok) expect(url.message).toMatch(/URL/)
    const missing = resolveLangData(['rus', 'xyz'])
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.missing).toEqual(['xyz'])
      expect(missing.message).toMatch(/@tesseract\.js-data\/xyz/)
    }
  })

  it('tesseract worker is created with a local langPath, gzip and no cache', async () => {
    tess.recognize.mockResolvedValue({ data: { text: ' Выручка 100 ', confidence: 91.4 } })
    tess.createWorker.mockResolvedValue({ recognize: tess.recognize, terminate: tess.terminate })
    const pages = await tesseractOcrEngine().recognize([{ page: 1, image: Buffer.from('x') }], { langs: ['rus', 'eng'], deadlineAt: Date.now() + 5_000 })
    expect(pages).toEqual([{ page: 1, text: 'Выручка 100', confidence: 91.4, engine: 'tesseract', ms: expect.any(Number) }])
    const [langs, oem, options] = tess.createWorker.mock.calls[0]
    expect(langs).toEqual(['rus', 'eng'])
    expect(oem).toBe(1) // LSTM only — matches the 4.0.0_best_int data
    expect(isUrlLike(options.langPath)).toBe(false)
    expect(existsSync(path.join(options.langPath, 'rus.traineddata.gz'))).toBe(true)
    expect(options).toMatchObject({ gzip: true, cacheMethod: 'none' })
    expect(typeof options.errorHandler).toBe('function')
    expect(tess.terminate).toHaveBeenCalledTimes(1)
  })

  it('missing data fails clearly before a worker is started', async () => {
    await expect(tesseractOcrEngine().recognize([{ page: 1, image: Buffer.from('x') }], { langs: ['xyz'], deadlineAt: Date.now() + 1_000 }))
      .rejects.toThrow(/xyz/)
    expect(tess.createWorker).not.toHaveBeenCalled()
    process.env.DOCUMENT_OCR_LANGS = 'xyz'
    const out = await ocrDocument(await tinyPng(), 'image')
    expect(out).toMatchObject({ ok: false, reason: 'unavailable' })
  })
})

// ─── Engine selection & fallback ──────────────────────────────────────────

describe('engine selection', () => {
  it('auto: local when no remote is registered, remote (+ local fallback) when it is', () => {
    const local = fakeEngine('tesseract').engine
    setLocalOcrEngine(local)
    expect(selectOcrEngines()).toMatchObject({ mode: 'auto', primary: local, fallback: null })
    registerRemoteOcr(async () => ({ text: 'x' }))
    const sel = selectOcrEngines()
    expect(sel.primary?.name).toBe('remote')
    expect(sel.fallback).toBe(local)
  })

  it('local: ignores a registered remote; remote without registration: local with a note', () => {
    const local = fakeEngine('tesseract').engine
    setLocalOcrEngine(local)
    registerRemoteOcr(async () => ({ text: 'x' }))
    process.env.DOCUMENT_OCR_ENGINE = 'local'
    expect(selectOcrEngines()).toMatchObject({ mode: 'local', primary: local, fallback: null })
    registerRemoteOcr(null)
    process.env.DOCUMENT_OCR_ENGINE = 'remote'
    const sel = selectOcrEngines()
    expect(sel.primary).toBe(local)
    expect(sel.note).toMatch(/удалённый OCR не подключён/)
  })

  it('remote pages that fail fall back to local; every page records its engine', async () => {
    const local = fakeEngine('tesseract')
    setLocalOcrEngine(local.engine)
    registerRemoteOcr(async (_img, mime, ctx) => {
      expect(mime).toBe('image/png')
      if (ctx?.page === 2) return null
      if (ctx?.page === 3) throw new Error('502')
      return { text: `remote page ${ctx?.page}`, confidence: 0.93 }
    }, { maxConsecutiveFailures: 5 })
    const out = await ocrDocument(await scanPdf(3), 'pdf', { deadlineAt: Date.now() + 20_000 })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.pages.map((p) => [p.page, p.engine])).toEqual([[1, 'remote'], [2, 'tesseract'], [3, 'tesseract']])
    expect(out.pages[0].confidence).toBeCloseTo(93) // 0..1 normalised to 0..100
    expect(local.calls).toEqual([[2, 3]])
    expect(out.fallback).toMatchObject({ from: 'remote', to: 'tesseract', pages: 2 })
    expect(out.engine).toBe('tesseract+remote')
    expect(out.partial).toBe(false)
  })

  it('malformed remote output is rejected; consecutive failures stop the remote engine', async () => {
    const calls: number[] = []
    const engine = remoteOcrEngine(async (_i, _m, ctx) => {
      calls.push(ctx!.page)
      return { text: 42 } as unknown as { text: string }
    }, { maxConsecutiveFailures: 2 })
    const pages = await engine.recognize([1, 2, 3, 4].map((page) => ({ page, image: Buffer.from('x') })), { langs: ['rus'], deadlineAt: Date.now() + 5_000 })
    expect(pages).toEqual([])
    expect(calls).toEqual([1, 2])
  })

  it('a remote call that outlives its page budget is aborted and the page goes to local', async () => {
    const local = fakeEngine('tesseract')
    setLocalOcrEngine(local.engine)
    let aborted = false
    registerRemoteOcr((_img, _mime, ctx) => new Promise((resolve) => {
      ctx?.signal.addEventListener('abort', () => { aborted = true; resolve(null) })
    }), { pageTimeoutMs: 100 })
    const out = await ocrDocument(await tinyPng(), 'image', { deadlineAt: Date.now() + 10_000 })
    expect(aborted).toBe(true)
    expect(out.ok && out.pages[0].engine).toBe('tesseract')
  })

  it('remote engine failure with no local data available → failed, not pretended', async () => {
    process.env.DOCUMENT_OCR_LANGS = 'xyz' // no local data for it
    registerRemoteOcr(async () => null)
    const out = await ocrDocument(await tinyPng(), 'image', { deadlineAt: Date.now() + 5_000 })
    expect(out).toMatchObject({ ok: false, reason: 'failed' })
  })
})

// ─── Deadlines ────────────────────────────────────────────────────────────

describe('deadlines', () => {
  it('pages done before the deadline come back as a partial result', async () => {
    setLocalOcrEngine(fakeEngine('tesseract', { hangFrom: 2 }).engine)
    const out = await ocrDocument(await scanPdf(3), 'pdf', { deadlineAt: Date.now() + 1_500 })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.pages.map((p) => p.page)).toEqual([1])
    expect(out).toMatchObject({ partial: true, stopReason: 'deadline', totalPages: 3 })
  })

  it('nothing recognised before the deadline → timeout', async () => {
    setLocalOcrEngine(fakeEngine('tesseract', { hangFrom: 1 }).engine)
    const out = await ocrDocument(await tinyPng(), 'image', { deadlineAt: Date.now() + 300 })
    expect(out).toMatchObject({ ok: false, reason: 'timeout' })
  })

  it('an engine that ignores the deadline is abandoned after a short grace', async () => {
    setLocalOcrEngine({ name: 'tesseract', recognize: () => new Promise(() => {}) })
    const started = Date.now()
    const out = await ocrDocument(await tinyPng(), 'image', { deadlineAt: Date.now() + 200 })
    expect(out).toMatchObject({ ok: false, reason: 'timeout' })
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('the tesseract worker is terminated when a page runs past the deadline', async () => {
    tess.recognize
      .mockResolvedValueOnce({ data: { text: 'стр 1', confidence: 90 } })
      .mockImplementationOnce(() => new Promise(() => {}))
    tess.createWorker.mockResolvedValue({ recognize: tess.recognize, terminate: tess.terminate })
    const pages = await tesseractOcrEngine().recognize(
      [1, 2, 3].map((page) => ({ page, image: Buffer.from('x') })),
      { langs: ['rus', 'eng'], deadlineAt: Date.now() + 300 },
    )
    expect(pages.map((p) => p.page)).toEqual([1])
    expect(tess.recognize).toHaveBeenCalledTimes(2)
    expect(tess.terminate).toHaveBeenCalledTimes(1)
  })

  it('max pages: only the first N pages are rendered and the result says so', async () => {
    process.env.DOCUMENT_OCR_MAX_PAGES = '2'
    const local = fakeEngine('tesseract')
    setLocalOcrEngine(local.engine)
    const out = await ocrDocument(await scanPdf(4), 'pdf', { deadlineAt: Date.now() + 20_000 })
    expect(local.calls).toEqual([[1, 2]])
    expect(out).toMatchObject({ ok: true, partial: true, stopReason: 'max_pages', totalPages: 4, renderedPages: 2 })
  })
})

// ─── Provenance in parsed_data ────────────────────────────────────────────

const DOC_ID = '44444444-4444-4444-8444-444444444444'
const usage = { model: 'test/model', tier: 'standard' as const, tokensIn: 1, tokensOut: 1, costUsd: 0, costSource: 'estimate' as const, latencyMs: 1, attempts: 1 }

function llmReturning(fields: unknown[]): LlmJsonFn {
  const fn = async <T,>(req: { schema: { safeParse(v: unknown): { success: boolean; data?: T } } }) => {
    const parsed = req.schema.safeParse({ summary: 'Скан.', fields })
    return parsed.success
      ? ({ ok: true, data: parsed.data as T, usage } as LlmJsonResult<T>)
      : ({ ok: false, error: 'INVALID_OUTPUT', message: 'schema', usage } as LlmJsonResult<T>)
  }
  return fn as unknown as LlmJsonFn
}

function input(buffer: Buffer, fileName: string, over: Partial<PipelineInput> = {}): PipelineInput {
  const pf = preflightDocument(buffer, fileName)
  if (!pf.ok) throw new Error(pf.reason)
  return {
    documentId: DOC_ID, docType: 'pl_report', fileName, buffer, kind: pf.kind, mime: pf.mime,
    llm: null, aiBudgetLeft: () => true, deadlineAt: Date.now() + 60_000, ...over,
  }
}

describe('OCR provenance in parsed_data', () => {
  it('source.ocr carries engine label + per-page engine/confidence; fields are capped at 0.7 and name the engine', async () => {
    setLocalOcrEngine(fakeEngine('tesseract', { confidence: 77 }).engine)
    registerRemoteOcr(async (_i, _m, ctx) => (ctx?.page === 1 ? { text: 'Выручка за 2025 год: 9 000 000 тенге', confidence: 97 } : null))
    const llm = llmReturning([
      { key: 'revenue', label: 'Выручка', value: 9000000, quote: 'Выручка за 2025 год: 9 000 000 тенге', confidence: 0.98 },
      { key: 'net_profit', label: 'Чистая прибыль', value: 7000000, quote: '7 000 000 тенге (tesseract)', confidence: 0.9 },
    ])
    const out = await runDocumentPipeline(input(await scanPdf(2), 'scan.pdf', { llm }))
    expect(out.status).toBe('parsed')
    if (out.status !== 'parsed') return
    const ocr = (out.payload.source as { ocr: Record<string, unknown> }).ocr
    expect(ocr).toMatchObject({
      engine: 'remote+tesseract',
      label: 'OCR (remote + tesseract)',
      pages: 2,
      total_pages: 2,
      partial: false,
      fallback: { from: 'remote', to: 'tesseract', pages: 1 },
      page_details: [
        { page: 1, engine: 'remote', confidence: 97 },
        { page: 2, engine: 'tesseract', confidence: 77 },
      ],
    })
    expect(out.payload.fields.length).toBeGreaterThan(0)
    for (const f of [...out.payload.fields, ...(out.payload.unverified_fields ?? [])]) {
      expect(f.confidence).toBeLessThanOrEqual(0.7)
      expect(f.provenance?.ocr).toBe(true)
    }
    const p1 = out.payload.fields.find((f) => f.provenance?.page === 1)
    expect(p1?.provenance).toMatchObject({ ocr_engine: 'remote', ocr_page_confidence: 97 })
    const p2 = out.payload.fields.find((f) => f.provenance?.page === 2)
    expect(p2?.provenance).toMatchObject({ ocr_engine: 'tesseract', ocr_page_confidence: 77 })
    expect(out.payload.warnings?.join(' ')).toMatch(/OCR \(remote \+ tesseract\)/)
  })

  it('heuristic fields (no model) from OCR text also carry the engine', async () => {
    setLocalOcrEngine(fakeEngine('tesseract').engine)
    const out = await runDocumentPipeline(input(await scanPdf(1), 'scan.pdf'))
    expect(out.status).toBe('parsed')
    if (out.status !== 'parsed') return
    expect((out.payload.source as { ocr: { label: string } }).ocr.label).toBe('OCR (tesseract)')
    for (const f of out.payload.fields) {
      expect(f.confidence).toBeLessThanOrEqual(0.7)
      expect(f.provenance).toMatchObject({ ocr: true, ocr_engine: 'tesseract' })
    }
  })

  it('a partial OCR run is flagged in coverage and warnings', async () => {
    setLocalOcrEngine(fakeEngine('tesseract', { hangFrom: 2 }).engine)
    const out = await runDocumentPipeline(input(await scanPdf(3), 'scan.pdf', { ocr: (buf, kind) => ocrDocument(buf, kind, { deadlineAt: Date.now() + 1_500 }) }))
    expect(out.status).toBe('parsed')
    if (out.status !== 'parsed') return
    expect(out.payload.coverage).toMatchObject({ partial: true })
    expect((out.payload.source as { ocr: Record<string, unknown> }).ocr).toMatchObject({ partial: true, stop_reason: 'deadline', pages: 1, total_pages: 3 })
    expect(out.payload.warnings?.join(' ')).toMatch(/Распознано страниц: 1 из 3 — распознавание остановлено по лимиту времени/)
  })

  it('OCR timeout → needs_ocr with an honest message and the reason recorded', async () => {
    setLocalOcrEngine(fakeEngine('tesseract', { hangFrom: 1 }).engine)
    const out = await runDocumentPipeline(input(await scanPdf(1), 'scan.pdf', { ocr: (buf, kind) => ocrDocument(buf, kind, { deadlineAt: Date.now() + 300 }) }))
    expect(out.status).toBe('needs_ocr')
    if (out.status !== 'needs_ocr') return
    expect(out.message).toMatch(/не уложилось/)
    expect(out.payload.stats).toMatchObject({ ocr_reason: 'timeout' })
    expect(out.payload.source).toMatchObject({ ocr_attempt: { reason: 'timeout' } })
  })
})
