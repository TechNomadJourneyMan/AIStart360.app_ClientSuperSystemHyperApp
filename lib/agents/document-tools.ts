/**
 * Agent tools over public.documents (document_intelligence, document_reaper).
 *
 * Company-scoped tools resolve the document with `company_id = ctx.companyId`
 * — the task's company, never an argument — so a task bound to company A can
 * neither read nor write a document of company B. Writes additionally require
 * that the task holds the processing claim (documents.processing_task_id).
 *
 * Bytes come from `documentStorage()` (Supabase service role in production,
 * an injected backend in tests), capped at DOCUMENT_MAX_BYTES, and only from
 * inside the uploader's own folder.
 */
import { z } from 'zod'
import { enqueueAgentTask } from './queue'
import { registerTool, type ToolContext } from './tools'
import { AgentError } from './types'
import { documentMaxBytes } from '@/lib/documents/preflight'
import {
  claimDocument,
  failStuck,
  findStuckDocuments,
  finishDocument,
  getCompanyDocument,
  getDocument,
  requeueStuck,
  setSecurity,
  setStage,
  type DocumentRow,
  type StuckDocument,
} from '@/lib/documents/repository'
import { documentStorage, isInOwnerFolder, locationForDocument, StorageError, type StorageLocation } from '@/lib/documents/storage'

function companyOf(ctx: ToolContext): string {
  if (!ctx.companyId) throw new AgentError('NO_COMPANY', 'инструмент требует задачу, привязанную к компании')
  return ctx.companyId
}

const documentId = z.string().uuid()

// ─── documents.load ─────────────────────────────────────────────────────────

export interface LoadedDocument {
  document: DocumentRow
  location: StorageLocation
  buffer: Buffer
}

export const loadDocumentTool = registerTool({
  name: 'documents.load',
  description: 'Строка документа компании задачи и его байты из хранилища (с ограничением размера).',
  permission: 'READ_FILES',
  companyScoped: true,
  args: z.object({ document_id: documentId }).strict(),
  async handler(ctx, args): Promise<LoadedDocument> {
    const document = await getCompanyDocument(args.document_id, companyOf(ctx))
    if (!document) throw new AgentError('DOCUMENT_NOT_FOUND', 'документ не найден в компании задачи')
    const location = locationForDocument(document)
    if (!location) throw new AgentError('NO_STORAGE_LOCATION', 'у документа нет пути в хранилище')
    if (!isInOwnerFolder(location, document.user_id)) {
      throw new AgentError('FOREIGN_PATH', 'файл документа находится вне папки владельца')
    }
    let buffer: Buffer
    try {
      buffer = await documentStorage().download(location, { maxBytes: documentMaxBytes() })
    } catch (err) {
      if (err instanceof StorageError) {
        if (err.code === 'NOT_FOUND') throw new AgentError('FILE_MISSING', 'файл не найден в хранилище')
        if (err.code === 'TOO_LARGE') throw new AgentError('TOO_LARGE', 'файл больше допустимого размера')
        throw new AgentError('STORAGE_UNAVAILABLE', `хранилище недоступно: ${err.message}`, true)
      }
      throw new AgentError('STORAGE_UNAVAILABLE', 'ошибка загрузки файла', true)
    }
    ctx.source({ type: 'document', ref: document.id })
    return { document, location, buffer }
  },
  summarize: (r: LoadedDocument) => `документ ${r.document.id.slice(0, 8)}…, ${Math.ceil(r.buffer.length / 1024)} КБ`,
})

// ─── documents.update_status ────────────────────────────────────────────────

const statusArgs = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim'), document_id: documentId }).strict(),
  z.object({
    action: z.literal('stage'),
    document_id: documentId,
    stage: z.enum(['parsing', 'extracting', 'binding']),
  }).strict(),
  z.object({
    action: z.literal('security'),
    document_id: documentId,
    security_status: z.enum(['clean', 'rejected']),
    security_reason: z.string().max(1000).nullable(),
    sniffed_mime: z.string().max(200).nullable(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    size_bytes: z.number().int().min(0).nullable(),
  }).strict(),
  z.object({
    action: z.literal('finish'),
    document_id: documentId,
    parse_status: z.enum(['error', 'rejected']),
    error_code: z.string().min(1).max(80),
    error_message: z.string().min(1).max(2000),
  }).strict(),
  z.object({
    action: z.literal('release'),
    document_id: documentId,
    error_code: z.string().min(1).max(80),
    error_message: z.string().min(1).max(2000),
  }).strict(),
])

export type StatusArgs = z.infer<typeof statusArgs>
export type StatusResult =
  | { action: 'claim'; claimed: true; document: DocumentRow }
  | { action: 'claim'; claimed: false; reason: 'not_found' | 'busy_or_done'; parse_status: string | null }
  | { action: Exclude<StatusArgs['action'], 'claim'>; ok: boolean }

export const updateStatusTool = registerTool({
  name: 'documents.update_status',
  description: 'Захват документа для обработки, смена стадии, вердикт безопасности, ошибка или возврат в очередь.',
  permission: 'PROCESS_FILES',
  companyScoped: true,
  args: statusArgs,
  async handler(ctx, args): Promise<StatusResult> {
    const companyId = companyOf(ctx)
    const ids = { id: args.document_id, companyId, taskId: ctx.taskId }
    switch (args.action) {
      case 'claim': {
        const document = await claimDocument(ids)
        if (document) return { action: 'claim', claimed: true, document }
        const current = await getCompanyDocument(args.document_id, companyId)
        return { action: 'claim', claimed: false, reason: current ? 'busy_or_done' : 'not_found', parse_status: current?.parse_status ?? null }
      }
      case 'stage':
        return { action: 'stage', ok: await setStage({ ...ids, stage: args.stage }) }
      case 'security':
        return {
          action: 'security',
          ok: await setSecurity({
            ...ids,
            status: args.security_status,
            reason: args.security_reason,
            sniffedMime: args.sniffed_mime,
            sha256: args.sha256,
            sizeBytes: args.size_bytes,
          }),
        }
      case 'finish':
        return {
          action: 'finish',
          ok: await finishDocument({
            ...ids, parseStatus: args.parse_status, stage: 'failed', errorCode: args.error_code, errorMessage: args.error_message,
          }),
        }
      case 'release':
        return {
          action: 'release',
          ok: await finishDocument({
            ...ids, parseStatus: 'queued', stage: 'validated', errorCode: args.error_code, errorMessage: args.error_message,
          }),
        }
    }
  },
  summarize: (r: StatusResult) => ('claimed' in r ? (r.claimed ? 'документ захвачен' : `не захвачен: ${r.reason}`) : `${r.action}: ${r.ok ? 'ok' : 'нет захвата'}`),
})

// ─── documents.save_extraction ──────────────────────────────────────────────

const payloadShape = z.object({
  summary: z.string(),
  fields: z.array(z.record(z.unknown())),
  raw_text_preview: z.string(),
  extracted_at: z.string(),
  model_used: z.string(),
}).passthrough()

export const saveExtractionTool = registerTool({
  name: 'documents.save_extraction',
  description: 'Сохранить результат извлечения (parsed_data с провенансом) — значения затем используются метриками.',
  permission: 'UPDATE_METRICS',
  companyScoped: true,
  args: z.object({
    document_id: documentId,
    parse_status: z.enum(['parsed', 'needs_ocr']),
    extraction_version: z.string().min(1).max(120),
    /** JSON of ParsedDataPayload; hashed in the tool-call log, never stored there in clear. */
    payload_json: z.string().min(2).max(8_000_000),
    message: z.string().max(2000).nullable(),
  }).strict(),
  redact: ['payload_json'],
  async handler(ctx, args): Promise<{ saved: boolean; fields: number }> {
    let payload: Record<string, unknown>
    try {
      payload = payloadShape.parse(JSON.parse(args.payload_json))
    } catch {
      throw new AgentError('INVALID_PAYLOAD', 'результат извлечения не прошёл проверку схемы')
    }
    const saved = await finishDocument({
      id: args.document_id,
      companyId: companyOf(ctx),
      taskId: ctx.taskId,
      parseStatus: args.parse_status,
      stage: 'done',
      parsedData: payload,
      extractionVersion: args.extraction_version,
      errorCode: args.parse_status === 'needs_ocr' ? 'NEEDS_OCR' : null,
      errorMessage: args.parse_status === 'needs_ocr' ? args.message : null,
    })
    return { saved, fields: Array.isArray(payload.fields) ? payload.fields.length : 0 }
  },
  summarize: (r: { saved: boolean; fields: number }) => (r.saved ? `сохранено, полей: ${r.fields}` : 'не сохранено: захват потерян'),
})

// ─── Reaper tools (platform scope) ──────────────────────────────────────────

export const findStuckTool = registerTool({
  name: 'documents.find_stuck',
  description: 'Документы, застрявшие в обработке или очереди дольше порога, без живой задачи агента.',
  permission: 'READ_FILES',
  companyScoped: false,
  args: z.object({ stale_minutes: z.number().int().min(5).max(24 * 60), limit: z.number().int().min(1).max(200) }).strict(),
  async handler(ctx, args): Promise<StuckDocument[]> {
    const rows = await findStuckDocuments(args.stale_minutes, args.limit)
    for (const r of rows) ctx.source({ type: 'document', ref: r.id })
    return rows
  },
  summarize: (rows: StuckDocument[]) => `найдено: ${rows.length}`,
})

export const requeueTool = registerTool({
  name: 'documents.requeue',
  description: 'Вернуть застрявший документ в очередь и поставить задачу document_intelligence (или завершить с ошибкой после лимита попыток).',
  permission: 'PROCESS_FILES',
  companyScoped: false,
  args: z.object({
    document_id: documentId,
    seen_updated_at: z.string().datetime({ offset: true }),
    give_up: z.boolean(),
  }).strict(),
  async handler(ctx, args): Promise<{ requeued: boolean; failed: boolean; task_id: string | null }> {
    const seen = new Date(args.seen_updated_at)
    if (args.give_up) {
      const failed = await failStuck(args.document_id, seen,
        'Документ несколько раз не удалось обработать. Загрузите файл заново или обратитесь к эксперту.')
      return { requeued: false, failed, task_id: null }
    }
    const doc = await getDocument(args.document_id)
    if (!doc?.company_id) return { requeued: false, failed: false, task_id: null }
    const ok = await requeueStuck(args.document_id, seen)
    if (!ok) return { requeued: false, failed: false, task_id: null }
    const task = await enqueueAgentTask({
      agentKey: 'document_intelligence',
      companyId: doc.company_id,
      parentTaskId: ctx.taskId,
      trigger: 'agent',
      triggerRef: 'document_reaper',
      requestedBy: `agent:${ctx.agentKey}`,
      input: { document_id: doc.id },
      idempotencyKey: `doc_reap:${doc.id}:${doc.attempts}:${seen.getTime()}`,
    })
    return { requeued: true, failed: false, task_id: task.id }
  },
  summarize: (r: { requeued: boolean; failed: boolean }) => (r.failed ? 'завершён с ошибкой' : r.requeued ? 'в очереди' : 'без изменений'),
})
