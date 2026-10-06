/**
 * lib/documents/preflight.ts — what is this file, really, and is it safe to parse?
 *
 * Runs on the raw bytes BEFORE any third-party parser (pdf-parse, mammoth,
 * SheetJS) or the LLM sees them, for every upload path (documents finalize,
 * the document_intelligence agent, AI Journey). Cheap, synchronous, no I/O.
 *
 *   1. size cap (DOCUMENT_MAX_BYTES, 25 MB by default)
 *   2. magic-byte sniff → kind + canonical MIME (the browser's MIME is ignored)
 *   3. extension ↔ content agreement (a renamed .exe is not a PDF)
 *   4. format checks:
 *        OOXML  — ZIP structure, entry count, declared AND actual inflated size,
 *                 compression ratio, unsafe paths, encryption, macros,
 *                 DTD / entity declarations (XML bombs, XXE)
 *        PDF    — header, active content (/JavaScript, /JS, /Launch,
 *                 /EmbeddedFile; hex-escaped names and object streams included)
 *        text   — binary bytes, encoding (UTF-8 / UTF-16 / Windows-1251), line limits
 *        images — PNG / JPEG header and pixel count (decompression bombs)
 *
 * Returns { ok, kind, mime, reason } — never throws on hostile input.
 */
import { inflateSync } from 'node:zlib'
import { isZip, peekZipEntry, readZipEntries, readZipEntry, ZipFormatError, type ZipEntry } from './zip'

export type DocumentKind = 'pdf' | 'docx' | 'xlsx' | 'xls' | 'pptx' | 'csv' | 'txt' | 'image'

export type PreflightCode =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'MIME_MISMATCH'
  | 'EXECUTABLE'
  | 'ENCRYPTED'
  | 'MACRO_ENABLED'
  | 'ZIP_INVALID'
  | 'ZIP_BOMB'
  | 'XML_ENTITY'
  | 'PDF_INVALID'
  | 'PDF_ACTIVE_CONTENT'
  | 'PDF_TOO_MANY_PAGES'
  | 'BINARY_TEXT'
  | 'TEXT_ENCODING'
  | 'TEXT_TOO_LARGE'
  | 'IMAGE_INVALID'
  | 'IMAGE_TOO_LARGE'

export type TextEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'windows-1251'

export interface PreflightMeta {
  /** PDF: number of /Type /Page objects found (estimate). */
  pages?: number
  /** OOXML: entries and total uncompressed bytes. */
  zipEntries?: number
  uncompressedBytes?: number
  /** Text files: detected encoding, line count. */
  encoding?: TextEncoding
  lines?: number
  /** Images. */
  width?: number
  height?: number
}

export type PreflightResult =
  | { ok: true; kind: DocumentKind; mime: string; ext: string; flags: string[]; meta: PreflightMeta }
  | { ok: false; code: PreflightCode; reason: string; kind: DocumentKind | null; mime: string | null; ext: string }

export interface PreflightOptions {
  maxBytes?: number
  /** Restrict to a subset of kinds (AI Journey accepts pdf/docx/csv/txt only). */
  allowedKinds?: readonly DocumentKind[]
  maxPdfPages?: number
  maxTextLines?: number
  maxTextLineBytes?: number
  maxZipEntries?: number
  maxZipUncompressed?: number
  maxZipEntryUncompressed?: number
  maxZipRatio?: number
}

export const DEFAULT_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024

/** Upload size cap: DOCUMENT_MAX_BYTES env (bytes) or 25 MB. */
export function documentMaxBytes(): number {
  const raw = Number(process.env.DOCUMENT_MAX_BYTES)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DOCUMENT_MAX_BYTES
}

export const MIME_BY_KIND: Record<Exclude<DocumentKind, 'image'>, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  txt: 'text/plain',
}

/** Extensions the pipeline accepts and the kind each must contain. */
const EXTENSION_KIND: Record<string, DocumentKind> = {
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx',
  xls: 'xls',
  pptx: 'pptx',
  csv: 'csv',
  tsv: 'csv',
  txt: 'txt',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
}

const LEGACY_OFFICE_HINT: Record<string, string> = {
  doc: 'Формат .doc (Word 97–2003) не поддерживается — сохраните документ как DOCX или PDF.',
  ppt: 'Формат .ppt не поддерживается — сохраните презентацию как PPTX или PDF.',
  xlsm: 'Книги Excel с макросами (.xlsm) не принимаются — сохраните как XLSX.',
  docm: 'Документы Word с макросами (.docm) не принимаются — сохраните как DOCX.',
  pptm: 'Презентации с макросами (.pptm) не принимаются — сохраните как PPTX.',
}

const KIND_LABEL: Record<DocumentKind, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  xlsx: 'XLSX',
  xls: 'XLS',
  pptx: 'PPTX',
  csv: 'CSV',
  txt: 'текст',
  image: 'изображение',
}

export function fileExtension(fileName: string): string {
  const base = (fileName ?? '').split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

// ─── Sniffing ───────────────────────────────────────────────────────────────

type Sniffed =
  | { type: 'pdf' }
  | { type: 'zip' }
  | { type: 'ole' }
  | { type: 'png' }
  | { type: 'jpeg' }
  | { type: 'executable'; what: string }
  | { type: 'archive'; what: string }
  | { type: 'other-binary' }
  | { type: 'text' }

function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false
  return bytes.every((b, i) => buffer[offset + i] === b)
}

function sniff(buffer: Buffer): Sniffed {
  if (buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) return { type: 'pdf' }
  if (isZip(buffer)) return { type: 'zip' }
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { type: 'ole' }
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: 'png' }
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { type: 'jpeg' }
  if (startsWith(buffer, [0x4d, 0x5a])) return { type: 'executable', what: 'Windows (EXE/DLL)' }
  if (startsWith(buffer, [0x7f, 0x45, 0x4c, 0x46])) return { type: 'executable', what: 'Linux (ELF)' }
  if (startsWith(buffer, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(buffer, [0xca, 0xfe, 0xba, 0xbe])) {
    return { type: 'executable', what: 'macOS' }
  }
  if (startsWith(buffer, [0x23, 0x21])) return { type: 'executable', what: 'скрипт' }
  if (startsWith(buffer, [0x52, 0x61, 0x72, 0x21])) return { type: 'archive', what: 'RAR' }
  if (startsWith(buffer, [0x37, 0x7a, 0xbc, 0xaf])) return { type: 'archive', what: '7z' }
  if (startsWith(buffer, [0x1f, 0x8b])) return { type: 'archive', what: 'gzip' }
  if (startsWith(buffer, [0xfe, 0xff]) || startsWith(buffer, [0xff, 0xfe])) return { type: 'text' }
  const head = buffer.subarray(0, 8192)
  if (head.includes(0)) return { type: 'other-binary' }
  return { type: 'text' }
}

const SNIFF_LABEL: Record<Sniffed['type'], string> = {
  pdf: 'PDF',
  zip: 'ZIP-архив',
  ole: 'файл Microsoft Office старого формата',
  png: 'изображение PNG',
  jpeg: 'изображение JPEG',
  executable: 'исполняемый файл',
  archive: 'архив',
  'other-binary': 'двоичные данные',
  text: 'текст',
}

// ─── Public entry ───────────────────────────────────────────────────────────

export function preflightDocument(buffer: Buffer, fileName: string, opts: PreflightOptions = {}): PreflightResult {
  const ext = fileExtension(fileName)
  const reject = (code: PreflightCode, reason: string, kind: DocumentKind | null = null, mime: string | null = null): PreflightResult => ({
    ok: false, code, reason, kind, mime, ext,
  })

  if (!buffer || buffer.length === 0) return reject('EMPTY', 'Файл пуст.')
  const maxBytes = opts.maxBytes ?? documentMaxBytes()
  if (buffer.length > maxBytes) {
    return reject('TOO_LARGE', `Файл больше ${Math.round(maxBytes / 1024 / 1024)} МБ.`)
  }

  const expected = EXTENSION_KIND[ext]
  if (!expected) {
    return reject('UNSUPPORTED_TYPE', LEGACY_OFFICE_HINT[ext]
      ?? `Формат${ext ? ` .${ext}` : ''} не поддерживается. Загрузите PDF, DOCX, XLSX, XLS, PPTX, CSV, TXT, PNG или JPG.`)
  }
  if (opts.allowedKinds && !opts.allowedKinds.includes(expected)) {
    return reject('UNSUPPORTED_TYPE', `Формат .${ext} здесь не принимается.`)
  }

  const sniffed = sniff(buffer)
  if (sniffed.type === 'executable') {
    return reject('EXECUTABLE', `Файл .${ext} на самом деле ${SNIFF_LABEL.executable} (${sniffed.what}). Такие файлы не принимаются.`)
  }

  const mismatch = () => reject(
    'MIME_MISMATCH',
    `Файл .${ext} должен быть ${KIND_LABEL[expected]}, но по содержимому это ${sniffed.type === 'archive' ? `архив ${sniffed.what}` : SNIFF_LABEL[sniffed.type]}.`,
  )

  switch (expected) {
    case 'pdf':
      if (sniffed.type !== 'pdf') return mismatch()
      return checkPdf(buffer, ext, opts)
    case 'docx':
    case 'xlsx':
    case 'pptx':
      if (sniffed.type === 'ole') return checkOle(buffer, ext, expected)
      if (sniffed.type !== 'zip') return mismatch()
      return checkOoxml(buffer, ext, expected, opts)
    case 'xls':
      // Real-world ".xls" files are BIFF (OLE), XLSX saved with the old
      // extension, or HTML/TSV exports from 1C and banking systems; SheetJS
      // reads all three.
      if (sniffed.type === 'ole') return checkOle(buffer, ext, 'xls')
      if (sniffed.type === 'zip') {
        const res = checkOoxml(buffer, ext, 'xlsx', opts)
        return res.ok ? { ...res, kind: 'xlsx', flags: [...res.flags, 'xls_extension_with_xlsx_content'] } : res
      }
      if (sniffed.type === 'text') {
        const res = checkText(buffer, ext, 'csv', opts)
        return res.ok ? { ...res, kind: 'xls', mime: MIME_BY_KIND.xls, flags: [...res.flags, 'xls_text_export'] } : res
      }
      return mismatch()
    case 'csv':
    case 'txt':
      if (sniffed.type !== 'text') {
        return sniffed.type === 'other-binary'
          ? reject('BINARY_TEXT', 'Текстовый файл содержит двоичные данные.')
          : mismatch()
      }
      return checkText(buffer, ext, expected, opts)
    case 'image':
      if (sniffed.type === 'png') return checkPng(buffer, ext)
      if (sniffed.type === 'jpeg') return checkJpeg(buffer, ext)
      return mismatch()
  }
}

// ─── PDF ────────────────────────────────────────────────────────────────────

const PDF_REJECT = /\/(JavaScript|JS|Launch|EmbeddedFiles?)(?![A-Za-z0-9])/
const PDF_FLAG: Array<[RegExp, string]> = [
  [/\/OpenAction(?![A-Za-z0-9])/, 'pdf_open_action'],
  [/\/AA(?![A-Za-z0-9])/, 'pdf_additional_actions'],
  [/\/XFA(?![A-Za-z0-9])/, 'pdf_xfa_form'],
  [/\/RichMedia(?![A-Za-z0-9])/, 'pdf_rich_media'],
  [/\/(SubmitForm|ImportData)(?![A-Za-z0-9])/, 'pdf_form_submit'],
  [/\/GoToR(?![A-Za-z0-9])/, 'pdf_remote_goto'],
  [/\/Encrypt(?![A-Za-z0-9])/, 'pdf_encrypted'],
]
const PDF_REJECT_LABEL: Record<string, string> = {
  JavaScript: 'JavaScript',
  JS: 'JavaScript',
  Launch: 'запуск внешних программ',
  EmbeddedFile: 'вложенные файлы',
  EmbeddedFiles: 'вложенные файлы',
}

/** PDF names may hide letters as #xx escapes (/J#61vaScript). */
function decodePdfNameEscapes(raw: string): string {
  return raw.replace(/#([0-9a-fA-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

/** Inflate /Type /ObjStm streams: objects (including actions) can hide there. */
function objectStreamTexts(raw: string, budgetBytes: number): { texts: string[]; incomplete: boolean } {
  const texts: string[] = []
  let used = 0
  let incomplete = false
  const re = /\/Type\s*\/ObjStm/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    const streamAt = raw.indexOf('stream', m.index)
    if (streamAt < 0) break
    let start = streamAt + 'stream'.length
    if (raw[start] === '\r') start += 1
    if (raw[start] === '\n') start += 1
    const end = raw.indexOf('endstream', start)
    if (end < 0) break
    const dict = raw.slice(Math.max(0, m.index - 512), streamAt)
    if (!/\/FlateDecode/.test(dict)) continue
    if (used >= budgetBytes) {
      incomplete = true
      break
    }
    try {
      const data = Buffer.from(raw.slice(start, end), 'latin1')
      const out = inflateSync(data, { maxOutputLength: Math.max(1, Math.min(8 * 1024 * 1024, budgetBytes - used)) })
      used += out.length
      texts.push(out.toString('latin1'))
    } catch {
      incomplete = true
    }
    re.lastIndex = end
  }
  return { texts, incomplete }
}

/**
 * The PDF without stream payloads. Compressed page/image data is random bytes
 * in which a short token like "/JS" turns up by chance about once per 20 MB;
 * actions and their keys live in object dictionaries outside streams (or in
 * object streams, which are inflated and scanned separately).
 */
function withoutStreamData(raw: string): string {
  const parts: string[] = []
  let pos = 0
  const re = /stream\r?\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    if (raw.slice(Math.max(0, m.index - 3), m.index) === 'end') continue
    const dataStart = m.index + m[0].length
    const end = raw.indexOf('endstream', dataStart)
    if (end < 0) break
    parts.push(raw.slice(pos, dataStart))
    pos = end
    re.lastIndex = end + 'endstream'.length
  }
  parts.push(raw.slice(pos))
  return parts.join('')
}

function checkPdf(buffer: Buffer, ext: string, opts: PreflightOptions): PreflightResult {
  const raw = buffer.toString('latin1')
  if (!/%PDF-\d\.\d/.test(raw.slice(0, 1024))) {
    return { ok: false, code: 'PDF_INVALID', reason: 'Содержимое файла не похоже на PDF.', kind: 'pdf', mime: MIME_BY_KIND.pdf, ext }
  }
  const { texts, incomplete } = objectStreamTexts(raw, 64 * 1024 * 1024)
  const flags: string[] = []
  if (incomplete) flags.push('pdf_objstm_scan_incomplete')
  let pages = 0
  for (const part of [withoutStreamData(raw), ...texts]) {
    const text = decodePdfNameEscapes(part)
    const hit = PDF_REJECT.exec(text)
    if (hit) {
      return {
        ok: false,
        code: 'PDF_ACTIVE_CONTENT',
        reason: `PDF содержит активное содержимое (${PDF_REJECT_LABEL[hit[1]] ?? hit[1]}). PDF с JavaScript, запуском программ или вложенными файлами не принимаются — сохраните документ заново («Печать в PDF»).`,
        kind: 'pdf',
        mime: MIME_BY_KIND.pdf,
        ext,
      }
    }
    for (const [re, flag] of PDF_FLAG) if (re.test(text) && !flags.includes(flag)) flags.push(flag)
    pages += text.match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0
  }
  if (opts.maxPdfPages && pages > opts.maxPdfPages) {
    return {
      ok: false,
      code: 'PDF_TOO_MANY_PAGES',
      reason: `PDF содержит слишком много страниц (максимум ${opts.maxPdfPages}).`,
      kind: 'pdf',
      mime: MIME_BY_KIND.pdf,
      ext,
    }
  }
  return { ok: true, kind: 'pdf', mime: MIME_BY_KIND.pdf, ext, flags, meta: { pages } }
}

// ─── OLE (legacy Office / encrypted OOXML) ─────────────────────────────────

function containsUtf16(buffer: Buffer, s: string): boolean {
  return buffer.includes(Buffer.from(s, 'utf16le'))
}

function checkOle(buffer: Buffer, ext: string, expected: DocumentKind): PreflightResult {
  if (containsUtf16(buffer, 'EncryptedPackage')) {
    return { ok: false, code: 'ENCRYPTED', reason: 'Файл защищён паролем. Снимите пароль и загрузите заново.', kind: expected, mime: null, ext }
  }
  if (expected === 'xls' && (containsUtf16(buffer, 'Workbook') || containsUtf16(buffer, 'Book'))) {
    if (containsUtf16(buffer, '_VBA_PROJECT_CUR')) {
      return { ok: false, code: 'MACRO_ENABLED', reason: 'Книга Excel содержит макросы. Сохраните её как XLSX без макросов.', kind: 'xls', mime: MIME_BY_KIND.xls, ext }
    }
    return { ok: true, kind: 'xls', mime: MIME_BY_KIND.xls, ext, flags: [], meta: {} }
  }
  return {
    ok: false,
    code: 'MIME_MISMATCH',
    reason: `Расширение .${ext} не соответствует содержимому файла (обнаружен ${SNIFF_LABEL.ole}).`,
    kind: null,
    mime: null,
    ext,
  }
}

// ─── OOXML ──────────────────────────────────────────────────────────────────

const OOXML_ROOT: Record<'docx' | 'xlsx' | 'pptx', string> = { docx: 'word/', xlsx: 'xl/', pptx: 'ppt/' }

function checkOoxml(buffer: Buffer, ext: string, expected: 'docx' | 'xlsx' | 'pptx', opts: PreflightOptions): PreflightResult {
  const maxEntries = opts.maxZipEntries ?? 2_000
  const maxTotal = opts.maxZipUncompressed ?? 150 * 1024 * 1024
  const maxEntry = opts.maxZipEntryUncompressed ?? 100 * 1024 * 1024
  const maxRatio = opts.maxZipRatio ?? 150
  const fail = (code: PreflightCode, reason: string): PreflightResult => ({
    ok: false, code, reason, kind: expected, mime: MIME_BY_KIND[expected], ext,
  })

  let entries: ZipEntry[]
  try {
    entries = readZipEntries(buffer, maxEntries)
  } catch (err) {
    if (err instanceof ZipFormatError) {
      if (err.code === 'ZIP_ENCRYPTED') return fail('ENCRYPTED', 'Документ зашифрован. Снимите пароль и загрузите заново.')
      if (/too many entries/.test(err.message)) return fail('ZIP_BOMB', 'В документе слишком много внутренних файлов.')
      if (err.code === 'ZIP_PATH') return fail('ZIP_INVALID', 'Документ содержит небезопасный путь внутри ZIP-контейнера.')
    }
    return fail('ZIP_INVALID', `Содержимое файла не похоже на корректный ${KIND_LABEL[expected]} (повреждённый ZIP-контейнер).`)
  }

  const names = new Set(entries.map((e) => e.name))
  const detected = (['docx', 'xlsx', 'pptx'] as const).find((k) => entries.some((e) => e.name.startsWith(OOXML_ROOT[k])))
  if (!names.has('[Content_Types].xml') || !detected) {
    return fail('ZIP_INVALID', `ZIP не содержит обязательную структуру ${KIND_LABEL[expected]}.`)
  }
  if (detected !== expected) {
    return {
      ok: false,
      code: 'MIME_MISMATCH',
      reason: `Расширение .${ext} не соответствует содержимому файла (обнаружен ${KIND_LABEL[detected]}).`,
      kind: detected,
      mime: MIME_BY_KIND[detected],
      ext,
    }
  }
  if (entries.some((e) => /(^|\/)vbaProject\.bin$/i.test(e.name))) {
    return fail('MACRO_ENABLED', 'Документ содержит макросы. Сохраните его без макросов (DOCX / XLSX / PPTX).')
  }

  let declaredTotal = 0
  let compressedTotal = 0
  for (const e of entries) {
    if (e.uncompressedSize > maxEntry) return fail('ZIP_BOMB', 'Внутренняя часть документа слишком велика. Разбейте файл на несколько.')
    declaredTotal += e.uncompressedSize
    compressedTotal += e.compressedSize
  }
  if (declaredTotal > maxTotal) return fail('ZIP_BOMB', 'Распакованный документ превышает безопасный лимит. Разбейте файл на несколько.')
  if (declaredTotal / Math.max(compressedTotal, 1) > maxRatio) {
    return fail('ZIP_BOMB', 'Документ отклонён из-за подозрительно высокой степени сжатия.')
  }

  // Declared sizes can lie: inflate every entry with its declared size as the
  // hard ceiling, and look for DTD / entity declarations in XML parts.
  let actualTotal = 0
  try {
    for (const e of entries) {
      const isXml = /\.(xml|rels|vml)$/i.test(e.name)
      if (isXml) {
        const head = peekZipEntry(buffer, e).toString('utf8')
        if (/<!DOCTYPE|<!ENTITY/i.test(head)) {
          return fail('XML_ENTITY', 'Документ содержит XML-объявления сущностей (DOCTYPE/ENTITY) — такие файлы не принимаются.')
        }
      }
      const data = readZipEntry(buffer, e)
      actualTotal += data.length
      if (isXml && /<!DOCTYPE|<!ENTITY/i.test(data.subarray(0, 65_536).toString('utf8'))) {
        return fail('XML_ENTITY', 'Документ содержит XML-объявления сущностей (DOCTYPE/ENTITY) — такие файлы не принимаются.')
      }
      // Main part declared macro-enabled (.xlsm/.docm/.pptm renamed). Default
      // entries for *.bin are written by some generators and are harmless.
      if (e.name === '[Content_Types].xml' && /<Override[^>]*ContentType="[^"]*macroEnabled[^"]*"/i.test(data.toString('utf8'))) {
        return fail('MACRO_ENABLED', 'Документ содержит макросы. Сохраните его без макросов (DOCX / XLSX / PPTX).')
      }
    }
  } catch (err) {
    if (err instanceof ZipFormatError && err.code === 'ZIP_SIZE_MISMATCH') {
      return fail('ZIP_BOMB', 'Размеры частей документа не совпадают с заявленными — файл отклонён.')
    }
    return fail('ZIP_INVALID', `Содержимое файла не похоже на корректный ${KIND_LABEL[expected]} (повреждённый ZIP-контейнер).`)
  }

  return {
    ok: true,
    kind: expected,
    mime: MIME_BY_KIND[expected],
    ext,
    flags: [],
    meta: { zipEntries: entries.length, uncompressedBytes: actualTotal },
  }
}

// ─── Text ───────────────────────────────────────────────────────────────────

/** Decode text bytes; null when the encoding cannot be determined honestly. */
export function decodeText(buffer: Buffer): { text: string; encoding: TextEncoding } | null {
  if (startsWith(buffer, [0xef, 0xbb, 0xbf])) {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(3)), encoding: 'utf-8-bom' }
    } catch {
      return null
    }
  }
  if (startsWith(buffer, [0xff, 0xfe])) {
    return { text: new TextDecoder('utf-16le').decode(buffer.subarray(2)), encoding: 'utf-16le' }
  }
  if (startsWith(buffer, [0xfe, 0xff])) {
    return { text: new TextDecoder('utf-16be').decode(buffer.subarray(2)), encoding: 'utf-16be' }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' }
  } catch {
    // Not UTF-8. Russian exports (1C, banks, old Excel) are often Windows-1251:
    // most high bytes then fall into the Cyrillic letter range C0–FF.
  }
  let high = 0
  let cyrillic = 0
  for (const b of buffer.subarray(0, 65_536)) {
    if (b >= 0x80) {
      high += 1
      if (b >= 0xc0 || b === 0xa8 || b === 0xb8) cyrillic += 1
    }
  }
  if (high > 0 && cyrillic / high >= 0.6) {
    try {
      return { text: new TextDecoder('windows-1251').decode(buffer), encoding: 'windows-1251' }
    } catch {
      return null
    }
  }
  return null
}

function checkText(buffer: Buffer, ext: string, kind: 'csv' | 'txt', opts: PreflightOptions): PreflightResult {
  const maxLines = opts.maxTextLines ?? 1_000_000
  const maxLineBytes = opts.maxTextLineBytes ?? 1024 * 1024
  const fail = (code: PreflightCode, reason: string): PreflightResult => ({
    ok: false, code, reason, kind, mime: MIME_BY_KIND[kind], ext,
  })
  const decoded = decodeText(buffer)
  if (!decoded) return fail('TEXT_ENCODING', 'Не удалось определить кодировку текста. Сохраните файл в UTF-8.')
  if (decoded.text.includes('\u0000')) return fail('BINARY_TEXT', 'Текстовый файл содержит двоичные данные.')
  const lines = decoded.text.split(/\r?\n/)
  if (lines.length > maxLines) return fail('TEXT_TOO_LARGE', 'В файле слишком много строк.')
  if (lines.some((line) => line.length * 3 > maxLineBytes && Buffer.byteLength(line, 'utf8') > maxLineBytes)) {
    return fail('TEXT_TOO_LARGE', 'В файле найдена слишком длинная строка.')
  }
  return {
    ok: true,
    kind,
    mime: MIME_BY_KIND[kind],
    ext,
    flags: decoded.encoding === 'utf-8' ? [] : [`encoding_${decoded.encoding}`],
    meta: { encoding: decoded.encoding, lines: lines.length },
  }
}

// ─── Images ─────────────────────────────────────────────────────────────────

const MAX_IMAGE_SIDE = 12_000
const MAX_IMAGE_PIXELS = 60_000_000

function imageResult(ext: string, mime: string, width: number, height: number): PreflightResult {
  if (!width || !height) {
    return { ok: false, code: 'IMAGE_INVALID', reason: 'Изображение повреждено.', kind: 'image', mime, ext }
  }
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
    return { ok: false, code: 'IMAGE_TOO_LARGE', reason: 'Изображение слишком большое по количеству пикселей.', kind: 'image', mime, ext }
  }
  const flags = (ext === 'png') === (mime === 'image/png') ? [] : ['image_extension_mismatch']
  return { ok: true, kind: 'image', mime, ext, flags, meta: { width, height } }
}

function checkPng(buffer: Buffer, ext: string): PreflightResult {
  if (buffer.length < 24 || buffer.toString('latin1', 12, 16) !== 'IHDR') {
    return { ok: false, code: 'IMAGE_INVALID', reason: 'Изображение PNG повреждено.', kind: 'image', mime: 'image/png', ext }
  }
  return imageResult(ext, 'image/png', buffer.readUInt32BE(16), buffer.readUInt32BE(20))
}

function checkJpeg(buffer: Buffer, ext: string): PreflightResult {
  let p = 2
  while (p + 9 < buffer.length) {
    if (buffer[p] !== 0xff) {
      p += 1
      continue
    }
    const marker = buffer[p + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2
      continue
    }
    const len = buffer.readUInt16BE(p + 2)
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) return imageResult(ext, 'image/jpeg', buffer.readUInt16BE(p + 7), buffer.readUInt16BE(p + 5))
    if (len < 2) break
    p += 2 + len
  }
  return { ok: false, code: 'IMAGE_INVALID', reason: 'Изображение JPEG повреждено.', kind: 'image', mime: 'image/jpeg', ext }
}
