/**
 * «Прикрепить файл к клиенту» from the admin bot: the bytes the staff member
 * sent to the bot are stored in the client's folder of the private bucket
 * (`client-documents/<clientUserId>/telegram/…`, service role) and registered
 * through the SAME finalizeUpload as the client's own uploads — capped
 * download, preflight, sha256 dedupe, documents row, FILE_UPLOADED →
 * document_intelligence agent. A rejected file gets its rejected row, like any
 * upload. Storage and the finalize dependencies are injectable for tests.
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { emitPlatformEventSafely } from '@/lib/events/platform'
import { finalizeUpload, type FinalizeDeps } from '@/lib/documents/finalize'
import { findDuplicate, insertDocument } from '@/lib/documents/repository'
import { documentStorage, UPLOAD_BUCKET, uploadDocumentObject, type StorageLocation } from '@/lib/documents/storage'

export interface AttachDeps {
  upload(loc: StorageLocation, bytes: Buffer, mime: string): Promise<void>
  companyOf(userId: string): Promise<string | null>
  finalize: FinalizeDeps
}

export function defaultAttachDeps(): AttachDeps {
  return {
    upload: uploadDocumentObject,
    async companyOf(userId) {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM public.companies WHERE user_id = ${userId}::uuid ORDER BY created_at ASC NULLS LAST LIMIT 1`
      return rows[0]?.id ?? null
    },
    finalize: { storage: documentStorage(), findDuplicate, insertDocument, emit: emitPlatformEventSafely },
  }
}

/** File name safe for a storage key: latin letters, digits, dot, dash, underscore; extension kept. */
export function storageSafeName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').normalize('NFKD')
  const ext = (base.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? '').toLowerCase()
  const stem = base.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 60) || 'file'
  return ext ? `${stem}.${ext}` : stem
}

export type AttachResult =
  | { ok: true; documentId: string; duplicate: boolean; fileName: string }
  | { ok: false; error: string }

export async function attachFileToClient(args: {
  clientUserId: string
  bytes: Buffer
  fileName: string
  mime: string | null
  docType: string
  deps?: AttachDeps
}): Promise<AttachResult> {
  const deps = args.deps ?? defaultAttachDeps()
  const companyId = await deps.companyOf(args.clientUserId)
  if (!companyId) return { ok: false, error: 'У клиента нет компании — документы привязываются к компании.' }
  const loc: StorageLocation = {
    bucket: UPLOAD_BUCKET,
    path: `${args.clientUserId}/telegram/${Date.now()}-${randomUUID().slice(0, 8)}-${storageSafeName(args.fileName)}`,
  }
  try {
    await deps.upload(loc, args.bytes, args.mime ?? 'application/octet-stream')
  } catch {
    return { ok: false, error: 'Хранилище недоступно — файл не сохранён. Повторите позже.' }
  }
  const outcome = await finalizeUpload({
    userId: args.clientUserId,
    companyId,
    bucket: loc.bucket,
    storagePath: loc.path,
    fileName: args.fileName,
    docType: args.docType,
    allowedBuckets: [UPLOAD_BUCKET],
  }, deps.finalize)
  switch (outcome.kind) {
    case 'created':
      return { ok: true, documentId: outcome.document.id, duplicate: false, fileName: outcome.document.file_name }
    case 'duplicate':
      return { ok: true, documentId: outcome.document.id, duplicate: true, fileName: outcome.document.file_name }
    case 'rejected':
      return { ok: false, error: `Файл отклонён проверкой: ${outcome.reason}` }
    case 'invalid':
      return { ok: false, error: outcome.error }
  }
}
