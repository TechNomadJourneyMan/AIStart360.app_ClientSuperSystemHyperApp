/**
 * lib/documents/status-view.ts — how a documents row is shown to the client.
 *
 * Pure and browser-safe: maps exactly what the server reports (parse_status,
 * processing_stage, security_*, parsed_data markers) to a Russian label, a
 * tone and a detail line. It never invents progress: in-flight documents show
 * the stage the pipeline last wrote, nothing else.
 */

export type ClientParseStatus =
  | 'queued' | 'processing' | 'parsed' | 'completed' | 'error' | 'needs_ocr' | 'rejected'
export type ClientProcessingStage =
  | 'uploaded' | 'validated' | 'parsing' | 'extracting' | 'binding' | 'done' | 'failed'

/** The columns of public.documents the client UI reads (GET /api/v1/onboarding/documents). */
export interface ClientDocument {
  id: string
  file_name: string
  doc_type: string
  file_size?: number | null
  size_bytes?: number | null
  mime_type?: string | null
  sniffed_mime?: string | null
  period_quarter?: string | null
  period_year?: number | null
  parse_status?: ClientParseStatus | string | null
  processing_stage?: ClientProcessingStage | string | null
  security_status?: 'pending' | 'clean' | 'rejected' | string | null
  security_reason?: string | null
  last_error_code?: string | null
  parse_error?: string | null
  attempts?: number | null
  processed_at?: string | null
  uploaded_at?: string | null
  updated_at?: string | null
  storage_bucket?: string | null
  storage_path?: string | null
  file_url?: string | null
  parsed_data?: Record<string, unknown> | null
}

export type DocumentTone = 'neutral' | 'progress' | 'success' | 'warning' | 'error'

export interface DocumentStatusView {
  /** Full status line. */
  label: string
  /** Compact chip text (lists, toolbars). */
  short: string
  tone: DocumentTone
  /** Material Symbols icon name. */
  icon: string
  /** Server-provided explanation (error text, empty reason, counts), if any. */
  detail: string | null
  stage: ClientProcessingStage | null
  stageLabel: string | null
  /** queued or processing — the list should be polled. */
  inFlight: boolean
  /** Queued longer than the server's stale threshold without starting. */
  stalled: boolean
  /** POST …/process is allowed (not rejected, not running). */
  canReprocess: boolean
  /** parsed_data.warnings */
  warnings: string[]
  fieldCount: number | null
  rowCount: number | null
  unverifiedCount: number
  /** parsed_data.coverage.partial — only part of the document was analysed. */
  partial: boolean
  /** parsed_data.empty_reason.code when the document was read but nothing usable was found. */
  emptyReasonCode: string | null
}

export const STAGE_LABELS: Record<ClientProcessingStage, string> = {
  uploaded: 'Загружен',
  validated: 'Проверен',
  parsing: 'Чтение',
  extracting: 'Извлечение данных',
  binding: 'Привязка к метрикам',
  done: 'Готово',
  failed: 'Ошибка',
}

/** Steps shown in the progress line of an in-flight document (server stages, in order). */
export const PIPELINE_STEPS: readonly ClientProcessingStage[] = ['validated', 'parsing', 'extracting', 'binding', 'done']

/** Same threshold as lib/documents/repository.ts STALE_MINUTES (the reaper requeues after it). */
export const STALE_QUEUE_MINUTES = 30

export const NEEDS_OCR_LABEL = 'Скан без текстового слоя — распознавание недоступно'
export const EMPTY_RESULT_LABEL = 'Прочитан, данных не найдено'
export const DUPLICATE_MESSAGE = 'Такой файл уже загружен'

const IN_FLIGHT_STATUSES = new Set(['queued', 'processing'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asStage(value: unknown): ClientProcessingStage | null {
  return typeof value === 'string' && value in STAGE_LABELS ? (value as ClientProcessingStage) : null
}

export function isDocumentInFlight(doc: Pick<ClientDocument, 'parse_status'>): boolean {
  return IN_FLIGHT_STATUSES.has(String(doc.parse_status ?? ''))
}

export function isDocumentRejected(doc: Pick<ClientDocument, 'parse_status' | 'security_status'>): boolean {
  return doc.parse_status === 'rejected' || doc.security_status === 'rejected'
}

/** parsed_data.empty_reason, when the document was read but nothing usable was found. */
export function emptyReasonOf(parsed: unknown): { code: string; message: string } | null {
  if (!isRecord(parsed) || !isRecord(parsed.empty_reason)) return null
  const code = nonEmpty(parsed.empty_reason.code)
  const message = nonEmpty(parsed.empty_reason.message)
  if (!code && !message) return null
  return { code: code ?? 'EMPTY', message: message ?? EMPTY_RESULT_LABEL }
}

function parsedStats(parsed: unknown): {
  warnings: string[]
  fieldCount: number | null
  rowCount: number | null
  unverifiedCount: number
  partial: boolean
} {
  if (!isRecord(parsed)) return { warnings: [], fieldCount: null, rowCount: null, unverifiedCount: 0, partial: false }
  const stats = isRecord(parsed.stats) ? parsed.stats : {}
  const coverage = isRecord(parsed.coverage) ? parsed.coverage : {}
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
    : []
  const unverified = Array.isArray(parsed.unverified_fields) ? parsed.unverified_fields.length : 0
  const rowsFallback = (Array.isArray(parsed.raw_rows) ? parsed.raw_rows.length : 0)
    + (Array.isArray(parsed.client_rows) ? parsed.client_rows.length : 0)
  return {
    warnings,
    fieldCount: finiteNumber(stats.field_count) ?? (Array.isArray(parsed.fields) ? parsed.fields.length : null),
    rowCount: finiteNumber(stats.row_count) ?? (rowsFallback || null),
    unverifiedCount: finiteNumber(stats.unverified_count) ?? unverified,
    partial: coverage.partial === true,
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function countsLine(fieldCount: number | null, rowCount: number | null): string | null {
  const parts: string[] = []
  if (fieldCount !== null) parts.push(`${fieldCount} ${plural(fieldCount, 'показатель', 'показателя', 'показателей')}`)
  if (rowCount) parts.push(`${rowCount} ${plural(rowCount, 'строка', 'строки', 'строк')}`)
  return parts.length ? `Извлечено: ${parts.join(' · ')}` : null
}

function minutesSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? (now - t) / 60_000 : null
}

/**
 * Map a documents row to what the client sees. `now` is injectable for tests.
 */
export function documentStatusView(doc: ClientDocument, now: number = Date.now()): DocumentStatusView {
  const stage = asStage(doc.processing_stage)
  const stats = parsedStats(doc.parsed_data)
  const base = {
    stage,
    stageLabel: stage ? STAGE_LABELS[stage] : null,
    inFlight: false,
    stalled: false,
    canReprocess: false,
    emptyReasonCode: null as string | null,
    ...stats,
  }
  const parseError = nonEmpty(doc.parse_error)

  if (isDocumentRejected(doc)) {
    return {
      ...base,
      label: 'Отклонён проверкой',
      short: 'Отклонён',
      tone: 'error',
      icon: 'gpp_bad',
      detail: nonEmpty(doc.security_reason) ?? parseError ?? 'Файл не прошёл проверку безопасности.',
    }
  }

  const status = String(doc.parse_status ?? '')
  switch (status) {
    case 'queued': {
      const idle = minutesSince(doc.updated_at ?? doc.uploaded_at, now)
      const stalled = idle !== null && idle > STALE_QUEUE_MINUTES
      const attempts = finiteNumber(doc.attempts) ?? 0
      // A requeued document carries the server's explanation (e.g. REAPED).
      const detail = parseError ?? (attempts > 0 ? `Повторная обработка (попытка ${attempts + 1})` : null)
      return {
        ...base,
        label: 'В очереди на обработку',
        short: 'В очереди',
        tone: 'neutral',
        icon: 'schedule',
        detail,
        inFlight: true,
        stalled,
        canReprocess: stalled,
      }
    }
    case 'processing': {
      const attempts = finiteNumber(doc.attempts) ?? 0
      const label = stage && stage !== 'done' && stage !== 'failed' ? STAGE_LABELS[stage] : 'Обработка'
      return {
        ...base,
        label,
        short: label,
        tone: 'progress',
        icon: 'autorenew',
        detail: attempts > 1 ? `Попытка ${attempts}` : null,
        inFlight: true,
      }
    }
    case 'needs_ocr':
      return {
        ...base,
        label: NEEDS_OCR_LABEL,
        short: 'Скан без текста',
        tone: 'warning',
        icon: 'document_scanner',
        detail: parseError ?? emptyReasonOf(doc.parsed_data)?.message ?? null,
        canReprocess: true,
        emptyReasonCode: emptyReasonOf(doc.parsed_data)?.code ?? 'NEEDS_OCR',
      }
    case 'error':
      return {
        ...base,
        label: 'Ошибка обработки',
        short: 'Ошибка',
        tone: 'error',
        icon: 'error',
        detail: parseError ?? (nonEmpty(doc.last_error_code) ? `Код ошибки: ${doc.last_error_code}` : null),
        canReprocess: true,
      }
    case 'parsed':
    case 'completed': {
      const empty = emptyReasonOf(doc.parsed_data)
      if (empty) {
        return {
          ...base,
          label: EMPTY_RESULT_LABEL,
          short: 'Данных не найдено',
          tone: 'warning',
          icon: 'search_off',
          detail: empty.message,
          canReprocess: true,
          emptyReasonCode: empty.code,
        }
      }
      return {
        ...base,
        label: 'Обработан',
        short: 'Обработан',
        tone: 'success',
        icon: 'check_circle',
        detail: countsLine(stats.fieldCount, stats.rowCount),
        canReprocess: true,
      }
    }
    default:
      // Unknown / missing status: show what the server has, never a success.
      return {
        ...base,
        label: status ? `Статус: ${status}` : 'Статус не указан',
        short: status || '—',
        tone: 'neutral',
        icon: 'help',
        detail: parseError,
      }
  }
}

/** Index of the current stage in PIPELINE_STEPS (-1 = before «Проверен»). */
export function pipelineStepIndex(view: Pick<DocumentStatusView, 'stage'>): number {
  if (!view.stage || view.stage === 'uploaded') return -1
  if (view.stage === 'failed') return -1
  return PIPELINE_STEPS.indexOf(view.stage)
}

/** «1.2 МБ» / «340 КБ» — size of a document row (size_bytes, else file_size). */
export function formatDocumentSize(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

export function documentSize(doc: Pick<ClientDocument, 'size_bytes' | 'file_size'>): number | null {
  return finiteNumber(doc.size_bytes) ?? finiteNumber(doc.file_size)
}
