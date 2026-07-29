const MAX_ZIP_ENTRIES = 1_000
const MAX_ZIP_UNCOMPRESSED = 40 * 1024 * 1024
const MAX_ZIP_ENTRY_UNCOMPRESSED = 20 * 1024 * 1024
const MAX_ZIP_RATIO = 100
const MAX_PDF_PAGE_MARKERS = 400
const MAX_TEXT_LINES = 120_000
const MAX_TEXT_LINE_BYTES = 256 * 1024

export class UnsafeJourneyFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeJourneyFileError'
  }
}

/** Cheap preflight before any third-party parser or object storage call. */
export function assertSafeJourneyFile(buffer: Buffer, extension: string): void {
  if (!buffer.length) throw new UnsafeJourneyFileError('Файл пуст.')
  switch (extension) {
    case 'pdf':
      assertPdf(buffer)
      return
    case 'docx':
      assertOfficeZip(buffer, 'docx')
      return
    case 'csv':
    case 'txt':
      assertPlainText(buffer)
      return
    default:
      throw new UnsafeJourneyFileError('Этот формат не разрешён в Journey.')
  }
}

function assertPdf(buffer: Buffer): void {
  if (!buffer.subarray(0, 16).includes(Buffer.from('%PDF-'))) {
    throw new UnsafeJourneyFileError('Содержимое файла не похоже на PDF.')
  }
  const raw = buffer.toString('latin1')
  const pageMarkers = raw.match(/\/Type\s*\/Page\b/g)?.length ?? 0
  if (pageMarkers > MAX_PDF_PAGE_MARKERS) {
    throw new UnsafeJourneyFileError(`PDF содержит слишком много страниц (максимум ${MAX_PDF_PAGE_MARKERS}).`)
  }
  if (/\/JavaScript\b|\/JS\b|\/Launch\b|\/EmbeddedFile\b/i.test(raw)) {
    throw new UnsafeJourneyFileError('PDF с JavaScript, запуском файлов или вложениями не поддерживается.')
  }
}

function assertOfficeZip(buffer: Buffer, kind: 'docx'): void {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new UnsafeJourneyFileError('Содержимое файла не похоже на корректный DOCX ZIP-контейнер.')
  }
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) throw new UnsafeJourneyFileError('ZIP-контейнер документа повреждён.')
  const entries = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (entries <= 0 || entries > MAX_ZIP_ENTRIES) {
    throw new UnsafeJourneyFileError('В документе слишком много внутренних файлов.')
  }
  if (centralOffset + centralSize > buffer.length) {
    throw new UnsafeJourneyFileError('Некорректная ZIP-структура документа.')
  }

  let pointer = centralOffset
  let totalCompressed = 0
  let totalUncompressed = 0
  let hasContentTypes = false
  let hasRequiredDirectory = false
  for (let index = 0; index < entries; index += 1) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== 0x02014b50) {
      throw new UnsafeJourneyFileError('Некорректная центральная директория ZIP.')
    }
    const flags = buffer.readUInt16LE(pointer + 8)
    const compressed = buffer.readUInt32LE(pointer + 20)
    const uncompressed = buffer.readUInt32LE(pointer + 24)
    const nameLength = buffer.readUInt16LE(pointer + 28)
    const extraLength = buffer.readUInt16LE(pointer + 30)
    const commentLength = buffer.readUInt16LE(pointer + 32)
    const next = pointer + 46 + nameLength + extraLength + commentLength
    if (next > buffer.length) throw new UnsafeJourneyFileError('ZIP entry выходит за пределы файла.')
    if ((flags & 0x1) !== 0) throw new UnsafeJourneyFileError('Зашифрованные документы не поддерживаются.')
    if (uncompressed > MAX_ZIP_ENTRY_UNCOMPRESSED) {
      throw new UnsafeJourneyFileError('Внутренняя часть документа слишком велика.')
    }
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8')
    if (name.startsWith('/') || name.split('/').includes('..')) {
      throw new UnsafeJourneyFileError('Документ содержит небезопасный ZIP-путь.')
    }
    if (name === '[Content_Types].xml') hasContentTypes = true
    if (kind === 'docx' && name.startsWith('word/')) hasRequiredDirectory = true
    totalCompressed += compressed
    totalUncompressed += uncompressed
    pointer = next
  }

  if (!hasContentTypes || !hasRequiredDirectory) {
    throw new UnsafeJourneyFileError('ZIP не содержит обязательную структуру DOCX.')
  }
  if (totalUncompressed > MAX_ZIP_UNCOMPRESSED) {
    throw new UnsafeJourneyFileError('Распакованный документ превышает безопасный лимит.')
  }
  if (totalUncompressed / Math.max(totalCompressed, 1) > MAX_ZIP_RATIO) {
    throw new UnsafeJourneyFileError('Документ отклонён из-за подозрительно высокого сжатия.')
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const lowerBound = Math.max(0, buffer.length - 65_557)
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  return -1
}

function assertPlainText(buffer: Buffer): void {
  if (buffer.includes(0)) throw new UnsafeJourneyFileError('Текстовый файл содержит бинарные данные.')
  const text = buffer.toString('utf8')
  if (text.includes('\uFFFD')) throw new UnsafeJourneyFileError('Текстовый файл должен быть в UTF-8.')
  const lines = text.split(/\r?\n/)
  if (lines.length > MAX_TEXT_LINES) throw new UnsafeJourneyFileError('В таблице слишком много строк.')
  if (lines.some((line) => Buffer.byteLength(line, 'utf8') > MAX_TEXT_LINE_BYTES)) {
    throw new UnsafeJourneyFileError('В файле найдена слишком длинная строка.')
  }
}
