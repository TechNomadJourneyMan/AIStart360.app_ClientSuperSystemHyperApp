/**
 * Finalize rules (lib/documents/finalize.ts) with injected storage / rows /
 * events: owner-folder paths, size cap, preflight rejection (row + object
 * deleted), sha256 dedupe, the race on the unique index, FILE_UPLOADED.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { finalizeUpload, sanitizeFileName, sha256Hex, type FinalizeDeps, type FinalizeRequest } from '@/lib/documents/finalize'
import { DuplicateDocumentError, type DocumentRow, type InsertDocumentInput } from '@/lib/documents/repository'
import { StorageError, checkUploadLocation, locationForDocument, parseStorageUrl, type DocumentStorage, type StorageLocation } from '@/lib/documents/storage'
import type { PlatformEventInput } from '@/lib/events/platform'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const COMPANY = 'company-a'

const CSV = Buffer.from('Показатель;Значение\nВыручка;12500000\n', 'utf8')

class FakeStorage implements DocumentStorage {
  objects = new Map<string, Buffer>()
  removed: string[] = []
  unavailable = false
  key = (l: StorageLocation) => `${l.bucket}/${l.path}`
  async download(loc: StorageLocation, { maxBytes }: { maxBytes: number }) {
    if (this.unavailable) throw new StorageError('UNAVAILABLE', 'down')
    const b = this.objects.get(this.key(loc))
    if (!b) throw new StorageError('NOT_FOUND', 'missing')
    if (b.length > maxBytes) throw new StorageError('TOO_LARGE', 'big')
    return b
  }
  async remove(loc: StorageLocation) {
    this.removed.push(this.key(loc))
    this.objects.delete(this.key(loc))
  }
  async signedUrl() {
    return null
  }
}

function rowFrom(input: InsertDocumentInput, id: string): DocumentRow {
  return {
    id, user_id: input.userId, company_id: input.companyId, session_id: null, file_name: input.fileName,
    file_url: input.fileUrl, file_size: input.sizeBytes, mime_type: input.mimeType, doc_type: input.docType,
    period_quarter: input.periodQuarter, period_year: input.periodYear, parse_status: input.parseStatus,
    parsed_data: null, parse_error: input.parseError, uploaded_at: new Date(), storage_bucket: input.storageBucket,
    storage_path: input.storagePath, size_bytes: input.sizeBytes, sha256: input.sha256, sniffed_mime: input.sniffedMime,
    security_status: input.securityStatus, security_reason: input.securityReason, processing_stage: input.processingStage,
    attempts: 0, last_error_code: input.lastErrorCode, processed_at: null, updated_at: new Date(),
    extraction_version: null, processing_task_id: null,
  }
}

let storage: FakeStorage
let rows: DocumentRow[]
let events: PlatformEventInput[]
let raceOnce: boolean

function deps(over: Partial<FinalizeDeps> = {}): FinalizeDeps {
  return {
    storage,
    async findDuplicate({ companyId, userId, sha256 }) {
      return rows.find((r) => r.sha256 === sha256 && r.security_status !== 'rejected'
        && (companyId ? r.company_id === companyId : r.company_id === null && r.user_id === userId)) ?? null
    },
    async insertDocument(input) {
      if (raceOnce && input.securityStatus === 'clean') {
        raceOnce = false
        rows.push(rowFrom({ ...input, storagePath: `${USER}/winner.csv` }, `winner-${rows.length}`))
        throw new DuplicateDocumentError()
      }
      const row = rowFrom(input, `doc-${rows.length + 1}`)
      rows.push(row)
      return row
    },
    emit: (e) => { events.push(e) },
    ...over,
  }
}

const req = (over: Partial<FinalizeRequest> = {}): FinalizeRequest => ({
  userId: USER,
  companyId: COMPANY,
  bucket: 'client-documents',
  storagePath: `${USER}/abc.csv`,
  fileName: 'P&L 2025.csv',
  docType: 'pl_report',
  periodQuarter: 'Q1',
  periodYear: 2025,
  allowedBuckets: ['client-documents'],
  ...over,
})

beforeEach(() => {
  storage = new FakeStorage()
  rows = []
  events = []
  raceOnce = false
})

describe('finalizeUpload', () => {
  it('registers a clean upload with measured metadata and emits FILE_UPLOADED', async () => {
    storage.objects.set(`client-documents/${USER}/abc.csv`, CSV)
    const out = await finalizeUpload(req(), deps())
    expect(out.kind).toBe('created')
    if (out.kind !== 'created') return
    expect(out.document).toMatchObject({
      parse_status: 'queued', processing_stage: 'validated', security_status: 'clean',
      storage_bucket: 'client-documents', storage_path: `${USER}/abc.csv`, file_url: `${USER}/abc.csv`,
      sha256: sha256Hex(CSV), size_bytes: CSV.length, sniffed_mime: 'text/csv', mime_type: 'text/csv',
    })
    expect(out.document.file_url).not.toMatch(/^https?:/)
    expect(events).toEqual([expect.objectContaining({
      name: 'FILE_UPLOADED', companyId: COMPANY, subjectType: 'document', subjectId: out.document.id,
      dedupeKey: `file_uploaded:${out.document.id}`,
    })])
  })

  it('refuses objects outside the caller folder or bucket', async () => {
    storage.objects.set(`client-documents/${OTHER}/abc.csv`, CSV)
    const foreign = await finalizeUpload(req({ storagePath: `${OTHER}/abc.csv` }), deps())
    expect(foreign).toMatchObject({ kind: 'invalid', status: 403, code: 'FORBIDDEN_PATH' })
    const bucket = await finalizeUpload(req({ bucket: 'documents' }), deps())
    expect(bucket).toMatchObject({ kind: 'invalid', status: 403 })
    const traversal = await finalizeUpload(req({ storagePath: `${USER}/../${OTHER}/abc.csv` }), deps())
    expect(traversal).toMatchObject({ kind: 'invalid', status: 403 })
    expect(rows).toHaveLength(0)
    expect(storage.removed).toEqual([])
  })

  it('validates doc_type and period before touching storage', async () => {
    expect(await finalizeUpload(req({ docType: 'malware' }), deps())).toMatchObject({ kind: 'invalid', status: 400, code: 'BAD_DOC_TYPE' })
    expect(await finalizeUpload(req({ periodQuarter: 'Q5' }), deps())).toMatchObject({ kind: 'invalid', code: 'BAD_PERIOD' })
    expect(await finalizeUpload(req({ periodYear: 2040 }), deps())).toMatchObject({ kind: 'invalid', code: 'BAD_PERIOD' })
  })

  it('404 for a missing object, 503 when storage is down — no row either way', async () => {
    expect(await finalizeUpload(req(), deps())).toMatchObject({ kind: 'invalid', status: 404 })
    storage.unavailable = true
    expect(await finalizeUpload(req(), deps())).toMatchObject({ kind: 'invalid', status: 503 })
    expect(rows).toHaveLength(0)
  })

  it('rejects an oversized object: rejected row, object deleted, no event', async () => {
    storage.objects.set(`client-documents/${USER}/abc.csv`, Buffer.alloc(2048, 0x41))
    const out = await finalizeUpload(req(), deps({ maxBytes: 1024 }))
    expect(out).toMatchObject({ kind: 'rejected', code: 'TOO_LARGE' })
    expect(rows[0]).toMatchObject({ parse_status: 'rejected', security_status: 'rejected', processing_stage: 'failed', last_error_code: 'TOO_LARGE' })
    expect(storage.removed).toEqual([`client-documents/${USER}/abc.csv`])
    expect(events).toEqual([])
  })

  it('rejects a renamed executable with a reason the client can read', async () => {
    storage.objects.set(`client-documents/${USER}/x.pdf`, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]))
    const out = await finalizeUpload(req({ storagePath: `${USER}/x.pdf`, fileName: 'report.pdf' }), deps())
    expect(out.kind).toBe('rejected')
    if (out.kind !== 'rejected') return
    expect(out.code).toBe('EXECUTABLE')
    expect(out.document.security_reason).toMatch(/исполняемый/)
    expect(out.document.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(storage.objects.size).toBe(0)
  })

  it('returns the existing document for the same bytes in the same company and drops the new object', async () => {
    storage.objects.set(`client-documents/${USER}/a.csv`, CSV)
    storage.objects.set(`client-documents/${USER}/b.csv`, CSV)
    const first = await finalizeUpload(req({ storagePath: `${USER}/a.csv` }), deps())
    const second = await finalizeUpload(req({ storagePath: `${USER}/b.csv` }), deps())
    expect(first.kind).toBe('created')
    expect(second.kind).toBe('duplicate')
    if (first.kind !== 'created' || second.kind !== 'duplicate') return
    expect(second.document.id).toBe(first.document.id)
    expect(storage.removed).toEqual([`client-documents/${USER}/b.csv`])
    expect(rows).toHaveLength(1)
    expect(events).toHaveLength(1)
  })

  it('the same bytes in another company are a new document', async () => {
    storage.objects.set(`client-documents/${USER}/a.csv`, CSV)
    storage.objects.set(`client-documents/${USER}/b.csv`, CSV)
    await finalizeUpload(req({ storagePath: `${USER}/a.csv` }), deps())
    const other = await finalizeUpload(req({ storagePath: `${USER}/b.csv`, companyId: 'company-b' }), deps())
    expect(other.kind).toBe('created')
  })

  it('loses the insert race gracefully: answers with the winner', async () => {
    storage.objects.set(`client-documents/${USER}/a.csv`, CSV)
    raceOnce = true
    const out = await finalizeUpload(req({ storagePath: `${USER}/a.csv` }), deps())
    expect(out.kind).toBe('duplicate')
    expect(storage.removed).toEqual([`client-documents/${USER}/a.csv`])
  })

  it('a duplicate never deletes the object the existing row points to', async () => {
    storage.objects.set(`client-documents/${USER}/a.csv`, CSV)
    await finalizeUpload(req({ storagePath: `${USER}/a.csv` }), deps())
    storage.objects.set(`client-documents/${USER}/a.csv`, CSV)
    const again = await finalizeUpload(req({ storagePath: `${USER}/a.csv` }), deps())
    expect(again.kind).toBe('duplicate')
    expect(storage.removed).toEqual([])
  })
})

describe('storage locations', () => {
  it('parses public and signed Supabase Storage URLs of our project only', () => {
    const before = process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
    try {
      expect(parseStorageUrl(`https://proj.supabase.co/storage/v1/object/sign/client-documents/${USER}/1_%D0%BE%D1%82%D1%87%D1%91%D1%82.pdf?token=x`))
        .toEqual({ bucket: 'client-documents', path: `${USER}/1_отчёт.pdf` })
      expect(parseStorageUrl(`https://proj.supabase.co/storage/v1/object/public/documents/${USER}/a.pdf`))
        .toEqual({ bucket: 'documents', path: `${USER}/a.pdf` })
      expect(parseStorageUrl(`https://evil.example/storage/v1/object/public/documents/${USER}/a.pdf`)).toBeNull()
      expect(parseStorageUrl('http://169.254.169.254/latest/meta-data')).toBeNull()
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = before
    }
  })

  it('locates legacy rows and new rows', () => {
    expect(locationForDocument({ storage_bucket: 'client-documents', storage_path: `${USER}/a.pdf`, file_url: 'x' }))
      .toEqual({ bucket: 'client-documents', path: `${USER}/a.pdf` })
    expect(locationForDocument({ file_url: `${USER}/medical.csv` })).toEqual({ bucket: 'documents', path: `${USER}/medical.csv` })
    expect(locationForDocument({ file_url: '../etc/passwd' })).toBeNull()
  })

  it('rejects control characters and empty segments in paths', () => {
    expect(checkUploadLocation(USER, 'client-documents', `${USER}/a\u0000.pdf`).ok).toBe(false)
    expect(checkUploadLocation(USER, 'client-documents', `${USER}//a.pdf`).ok).toBe(false)
    expect(checkUploadLocation(USER, 'client-documents', `${USER}/a.pdf`).ok).toBe(true)
  })

  it('sanitises display names', () => {
    expect(sanitizeFileName('..\\..\\evil\u0007.pdf', 'u/x.pdf')).toBe('evil.pdf')
    expect(sanitizeFileName('', `${USER}/abc.csv`)).toBe('abc.csv')
    expect(sanitizeFileName(`${'я'.repeat(300)}.xlsx`, 'u/x').length).toBeLessThanOrEqual(255)
  })
})
