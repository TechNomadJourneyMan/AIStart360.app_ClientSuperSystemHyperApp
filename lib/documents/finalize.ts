/**
 * lib/documents/finalize.ts — turn an uploaded storage object into a documents
 * row the pipeline can trust.
 *
 *   path rules → capped download (service role) → preflight → sha256 →
 *   dedupe (same company + same bytes = same document) → insert →
 *   FILE_UPLOADED (→ document_intelligence agent)
 *
 * Rejected files get a row (parse_status='rejected', security_reason) so the
 * client sees why, and their object is deleted. Duplicates return the existing
 * row and drop the new object. Everything external is injected (storage, row
 * persistence, event emission), so the rules are unit-testable without a
 * network or a database.
 */
import { createHash } from 'node:crypto'
import type { PlatformEventInput } from '@/lib/events/platform'
import { isDocumentType } from './doc-types'
import { documentMaxBytes, fileExtension, preflightDocument } from './preflight'
import type { DocumentRow, InsertDocumentInput } from './repository'
import { DuplicateDocumentError } from './repository'
import { checkUploadLocation, StorageError, stripControlChars, type DocumentStorage, type StorageLocation } from './storage'

export interface FinalizeRequest {
  userId: string
  companyId: string | null
  bucket: string
  storagePath: string
  fileName: string
  docType: string
  periodQuarter?: string | null
  periodYear?: number | null
  allowedBuckets: readonly string[]
}

export interface FinalizeDeps {
  storage: DocumentStorage
  findDuplicate(args: { companyId: string | null; userId: string; sha256: string }): Promise<DocumentRow | null>
  insertDocument(row: InsertDocumentInput): Promise<DocumentRow>
  emit(event: PlatformEventInput): void
  maxBytes?: number
}

export type FinalizeOutcome =
  | { kind: 'created'; document: DocumentRow }
  | { kind: 'duplicate'; document: DocumentRow }
  | { kind: 'rejected'; document: DocumentRow; code: string; reason: string }
  | { kind: 'invalid'; status: 400 | 403 | 404 | 503; code: string; error: string }

const QUARTERS = new Set(['Q1', 'Q2', 'Q3', 'Q4'])

/** Display name: no control characters, no path, bounded length. */
export function sanitizeFileName(name: string, fallbackPath: string): string {
  const base = stripControlChars((name ?? '').split(/[\\/]/).pop() ?? '').trim()
  const fallback = fallbackPath.split('/').pop() ?? 'document'
  const chosen = base || fallback
  if (chosen.length <= 255) return chosen
  const ext = fileExtension(chosen)
  return ext ? `${chosen.slice(0, 250 - ext.length)}….${ext}` : chosen.slice(0, 255)
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

const sameLocation = (doc: DocumentRow, loc: StorageLocation) =>
  doc.storage_bucket === loc.bucket && doc.storage_path === loc.path

export async function finalizeUpload(req: FinalizeRequest, deps: FinalizeDeps): Promise<FinalizeOutcome> {
  if (!isDocumentType(req.docType)) {
    return { kind: 'invalid', status: 400, code: 'BAD_DOC_TYPE', error: 'Неизвестный тип документа.' }
  }
  const quarter = req.periodQuarter ?? null
  if (quarter !== null && !QUARTERS.has(quarter)) {
    return { kind: 'invalid', status: 400, code: 'BAD_PERIOD', error: 'Квартал должен быть Q1–Q4.' }
  }
  const year = req.periodYear ?? null
  if (year !== null && (!Number.isInteger(year) || year < 2020 || year > 2030)) {
    return { kind: 'invalid', status: 400, code: 'BAD_PERIOD', error: 'Год периода должен быть в диапазоне 2020–2030.' }
  }

  const where = checkUploadLocation(req.userId, req.bucket, req.storagePath, req.allowedBuckets)
  if (!where.ok) return { kind: 'invalid', status: 403, code: 'FORBIDDEN_PATH', error: where.reason }
  const loc = where.location

  const fileName = sanitizeFileName(req.fileName, loc.path)
  const nameForType = fileExtension(fileName) ? fileName : loc.path
  const maxBytes = deps.maxBytes ?? documentMaxBytes()

  const base: Omit<InsertDocumentInput, 'sizeBytes' | 'sha256' | 'sniffedMime' | 'securityStatus' | 'securityReason' | 'parseStatus' | 'processingStage' | 'lastErrorCode' | 'parseError' | 'mimeType'> = {
    userId: req.userId,
    companyId: req.companyId,
    fileName,
    // Old readers expect file_url; it now holds the storage path, never a bearer URL.
    fileUrl: loc.path,
    docType: req.docType,
    periodQuarter: quarter,
    periodYear: year,
    storageBucket: loc.bucket,
    storagePath: loc.path,
  }

  const reject = async (code: string, reason: string, extra: { sizeBytes: number | null; sha256: string | null; mime: string | null }) => {
    await deps.storage.remove(loc).catch((err) => {
      console.error('[documents/finalize] could not delete rejected object', err instanceof Error ? err.message : err)
    })
    const document = await deps.insertDocument({
      ...base,
      mimeType: extra.mime,
      sizeBytes: extra.sizeBytes,
      sha256: extra.sha256,
      sniffedMime: extra.mime,
      securityStatus: 'rejected',
      securityReason: reason,
      parseStatus: 'rejected',
      processingStage: 'failed',
      lastErrorCode: code,
      parseError: reason,
    })
    return { kind: 'rejected' as const, document, code, reason }
  }

  let buffer: Buffer
  try {
    buffer = await deps.storage.download(loc, { maxBytes })
  } catch (err) {
    if (err instanceof StorageError) {
      if (err.code === 'NOT_FOUND') {
        return { kind: 'invalid', status: 404, code: 'NOT_FOUND', error: 'Файл не найден в хранилище. Загрузите его заново.' }
      }
      if (err.code === 'TOO_LARGE') {
        return reject('TOO_LARGE', `Файл больше ${Math.round(maxBytes / 1024 / 1024)} МБ.`, { sizeBytes: null, sha256: null, mime: null })
      }
    }
    return { kind: 'invalid', status: 503, code: 'STORAGE_UNAVAILABLE', error: 'Хранилище временно недоступно. Повторите попытку.' }
  }

  const sha256 = sha256Hex(buffer)
  const check = preflightDocument(buffer, nameForType, { maxBytes })
  if (!check.ok) {
    return reject(check.code, check.reason, { sizeBytes: buffer.length, sha256, mime: check.mime })
  }

  const dropOurCopy = async (existing: DocumentRow) => {
    if (sameLocation(existing, loc)) return
    await deps.storage.remove(loc).catch((err) => {
      console.error('[documents/finalize] could not delete duplicate object', err instanceof Error ? err.message : err)
    })
  }

  const existing = await deps.findDuplicate({ companyId: req.companyId, userId: req.userId, sha256 })
  if (existing) {
    await dropOurCopy(existing)
    return { kind: 'duplicate', document: existing }
  }

  let document: DocumentRow
  try {
    document = await deps.insertDocument({
      ...base,
      mimeType: check.mime,
      sizeBytes: buffer.length,
      sha256,
      sniffedMime: check.mime,
      securityStatus: 'clean',
      securityReason: null,
      parseStatus: 'queued',
      processingStage: 'validated',
      lastErrorCode: null,
      parseError: null,
    })
  } catch (err) {
    if (!(err instanceof DuplicateDocumentError)) throw err
    // Lost a race with an identical upload: the other request created the row.
    const winner = await deps.findDuplicate({ companyId: req.companyId, userId: req.userId, sha256 })
    if (!winner) throw err
    await dropOurCopy(winner)
    return { kind: 'duplicate', document: winner }
  }

  if (document.company_id) {
    deps.emit({
      name: 'FILE_UPLOADED',
      companyId: document.company_id,
      subjectType: 'document',
      subjectId: document.id,
      actor: req.userId,
      payload: { document_id: document.id, doc_type: document.doc_type, kind: check.kind, mime: check.mime, size_bytes: buffer.length },
      dedupeKey: `file_uploaded:${document.id}`,
    })
  }
  return { kind: 'created', document }
}
