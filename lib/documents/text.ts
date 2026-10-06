/**
 * lib/documents/text.ts — document bytes → text with a map of where each part
 * came from (page / sheet / slide), so extracted facts can cite their location.
 *
 * The full text is the concatenation of segments, each preceded by a marker
 * line («[Страница 3]», «[Лист: P&L]», «[Слайд 2]») that the model also sees.
 * `segments[i].start/end` are offsets into `text`.
 *
 * Only call after lib/documents/preflight.ts accepted the bytes: parsers here
 * are third-party code reading untrusted input.
 */
import * as XLSX from 'xlsx'
import type { DocumentKind } from './preflight'
import { decodeText } from './preflight'
import { readZipEntries, readZipEntry } from './zip'

export type SegmentKind = 'page' | 'sheet' | 'slide' | 'section'

export interface TextSegment {
  kind: SegmentKind
  /** 1-based page / slide number, or sheet order. */
  index: number
  label: string
  start: number
  end: number
}

export interface StructuredText {
  text: string
  segments: TextSegment[]
  /** Units in the source (pages / sheets / slides) and how many were read. */
  units: { kind: SegmentKind; total: number; read: number }
  /** PDF pages / images with no text layer (candidates for OCR). */
  emptyUnits: number[]
  truncated: boolean
  encoding?: string
}

export interface ExtractTextOptions {
  maxChars?: number
  maxPdfPages?: number
  maxSheetRows?: number
}

export class DocumentParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentParseError'
  }
}

const DEFAULT_MAX_CHARS = 2_000_000

/** Letters and digits — a page with fewer than this has no usable text layer. */
const MIN_MEANINGFUL_CHARS = 20

export function meaningfulChars(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length
}

class Builder {
  private parts: string[] = []
  private length = 0
  readonly segments: TextSegment[] = []
  truncated = false

  constructor(private readonly maxChars: number) {}

  add(kind: SegmentKind, index: number, label: string, body: string): void {
    const content = body.replace(/\r\n?/g, '\n').trim()
    if (!content || this.truncated) return
    const header = this.segments.length ? `\n\n[${label}]\n` : `[${label}]\n`
    let chunk = header + content
    if (this.length + chunk.length > this.maxChars) {
      chunk = chunk.slice(0, Math.max(0, this.maxChars - this.length))
      this.truncated = true
    }
    if (!chunk) return
    const start = this.length
    this.parts.push(chunk)
    this.length += chunk.length
    this.segments.push({ kind, index, label, start, end: this.length })
  }

  get text(): string {
    return this.parts.join('')
  }
}

export async function extractDocumentText(
  buffer: Buffer,
  kind: DocumentKind,
  opts: ExtractTextOptions = {},
): Promise<StructuredText> {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  try {
    switch (kind) {
      case 'pdf':
        return await pdfText(buffer, maxChars, opts.maxPdfPages ?? 300)
      case 'docx':
        return await docxText(buffer, maxChars)
      case 'xlsx':
      case 'xls':
        return sheetText(buffer, maxChars, opts.maxSheetRows ?? 20_000)
      case 'pptx':
        return pptxText(buffer, maxChars)
      case 'csv':
      case 'txt':
        return plainText(buffer, maxChars)
      case 'image':
        return { text: '', segments: [], units: { kind: 'page', total: 1, read: 0 }, emptyUnits: [1], truncated: false }
    }
  } catch (err) {
    if (err instanceof DocumentParseError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    if (/password/i.test(msg)) throw new DocumentParseError('Файл защищён паролем.')
    throw new DocumentParseError('Файл повреждён или имеет неподдерживаемую структуру.')
  }
}

async function pdfText(buffer: Buffer, maxChars: number, maxPages: number): Promise<StructuredText> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText({ first: maxPages })
    const b = new Builder(maxChars)
    const empty: number[] = []
    for (const page of result.pages) {
      const body = page.text ?? ''
      if (meaningfulChars(body) < MIN_MEANINGFUL_CHARS) empty.push(page.num)
      b.add('page', page.num, `Страница ${page.num}`, body)
    }
    return {
      text: b.text,
      segments: b.segments,
      units: { kind: 'page', total: result.total, read: result.pages.length },
      emptyUnits: empty,
      truncated: b.truncated || result.pages.length < result.total,
    }
  } finally {
    await parser.destroy().catch(() => {})
  }
}

async function docxText(buffer: Buffer, maxChars: number): Promise<StructuredText> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await import('mammoth')) as any
  const mammoth = mod.default ?? mod
  const result = await mammoth.extractRawText({ buffer })
  const b = new Builder(maxChars)
  b.add('section', 1, 'Документ', String(result.value ?? ''))
  return { text: b.text, segments: b.segments, units: { kind: 'section', total: 1, read: 1 }, emptyUnits: [], truncated: b.truncated }
}

function sheetText(buffer: Buffer, maxChars: number, maxRows: number): StructuredText {
  const wb = XLSX.read(buffer, {
    type: 'buffer',
    sheetRows: maxRows,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    bookVBA: false,
  })
  const b = new Builder(maxChars)
  let truncatedRows = false
  wb.SheetNames.forEach((name, i) => {
    const sheet = wb.Sheets[name]
    if (!sheet) return
    const full = (sheet as Record<string, unknown>)['!fullref']
    if (typeof full === 'string' && full !== sheet['!ref']) truncatedRows = true
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
    b.add('sheet', i + 1, `Лист: ${name}`, csv)
  })
  return {
    text: b.text,
    segments: b.segments,
    units: { kind: 'sheet', total: wb.SheetNames.length, read: b.segments.length },
    emptyUnits: [],
    truncated: b.truncated || truncatedRows,
  }
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXmlText(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m
  })
}

/** PPTX: text runs (<a:t>) of each slide, paragraphs on separate lines. */
function pptxText(buffer: Buffer, maxChars: number): StructuredText {
  const entries = readZipEntries(buffer)
  const slides = entries
    .map((e) => ({ e, m: e.name.match(/^ppt\/slides\/slide(\d+)\.xml$/) }))
    .filter((x): x is { e: typeof x.e; m: RegExpMatchArray } => Boolean(x.m))
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
  const b = new Builder(maxChars)
  const empty: number[] = []
  for (const { e, m } of slides) {
    const xml = readZipEntry(buffer, e).toString('utf8')
    const paragraphs = xml.split(/<\/a:p>/).map((p) =>
      [...p.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((x) => decodeXmlText(x[1])).join(''),
    ).filter((p) => p.trim())
    const n = Number(m[1])
    const body = paragraphs.join('\n')
    if (meaningfulChars(body) === 0) empty.push(n)
    b.add('slide', n, `Слайд ${n}`, body)
  }
  return {
    text: b.text,
    segments: b.segments,
    units: { kind: 'slide', total: slides.length, read: slides.length },
    emptyUnits: empty,
    truncated: b.truncated,
  }
}

function plainText(buffer: Buffer, maxChars: number): StructuredText {
  const decoded = decodeText(buffer)
  if (!decoded) throw new DocumentParseError('Не удалось определить кодировку текста.')
  const b = new Builder(maxChars)
  b.add('section', 1, 'Документ', decoded.text.replace(/^﻿/, ''))
  return {
    text: b.text,
    segments: b.segments,
    units: { kind: 'section', total: 1, read: 1 },
    emptyUnits: [],
    truncated: b.truncated,
    encoding: decoded.encoding,
  }
}

/** Build a StructuredText from OCR'd pages. */
export function structuredFromPages(pages: Array<{ page: number; text: string }>, total: number, maxChars = DEFAULT_MAX_CHARS): StructuredText {
  const b = new Builder(maxChars)
  const empty: number[] = []
  for (const p of pages) {
    if (meaningfulChars(p.text) < MIN_MEANINGFUL_CHARS) empty.push(p.page)
    b.add('page', p.page, `Страница ${p.page}`, p.text)
  }
  return {
    text: b.text,
    segments: b.segments,
    units: { kind: 'page', total, read: pages.length },
    emptyUnits: empty,
    truncated: b.truncated || pages.length < total,
  }
}

/** The segment an offset of `text` belongs to. */
export function segmentAt(st: Pick<StructuredText, 'segments'>, offset: number): TextSegment | null {
  for (const s of st.segments) if (offset >= s.start && offset < s.end) return s
  return null
}

/** No usable text at all (scan / photo) — OCR territory. */
export function hasNoText(st: StructuredText): boolean {
  return meaningfulChars(st.text.replace(/\[(Страница|Лист|Слайд)[^\]]*\]/g, '')) < MIN_MEANINGFUL_CHARS
}
