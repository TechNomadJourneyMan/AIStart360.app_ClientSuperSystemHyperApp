/**
 * AI Journey upload preflight — a thin policy layer over the shared
 * lib/documents/preflight.ts (magic bytes, ZIP/XML bombs, PDF active content,
 * text encoding). Journey keeps its stricter limits: only PDF / DOCX / CSV /
 * TXT, at most 400 PDF pages, smaller ZIP and text budgets. The byte-size cap
 * is enforced by the Journey route before this call.
 */
import { preflightDocument, type DocumentKind } from '@/lib/documents/preflight'

const JOURNEY_KINDS: readonly DocumentKind[] = ['pdf', 'docx', 'csv', 'txt']
const JOURNEY_EXTENSIONS = new Set(['pdf', 'docx', 'csv', 'txt'])

export class UnsafeJourneyFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeJourneyFileError'
  }
}

/** Cheap preflight before any third-party parser or object storage call. */
export function assertSafeJourneyFile(buffer: Buffer, extension: string): void {
  if (!buffer.length) throw new UnsafeJourneyFileError('Файл пуст.')
  const ext = extension.toLowerCase()
  if (!JOURNEY_EXTENSIONS.has(ext)) throw new UnsafeJourneyFileError('Этот формат не разрешён в Journey.')
  const result = preflightDocument(buffer, `upload.${ext}`, {
    maxBytes: Number.MAX_SAFE_INTEGER,
    allowedKinds: JOURNEY_KINDS,
    maxPdfPages: 400,
    maxTextLines: 120_000,
    maxTextLineBytes: 256 * 1024,
    maxZipEntries: 1_000,
    maxZipUncompressed: 40 * 1024 * 1024,
    maxZipEntryUncompressed: 20 * 1024 * 1024,
    maxZipRatio: 100,
  })
  if (!result.ok) throw new UnsafeJourneyFileError(result.reason)
}
