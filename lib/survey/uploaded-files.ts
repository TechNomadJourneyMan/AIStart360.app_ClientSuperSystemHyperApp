/**
 * lib/survey/uploaded-files.ts — the step-1 file cards «Загрузка данных за 3
 * года» (survey key `s1_uploaded_files`).
 *
 * The answer is a list of file entries. Since 2026-10-23 every file goes
 * through the normal document pipeline (lib/documents/client-upload.ts:
 * private bucket `client-documents`, POST /api/v1/documents — checks, dedupe,
 * parsing, «Мои документы») and is linked to the question `s1_uploaded_files`;
 * the entry keeps the document id and the storage location, never a URL.
 * Older entries were uploaded straight to Storage (no documents row): they
 * carry only `path` (in `client-documents`).
 *
 * Browser-safe: no server imports.
 */
import { CLIENT_DOCUMENT_BUCKET } from '@/lib/documents/client-upload'
import type { ClientDocument } from '@/lib/documents/status-view'
import { isFileRouteBucket, isSafeObjectPath, ownerFolderOf, type FileRef } from '@/lib/documents/survey-files'

/** The question the step-1 documents are attached to (documents.question_key). */
export const S1_FILES_KEY = 's1_uploaded_files'

export type S1FileKind = 'sales_report' | 'crm_export'

export interface S1StoredFile {
  path: string
  name: string
  size: number
  kind: S1FileKind
  uploaded_at: string
  /** documents.id — absent on entries uploaded before the document pipeline. */
  document_id?: string
  /** Storage bucket of `path`; absent on old entries (= `client-documents`). */
  bucket?: string
}

function isKind(v: unknown): v is S1FileKind {
  return v === 'sales_report' || v === 'crm_export'
}

/** The stored entries; malformed items are dropped. */
export function s1StoredFiles(value: unknown): S1StoredFile[] {
  if (!Array.isArray(value)) return []
  return value.filter((f): f is S1StoredFile => {
    if (!f || typeof f !== 'object') return false
    const e = f as Record<string, unknown>
    return typeof e.path === 'string' && typeof e.name === 'string' && isKind(e.kind)
  })
}

/** The entry of a registered document (created or a duplicate of an earlier upload); null without a storage path. */
export function s1EntryFromDocument(
  doc: Pick<ClientDocument, 'id' | 'file_name' | 'file_size' | 'size_bytes' | 'storage_bucket' | 'storage_path'>,
  file: { name: string; size: number },
  kind: S1FileKind,
  now: Date = new Date(),
): S1StoredFile | null {
  if (!doc.storage_path) return null
  return {
    document_id: doc.id,
    bucket: doc.storage_bucket || CLIENT_DOCUMENT_BUCKET,
    path: doc.storage_path,
    name: doc.file_name || file.name,
    size: doc.file_size ?? doc.size_bytes ?? file.size,
    kind,
    uploaded_at: now.toISOString(),
  }
}

/** `current` plus `added`, without a second entry for the same document (a duplicate upload). */
export function mergeS1Files(current: S1StoredFile[], added: S1StoredFile[]): S1StoredFile[] {
  const out = [...current]
  for (const entry of added) {
    const same = out.findIndex((f) =>
      entry.document_id ? f.document_id === entry.document_id : f.path === entry.path,
    )
    if (same === -1) out.push(entry)
  }
  return out
}

/** Where the entry's bytes are, for the access-checked file route; null when it cannot be served. */
export function s1FileRef(entry: S1StoredFile): FileRef | null {
  const bucket = entry.bucket || CLIENT_DOCUMENT_BUCKET
  if (!isFileRouteBucket(bucket) || !isSafeObjectPath(entry.path) || !ownerFolderOf(entry.path)) return null
  return { bucket, path: entry.path }
}
