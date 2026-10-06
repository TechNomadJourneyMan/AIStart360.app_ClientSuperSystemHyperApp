/**
 * lib/documents/repository.ts — server-side persistence of public.documents.
 *
 * Uses the server's direct Postgres connection (Prisma, the same privileges as
 * the service role, like lib/agents/store.ts): the guard trigger of migration
 * 089 lets only the server write pipeline columns. Callers authorise first.
 *
 * Processing ownership: a run "claims" a document by writing its agent task id
 * into processing_task_id; stage updates and the final save only apply while
 * that task still holds the claim, so two runs can never interleave writes.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export type ParseStatus = 'queued' | 'processing' | 'parsed' | 'completed' | 'error' | 'needs_ocr' | 'rejected'
export type ProcessingStage = 'uploaded' | 'validated' | 'parsing' | 'extracting' | 'binding' | 'done' | 'failed'
export type SecurityStatus = 'pending' | 'clean' | 'rejected'

export interface DocumentRow {
  id: string
  user_id: string
  company_id: string | null
  session_id: string | null
  file_name: string
  file_url: string
  file_size: number | null
  mime_type: string | null
  doc_type: string
  period_quarter: string | null
  period_year: number | null
  parse_status: ParseStatus
  parsed_data: Record<string, unknown> | null
  parse_error: string | null
  uploaded_at: Date
  storage_bucket: string | null
  storage_path: string | null
  size_bytes: number | null
  sha256: string | null
  sniffed_mime: string | null
  security_status: SecurityStatus
  security_reason: string | null
  processing_stage: ProcessingStage | null
  attempts: number
  last_error_code: string | null
  processed_at: Date | null
  updated_at: Date
  extraction_version: string | null
  processing_task_id: string | null
}

const COLUMNS = Prisma.sql`id, user_id::text AS user_id, company_id, session_id::text AS session_id, file_name, file_url,
  file_size, mime_type, doc_type, period_quarter, period_year, parse_status, parsed_data, parse_error, uploaded_at,
  storage_bucket, storage_path, size_bytes::float8 AS size_bytes, sha256, sniffed_mime, security_status,
  security_reason, processing_stage, attempts::int AS attempts, last_error_code, processed_at, updated_at,
  extraction_version, processing_task_id::text AS processing_task_id`

const IN_FLIGHT: ProcessingStage[] = ['parsing', 'extracting', 'binding']

/** Minutes after which an in-flight document is considered abandoned. */
export const STALE_MINUTES = 30

export async function getDocument(id: string): Promise<DocumentRow | null> {
  if (!isUuid(id)) return null
  const rows = await prisma.$queryRaw<DocumentRow[]>`SELECT ${COLUMNS} FROM public.documents WHERE id = ${id}::uuid`
  return rows[0] ?? null
}

/** A document of exactly this company (the tenant binding of agent tools). */
export async function getCompanyDocument(id: string, companyId: string): Promise<DocumentRow | null> {
  if (!isUuid(id)) return null
  const rows = await prisma.$queryRaw<DocumentRow[]>`
    SELECT ${COLUMNS} FROM public.documents WHERE id = ${id}::uuid AND company_id = ${companyId}`
  return rows[0] ?? null
}

export function dedupeScope(companyId: string | null, userId: string): string {
  return companyId ? `c:${companyId}` : `u:${userId}`
}

export async function findDuplicate(args: { companyId: string | null; userId: string; sha256: string }): Promise<DocumentRow | null> {
  const scope = dedupeScope(args.companyId, args.userId)
  const rows = await prisma.$queryRaw<DocumentRow[]>`
    SELECT ${COLUMNS} FROM public.documents
    WHERE coalesce('c:' || company_id, 'u:' || user_id::text) = ${scope}
      AND sha256 = ${args.sha256} AND security_status <> 'rejected'
    ORDER BY uploaded_at LIMIT 1`
  return rows[0] ?? null
}

export interface InsertDocumentInput {
  userId: string
  companyId: string | null
  fileName: string
  fileUrl: string
  mimeType: string | null
  docType: string
  periodQuarter: string | null
  periodYear: number | null
  storageBucket: string
  storagePath: string
  sizeBytes: number | null
  sha256: string | null
  sniffedMime: string | null
  securityStatus: SecurityStatus
  securityReason: string | null
  parseStatus: ParseStatus
  processingStage: ProcessingStage
  lastErrorCode: string | null
  parseError: string | null
}

export class DuplicateDocumentError extends Error {
  constructor() {
    super('duplicate document')
    this.name = 'DuplicateDocumentError'
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = err.meta as { code?: string } | undefined
    return err.code === 'P2002' || meta?.code === '23505' || /23505|unique/i.test(err.message)
  }
  return false
}

export async function insertDocument(d: InsertDocumentInput): Promise<DocumentRow> {
  try {
    const rows = await prisma.$queryRaw<DocumentRow[]>`
      INSERT INTO public.documents
        (user_id, company_id, file_name, file_url, file_size, mime_type, doc_type, period_quarter, period_year,
         storage_bucket, storage_path, size_bytes, sha256, sniffed_mime, security_status, security_reason,
         parse_status, processing_stage, last_error_code, parse_error)
      VALUES (${d.userId}::uuid, ${d.companyId}, ${d.fileName}, ${d.fileUrl},
              ${d.sizeBytes == null ? null : Math.min(d.sizeBytes, 2_147_483_647)}::int, ${d.mimeType}, ${d.docType},
              ${d.periodQuarter}, ${d.periodYear}::int, ${d.storageBucket}, ${d.storagePath},
              ${d.sizeBytes == null ? null : String(d.sizeBytes)}::bigint, ${d.sha256}, ${d.sniffedMime},
              ${d.securityStatus}, ${d.securityReason}, ${d.parseStatus}, ${d.processingStage},
              ${d.lastErrorCode}, ${d.parseError})
      RETURNING ${COLUMNS}`
    return rows[0]
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateDocumentError()
    throw err
  }
}

/**
 * Take the document for processing by `taskId`. Succeeds when it is queued,
 * already held by the same task (a retry of the run), or abandoned in flight.
 * Rejected documents are never processed.
 */
export async function claimDocument(args: { id: string; companyId: string; taskId: string }): Promise<DocumentRow | null> {
  const rows = await prisma.$queryRaw<DocumentRow[]>`
    UPDATE public.documents SET
      parse_status = 'processing', processing_stage = 'parsing', attempts = attempts + 1,
      processing_task_id = ${args.taskId}::uuid, parse_error = NULL, last_error_code = NULL
    WHERE id = ${args.id}::uuid AND company_id = ${args.companyId}
      AND security_status <> 'rejected' AND parse_status <> 'rejected'
      AND (
        parse_status = 'queued'
        OR processing_task_id = ${args.taskId}::uuid
        OR (processing_stage IN ('parsing', 'extracting', 'binding')
            AND updated_at < now() - make_interval(mins => ${STALE_MINUTES}::int))
      )
    RETURNING ${COLUMNS}`
  return rows[0] ?? null
}

/** Advance the stage while `taskId` holds the document. False = claim lost / deleted. */
export async function setStage(args: { id: string; companyId: string; taskId: string; stage: ProcessingStage }): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE public.documents SET processing_stage = ${args.stage}
    WHERE id = ${args.id}::uuid AND company_id = ${args.companyId} AND processing_task_id = ${args.taskId}::uuid`
  return n > 0
}

/** Record the security verdict measured during processing (legacy rows, re-verification). */
export async function setSecurity(args: {
  id: string
  companyId: string
  taskId: string
  status: SecurityStatus
  reason: string | null
  sniffedMime: string | null
  sha256: string | null
  sizeBytes: number | null
}): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE public.documents SET
      security_status = ${args.status}, security_reason = ${args.reason},
      sniffed_mime = coalesce(${args.sniffedMime}, sniffed_mime),
      sha256 = coalesce(sha256, ${args.sha256}),
      size_bytes = coalesce(size_bytes, ${args.sizeBytes == null ? null : String(args.sizeBytes)}::bigint)
    WHERE id = ${args.id}::uuid AND company_id = ${args.companyId} AND processing_task_id = ${args.taskId}::uuid`
  return n > 0
}

export interface FinishInput {
  id: string
  companyId: string
  taskId: string
  parseStatus: Exclude<ParseStatus, 'processing' | 'completed'>
  stage: ProcessingStage
  parsedData?: Record<string, unknown> | null
  extractionVersion?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}

/** Terminal (or back-to-queue) write that releases the claim. */
export async function finishDocument(f: FinishInput): Promise<boolean> {
  const terminal = f.parseStatus !== 'queued'
  const n = f.parsedData !== undefined
    ? await prisma.$executeRaw`
        UPDATE public.documents SET
          parse_status = ${f.parseStatus}, processing_stage = ${f.stage},
          parsed_data = ${f.parsedData === null ? null : JSON.stringify(f.parsedData)}::jsonb,
          extraction_version = ${f.extractionVersion ?? null},
          parse_error = ${f.errorMessage ?? null}, last_error_code = ${f.errorCode ?? null},
          processed_at = CASE WHEN ${terminal} THEN now() ELSE processed_at END,
          processing_task_id = NULL
        WHERE id = ${f.id}::uuid AND company_id = ${f.companyId} AND processing_task_id = ${f.taskId}::uuid`
    : await prisma.$executeRaw`
        UPDATE public.documents SET
          parse_status = ${f.parseStatus}, processing_stage = ${f.stage},
          parse_error = ${f.errorMessage ?? null}, last_error_code = ${f.errorCode ?? null},
          processed_at = CASE WHEN ${terminal} THEN now() ELSE processed_at END,
          processing_task_id = NULL
        WHERE id = ${f.id}::uuid AND company_id = ${f.companyId} AND processing_task_id = ${f.taskId}::uuid`
  return n > 0
}

/** Manual reprocess: back to the queue (never for rejected files). */
export async function resetForReprocess(id: string): Promise<DocumentRow | null> {
  const rows = await prisma.$queryRaw<DocumentRow[]>`
    UPDATE public.documents SET
      parse_status = 'queued',
      processing_stage = CASE WHEN security_status = 'clean' THEN 'validated' ELSE 'uploaded' END,
      parse_error = NULL, last_error_code = NULL, processing_task_id = NULL
    WHERE id = ${id}::uuid AND parse_status <> 'rejected' AND security_status <> 'rejected'
    RETURNING ${COLUMNS}`
  return rows[0] ?? null
}

/**
 * Legacy rows were registered without a company. Attach the owner's company
 * (primary owner first, then an owner membership) so a company-scoped agent
 * can process them.
 */
export async function attachOwnerCompany(id: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ company_id: string | null }>>`
    UPDATE public.documents d SET company_id = coalesce(
      (SELECT c.id FROM public.companies c WHERE c.user_id = d.user_id ORDER BY c.id LIMIT 1),
      (SELECT m.company_id FROM public.company_members m
        WHERE m.user_id = d.user_id AND m.status = 'active' AND m.role = 'owner' ORDER BY m.company_id LIMIT 1)
    )
    WHERE d.id = ${id}::uuid AND d.company_id IS NULL
    RETURNING d.company_id`
  return rows[0]?.company_id ?? null
}

const DOC_TASK_MATCH = (id: string) => Prisma.sql`
  agent_key = 'document_intelligence'
  AND (input->>'document_id' = ${id} OR input->'event'->>'subject_id' = ${id})`

/** A queued / running / approval-parked processing task for the document. */
export async function liveTaskForDocument(id: string): Promise<{ id: string; status: string } | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id::text AS id, status FROM public.agent_tasks
    WHERE ${DOC_TASK_MATCH(id)} AND status IN ('queued', 'running', 'awaiting_approval')
    ORDER BY created_at DESC LIMIT 1`
  return rows[0] ?? null
}

export async function taskStatus(taskId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM public.agent_tasks WHERE id = ${taskId}::uuid`
  return rows[0]?.status ?? null
}

export interface StuckDocument {
  id: string
  company_id: string
  processing_stage: ProcessingStage
  attempts: number
  updated_at: Date
}

/**
 * Documents in flight (parsing/extracting/binding) or waiting in the queue
 * (validated/uploaded + queued) for longer than `staleMinutes` with no live
 * processing task.
 */
export async function findStuckDocuments(staleMinutes = STALE_MINUTES, limit = 50): Promise<StuckDocument[]> {
  return prisma.$queryRaw<StuckDocument[]>`
    SELECT d.id::text AS id, d.company_id, d.processing_stage, d.attempts::int AS attempts, d.updated_at
    FROM public.documents d
    WHERE d.company_id IS NOT NULL
      AND d.updated_at < now() - make_interval(mins => ${staleMinutes}::int)
      AND (
        d.processing_stage IN ('parsing', 'extracting', 'binding')
        OR (d.processing_stage IN ('validated', 'uploaded') AND d.parse_status = 'queued')
      )
      AND d.security_status <> 'rejected'
      AND NOT EXISTS (
        SELECT 1 FROM public.agent_tasks t
        WHERE t.agent_key = 'document_intelligence'
          AND t.status IN ('queued', 'running', 'awaiting_approval')
          AND (t.input->>'document_id' = d.id::text OR t.input->'event'->>'subject_id' = d.id::text)
      )
    ORDER BY d.updated_at
    LIMIT ${limit}`
}

/** Compare-and-set requeue of a stuck document (only if unchanged since it was found). */
export async function requeueStuck(id: string, seenUpdatedAt: Date): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE public.documents SET parse_status = 'queued', processing_stage = CASE
        WHEN security_status = 'clean' THEN 'validated' ELSE 'uploaded' END,
      processing_task_id = NULL, last_error_code = 'REAPED',
      parse_error = 'Обработка прервалась — документ поставлен в очередь повторно.'
    WHERE id = ${id}::uuid AND date_trunc('milliseconds', updated_at) = ${seenUpdatedAt}::timestamptz`
  return n > 0
}

/** Give up on a document that keeps getting stuck. */
export async function failStuck(id: string, seenUpdatedAt: Date, message: string): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE public.documents SET parse_status = 'error', processing_stage = 'failed',
      processing_task_id = NULL, last_error_code = 'MAX_ATTEMPTS', parse_error = ${message}, processed_at = now()
    WHERE id = ${id}::uuid AND date_trunc('milliseconds', updated_at) = ${seenUpdatedAt}::timestamptz`
  return n > 0
}

/** Rebind writes a new field binding into parsed_data (service-side, after authz). */
export async function saveParsedData(id: string, parsedData: Record<string, unknown>): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE public.documents SET parsed_data = ${JSON.stringify(parsedData)}::jsonb WHERE id = ${id}::uuid`
  return n > 0
}

/**
 * Delete a document and everything derived from it: RAG summaries (their
 * chunks cascade) and pending processing tasks. The storage object is removed
 * by the caller (it needs the storage backend).
 */
export async function deleteDocumentCascade(id: string): Promise<{ deleted: boolean; summaries: number; tasksCancelled: number }> {
  return prisma.$transaction(async (tx) => {
    const summaries = await tx.$executeRaw`
      DELETE FROM public.document_summaries WHERE metadata->>'source_document_id' = ${id}`
    const tasksCancelled = await tx.$executeRaw`
      UPDATE public.agent_tasks SET status = 'cancelled', finished_at = now(), last_error_code = 'DOCUMENT_DELETED'
      WHERE ${DOC_TASK_MATCH(id)} AND status IN ('queued', 'awaiting_approval')`
    const deleted = await tx.$executeRaw`DELETE FROM public.documents WHERE id = ${id}::uuid`
    return { deleted: deleted > 0, summaries, tasksCancelled }
  })
}

/** Other rows pointing at the same object (dedupe never shares, but legacy data might). */
export async function countRowsForLocation(bucket: string, path: string, exceptId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM public.documents
    WHERE storage_bucket = ${bucket} AND storage_path = ${path} AND id <> ${exceptId}::uuid`
  return rows[0]?.n ?? 0
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
