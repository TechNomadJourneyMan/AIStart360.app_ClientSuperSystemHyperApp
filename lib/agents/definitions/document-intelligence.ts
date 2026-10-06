/**
 * document_intelligence — turns an uploaded document into verified facts.
 *
 * Trigger: FILE_UPLOADED (from POST /api/v1/documents finalize) or a manual
 * task { document_id } (POST /api/v1/onboarding/documents/[id]/process,
 * document_reaper).
 *
 *   claim (documents.processing_task_id)        stage parsing
 *   load bytes (service role, size-capped)      READ_FILES
 *   preflight again + sha256 must match         (file swapped after upload → rejected)
 *   text → extraction → binding                 lib/documents/pipeline.ts
 *     model calls via ctx.llmJson only          CALL_LLM, budgets, fenced text
 *   save parsed_data with provenance            UPDATE_METRICS     stage done
 *   FILE_PROCESSED (dedupe file_processed:<id>:<attempt>)
 *
 * Outcomes on the document:
 *   parsed      ≥1 field or row — or zero, with parsed_data.empty_reason
 *   needs_ocr   scan without text layer and OCR unavailable / unreadable
 *   rejected    failed the security preflight (or changed after upload)
 *   error       unreadable / missing file, or retries exhausted
 *   queued      transient failure (storage / model) — the task retries
 */
import { z } from 'zod'
import { hasLlmKey } from '@/lib/ai/gateway'
import { emitPlatformEvent } from '@/lib/events/platform'
import { EXTRACTION_PROMPT_VERSION, EXTRACTION_VERSION, type LlmJsonFn } from '@/lib/documents/extraction'
import { sha256Hex } from '@/lib/documents/finalize'
import { runDocumentPipeline } from '@/lib/documents/pipeline'
import { fileExtension, preflightDocument } from '@/lib/documents/preflight'
import { isUuid } from '@/lib/documents/repository'
import { DocumentParseError } from '@/lib/documents/text'
import { loadDocumentTool, saveExtractionTool, updateStatusTool, type LoadedDocument, type StatusResult } from '../document-tools'
import { AgentError, type AgentContext, type AgentDefinition } from '../types'

/** Leave room inside a 300 s serverless invocation for saving and bookkeeping. */
const RUN_DEADLINE_MS = 230_000

const LIMITS = {
  maxAttempts: 3,
  leaseSeconds: 360,
  /** RUN_DEADLINE_MS plus saving and bookkeeping (lib/agents/queue.ts drainQueue). */
  maxRunSeconds: 270,
  perRunBudgetUsd: 0.75,
  dailyBudgetUsd: 15,
  maxLlmCalls: 12,
  maxOutputTokens: 4_000,
}

const inputSchema = z.object({
  document_id: z.string().optional(),
  event: z.object({
    id: z.number().optional(),
    name: z.string().optional(),
    subject_type: z.string().nullish(),
    subject_id: z.string().nullish(),
    payload: z.record(z.unknown()).nullish(),
  }).optional(),
}).passthrough()

type Input = z.infer<typeof inputSchema>

export function documentIdFromInput(input: Input): string | null {
  const candidates = [
    input.document_id,
    input.event?.subject_type === 'document' ? input.event.subject_id : null,
    typeof input.event?.payload?.document_id === 'string' ? input.event.payload.document_id : null,
  ]
  return candidates.find((c): c is string => isUuid(c)) ?? null
}

const STOP_CODES = new Set(['BUDGET_EXCEEDED', 'LLM_CALL_LIMIT', 'PERMISSION_DENIED'])

/** ctx.llmJson, with budget / permission stops reported as results, not thrown. */
function agentLlm(ctx: AgentContext): LlmJsonFn {
  return async (req) => {
    try {
      return await ctx.llmJson(req)
    } catch (err) {
      if (err instanceof AgentError && STOP_CODES.has(err.code)) {
        await ctx.log('warn', 'llm.stopped', `${err.code}: ${err.message}`)
        return { ok: false, error: err.code as 'BUDGET_EXCEEDED', message: err.message, usage: null }
      }
      throw err
    }
  }
}

export const documentIntelligenceAgent: AgentDefinition<Input> = {
  key: 'document_intelligence',
  name: 'Document Intelligence Agent',
  description: 'Проверяет загруженный документ, извлекает показатели с цитатами и источником и связывает их с метриками.',
  version: '1.0.0',
  scope: 'company',
  tier: 'standard',
  promptVersion: EXTRACTION_PROMPT_VERSION,
  permissions: { READ_FILES: 'ALLOW', PROCESS_FILES: 'ALLOW', CALL_LLM: 'ALLOW', UPDATE_METRICS: 'ALLOW' },
  tools: [loadDocumentTool.name, updateStatusTool.name, saveExtractionTool.name],
  triggers: { events: ['FILE_UPLOADED'] },
  limits: LIMITS,
  inputSchema: inputSchema as unknown as z.ZodType<Input>,

  async run(ctx, input) {
    const documentId = documentIdFromInput(input)
    if (!documentId) throw new AgentError('INVALID_INPUT', 'в задаче не указан документ')
    const deadlineAt = Date.now() + RUN_DEADLINE_MS
    const lastAttempt = ctx.attempt >= LIMITS.maxAttempts

    const claim = await ctx.tool<StatusResult>('documents.update_status', { action: 'claim', document_id: documentId })
    if (!('claimed' in claim) || !claim.claimed) {
      const reason = 'claimed' in claim && !claim.claimed ? claim.reason : 'busy_or_done'
      if (reason === 'not_found') throw new AgentError('DOCUMENT_NOT_FOUND', 'документ не найден в компании задачи')
      return {
        summary: 'документ уже обработан или обрабатывается другим запуском',
        result: { document_id: documentId, skipped: true, parse_status: 'claimed' in claim && !claim.claimed ? claim.parse_status : null },
      }
    }
    const processingRun = claim.document.attempts

    const status = (args: Record<string, unknown>) =>
      ctx.tool<StatusResult>('documents.update_status', { document_id: documentId, ...args })
    const fail = (code: string, message: string, parseStatus: 'error' | 'rejected' = 'error') =>
      status({ action: 'finish', parse_status: parseStatus, error_code: code, error_message: message })
    const release = (code: string, message: string) => status({ action: 'release', error_code: code, error_message: message })

    try {
      const loaded = await ctx.tool<LoadedDocument>('documents.load', { document_id: documentId })
      const doc = loaded.document

      // Re-check the bytes: legacy rows were never checked, and an object can
      // be replaced in storage after finalize.
      const nameForType = fileExtension(doc.file_name) ? doc.file_name : loaded.location.path
      const check = preflightDocument(loaded.buffer, nameForType)
      const sha256 = sha256Hex(loaded.buffer)
      if (!check.ok || (doc.sha256 && doc.sha256 !== sha256)) {
        const reason = !check.ok ? check.reason : 'Файл в хранилище изменён после загрузки — он не будет обработан.'
        const code = !check.ok ? check.code : 'FILE_CHANGED'
        await status({
          action: 'security', security_status: 'rejected', security_reason: reason,
          sniffed_mime: check.mime, sha256: doc.sha256 ? null : sha256, size_bytes: loaded.buffer.length,
        })
        await fail(code, reason, 'rejected')
        throw new AgentError('FILE_REJECTED', reason)
      }
      if (doc.security_status !== 'clean') {
        await status({
          action: 'security', security_status: 'clean', security_reason: null,
          sniffed_mime: check.mime, sha256, size_bytes: loaded.buffer.length,
        })
      }

      const outcome = await runDocumentPipeline({
        documentId,
        docType: doc.doc_type,
        fileName: doc.file_name,
        buffer: loaded.buffer,
        kind: check.kind,
        mime: check.mime,
        preflightFlags: check.flags,
        llm: hasLlmKey() ? agentLlm(ctx) : null,
        aiBudgetLeft: () => ctx.spentUsd() < LIMITS.perRunBudgetUsd * 0.85,
        deadlineAt,
        retryOnTransientLlm: !lastAttempt,
        onStage: async (stage) => {
          await status({ action: 'stage', stage })
        },
      })

      if (outcome.status === 'retry') {
        await release(outcome.code, 'Модель временно недоступна — обработка будет повторена автоматически.')
        throw new AgentError(outcome.code, outcome.message, true)
      }

      const save = await ctx.tool<{ saved: boolean; fields: number }>('documents.save_extraction', {
        document_id: documentId,
        parse_status: outcome.status,
        extraction_version: EXTRACTION_VERSION,
        payload_json: JSON.stringify({ ...outcome.payload, task_id: ctx.taskId, run_id: ctx.runId }),
        message: outcome.status === 'needs_ocr' ? outcome.message : null,
      })
      if (!save.saved) {
        return { summary: 'результат не сохранён: документ удалён или перехвачен другим запуском', result: { document_id: documentId, saved: false } }
      }

      if (outcome.status === 'needs_ocr') {
        await ctx.log('info', 'document.needs_ocr', 'скан без текстового слоя — нужен OCR')
        return { summary: 'скан без текстового слоя: нужен OCR', result: { document_id: documentId, parse_status: 'needs_ocr' } }
      }

      const stats = outcome.payload.stats as { bound_count?: number } | undefined
      try {
        await emitPlatformEvent({
          name: 'FILE_PROCESSED',
          companyId: ctx.companyId,
          subjectType: 'document',
          subjectId: documentId,
          actor: `agent:${ctx.agentKey}`,
          payload: {
            document_id: documentId,
            parse_status: 'parsed',
            field_count: outcome.fieldCount,
            row_count: outcome.rowCount,
            bound_count: stats?.bound_count ?? 0,
            empty_reason: outcome.payload.empty_reason?.code ?? null,
            extraction_version: EXTRACTION_VERSION,
            processing_run: processingRun,
          },
          dedupeKey: `file_processed:${documentId}:${processingRun}`,
        })
      } catch (err) {
        // Raw DB text only in the server log: agent events are tenant-readable.
        console.error(`[agents] document ${documentId}: FILE_PROCESSED emit failed`, err instanceof Error ? err.message : err)
        await ctx.log('warn', 'event.failed', 'FILE_PROCESSED не записано')
      }

      const summary = outcome.payload.empty_reason
        ? `обработан без показателей: ${outcome.payload.empty_reason.message}`
        : `обработан: показателей ${outcome.fieldCount} (с метриками ${stats?.bound_count ?? 0}), строк ${outcome.rowCount}`
      return {
        summary,
        result: {
          document_id: documentId,
          parse_status: 'parsed',
          field_count: outcome.fieldCount,
          row_count: outcome.rowCount,
          models: outcome.models,
          empty_reason: outcome.payload.empty_reason?.code ?? null,
        },
      }
    } catch (err) {
      await settleFailure(err, { fail, release, lastAttempt })
      throw err instanceof DocumentParseError ? new AgentError('PARSE_FAILED', err.message) : err
    }
  },
}

/** Leave the document in an honest state for whatever the runner does next. */
async function settleFailure(
  err: unknown,
  h: {
    fail: (code: string, message: string) => Promise<StatusResult>
    release: (code: string, message: string) => Promise<StatusResult>
    lastAttempt: boolean
  },
): Promise<void> {
  try {
    if (err instanceof DocumentParseError) {
      await h.fail('PARSE_FAILED', `Не удалось прочитать файл: ${err.message}`)
      return
    }
    if (err instanceof AgentError) {
      if (err.code === 'FILE_REJECTED') return // already recorded
      const message = USER_MESSAGES[err.code] ?? `Ошибка обработки (${err.code}).`
      if (err.retryable && !h.lastAttempt) await h.release(err.code, `${message} Повторим автоматически.`)
      else await h.fail(err.code, message)
      return
    }
    // Unexpected errors are retried by the runner.
    if (h.lastAttempt) await h.fail('UNEXPECTED', 'Внутренняя ошибка обработки. Попробуйте обработать документ ещё раз позже.')
    else await h.release('UNEXPECTED', 'Внутренняя ошибка обработки — повторим автоматически.')
  } catch {
    // The document stays claimed; document_reaper recovers it after STALE_MINUTES.
  }
}

const USER_MESSAGES: Record<string, string> = {
  FILE_MISSING: 'Файл не найден в хранилище — загрузите его заново.',
  TOO_LARGE: 'Файл больше допустимого размера.',
  FOREIGN_PATH: 'Файл находится вне папки владельца и не может быть обработан.',
  NO_STORAGE_LOCATION: 'У документа нет файла в хранилище — загрузите его заново.',
  STORAGE_UNAVAILABLE: 'Хранилище файлов временно недоступно.',
  LLM_UNAVAILABLE: 'Модель временно недоступна.',
  DOCUMENT_NOT_FOUND: 'Документ не найден.',
}
