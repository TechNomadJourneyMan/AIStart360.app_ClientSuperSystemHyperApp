/**
 * REAL tesseract.js run (no mocks) on generated images: proves OCR works
 * offline with the bundled language data (@tesseract.js-data/*). Takes a few
 * seconds; generous timeouts for slow CI machines.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ocrDocument, registerRemoteOcr, setLocalOcrEngine, setOcrEngine } from '@/lib/documents/ocr'
import { runDocumentPipeline } from '@/lib/documents/pipeline'
import { preflightDocument } from '@/lib/documents/preflight'
import { missingWords, renderSamplePng, renderScannedPdf } from '@/scripts/ocr/sample'

const savedEnv: Record<string, string | undefined> = {}
const KEYS = ['DOCUMENT_OCR_ENABLED', 'DOCUMENT_OCR_LANGS', 'DOCUMENT_OCR_ENGINE', 'DOCUMENT_OCR_LANG_PATH', 'DOCUMENT_OCR_MAX_PAGES'] as const

beforeAll(() => {
  for (const k of KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  process.env.DOCUMENT_OCR_ENGINE = 'local'
  setOcrEngine(null)
  setLocalOcrEngine(null)
  registerRemoteOcr(null)
})

afterAll(() => {
  for (const k of KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('tesseract (real, offline)', () => {
  it('recognises Russian + English text on a generated image', async () => {
    const png = await renderSamplePng()
    const out = await ocrDocument(png, 'image', { deadlineAt: Date.now() + 90_000 })
    expect(out.ok, out.ok ? '' : out.message).toBe(true)
    if (!out.ok) return
    const text = out.pages.map((p) => p.text).join('\n')
    expect(missingWords(text), text).toEqual([])
    expect(out.engine).toBe('tesseract')
    expect(out.pages[0].engine).toBe('tesseract')
    expect(out.meanConfidence ?? 0).toBeGreaterThan(70)
  }, 120_000)

  it('a scanned PDF goes through the pipeline with OCR provenance', async () => {
    const pdf = await renderScannedPdf([await renderSamplePng()])
    const pf = preflightDocument(pdf, 'scan.pdf')
    if (!pf.ok) throw new Error(pf.reason)
    const out = await runDocumentPipeline({
      documentId: '55555555-5555-4555-8555-555555555555',
      docType: 'sales_report',
      fileName: 'scan.pdf',
      buffer: pdf,
      kind: pf.kind,
      mime: pf.mime,
      llm: null,
      aiBudgetLeft: () => false,
      deadlineAt: Date.now() + 90_000,
    })
    expect(out.status).toBe('parsed')
    if (out.status !== 'parsed') return
    expect(out.payload.source).toMatchObject({ ocr: { engine: 'tesseract', label: 'OCR (tesseract)', pages: 1, total_pages: 1 } })
    expect(missingWords(out.payload.raw_text_preview)).toEqual([])
    for (const f of out.payload.fields) {
      expect(f.confidence).toBeLessThanOrEqual(0.7)
      expect(f.provenance).toMatchObject({ ocr: true, ocr_engine: 'tesseract' })
    }
  }, 120_000)
})
