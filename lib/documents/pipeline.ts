/**
 * lib/documents/pipeline.ts — one document, from checked bytes to parsed_data.
 *
 *   text (pages / sheets / slides)          lib/documents/text.ts
 *     └─ no text layer (scan / photo) → OCR (lib/documents/ocr.ts), else needs_ocr
 *   extract                                 lib/documents/extraction.ts
 *     deterministic table rows / transaction rows / regex
 *     model map-reduce only when the deterministic paths do not cover it
 *   bind                                    lib/documents/bind-fields.ts (+ AI within budget)
 *   payload with provenance, coverage and an explicit empty_reason
 *
 * Pure with respect to I/O: the caller (document_intelligence agent) provides
 * the bytes, the budget-guarded model function and the stage callback, and
 * persists the result.
 */
import { bindFieldsToMetrics } from './bind-fields'
import { CLIENT_LIKE_TYPES, SALES_LIKE_TYPES } from './doc-types'
import type { ParsedDataField, ParsedDataPayload } from './extract'
import type { ClientBaseRow, SalesRow } from './extract-rows'
import {
  aiBindFields,
  combineFields,
  deterministicRows,
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_VERSION,
  extractFieldsWithLlm,
  extractRowsWithLlm,
  heuristicFields,
  MAX_LLM_ROWS,
  mergeSummaries,
  tableFields,
  TRANSIENT_LLM_ERRORS,
  type LlmFieldExtraction,
  type LlmJsonFn,
  type LlmRowsExtraction,
} from './extraction'
import { ocrDocument, ocrEngineLabel, type OcrOutcome, type OcrPage } from './ocr'
import { syncRemoteOcr } from './ocr-remote'
import type { DocumentKind } from './preflight'
import { extractDocumentText, hasNoText, meaningfulChars, structuredFromPages, type StructuredText } from './text'

export interface PipelineInput {
  documentId: string
  docType: string
  fileName: string
  buffer: Buffer
  kind: DocumentKind
  mime: string
  preflightFlags?: string[]
  /** Budget-guarded model access; null = no model for this run. */
  llm: LlmJsonFn | null
  /** True while the run may still spend on the model. */
  aiBudgetLeft: () => boolean
  deadlineAt: number
  /** When the model failed transiently and nothing was found: return 'retry' (default) or settle for heuristics. */
  retryOnTransientLlm?: boolean
  onStage?: (stage: 'extracting' | 'binding') => Promise<void>
  ocr?: (buffer: Buffer, kind: 'pdf' | 'image', deadlineAt: number) => Promise<OcrOutcome>
}

export type PipelineOutcome =
  | { status: 'parsed'; payload: ParsedDataPayload; fieldCount: number; rowCount: number; models: string[] }
  | { status: 'needs_ocr'; payload: ParsedDataPayload; message: string }
  /** The model failed transiently and nothing else was found — worth a retry. */
  | { status: 'retry'; code: string; message: string }

const PREVIEW_CHARS = 2_500
/**
 * Stored rows stay well under the 8 MB payload limit of
 * documents.save_extraction (and keep the polled list light): beyond this the
 * rows are cut and the cut is recorded in coverage + warnings.
 */
export const MAX_STORED_ROWS = 20_000
export const MAX_STORED_ROWS_CHARS = 4_000_000
const MAX_UNVERIFIED_ROWS = 50

/** The first rows that fit the storage caps; `total` is what the document had. */
export function capRowsForStorage<T>(rows: T[], maxRows = MAX_STORED_ROWS, maxChars = MAX_STORED_ROWS_CHARS): { rows: T[]; total: number; truncated: boolean } {
  let chars = 2
  let n = 0
  for (; n < rows.length && n < maxRows; n++) {
    chars += JSON.stringify(rows[n]).length + 1
    if (chars > maxChars) break
  }
  return { rows: n < rows.length ? rows.slice(0, n) : rows, total: rows.length, truncated: n < rows.length }
}

/** Honest warning per model rows-extraction failure. */
function rowsLlmWarning(error: string, mode: 'sales' | 'clients'): string {
  const what = mode === 'sales' ? 'строк продаж' : 'клиентской базы'
  const object = mode === 'sales' ? 'строки продаж' : 'клиентскую базу'
  if (error === 'TOO_MANY_ROWS') {
    return `Строк в таблице больше ${MAX_LLM_ROWS} — распознавание ${what} через ИИ не выполнялось. Назовите колонки «дата», «сумма», «клиент», и строки прочитаются автоматически без ограничений.`
  }
  if (error === 'TOO_LONG') {
    return `Строки таблицы слишком длинные для распознавания ${what} через ИИ. Назовите колонки «дата», «сумма», «клиент», и строки прочитаются автоматически.`
  }
  return `ИИ не смог распознать ${object} (${error}) — строки не сохранены.`
}
const TABULAR: ReadonlySet<DocumentKind> = new Set(['xlsx', 'xls', 'csv'])

export const NEEDS_OCR_MESSAGE =
  'Документ — скан или фото без текстового слоя. Автоматическое распознавание (OCR) сейчас недоступно, поэтому показатели не извлечены. Загрузите PDF с текстом, DOCX или XLSX — или передайте файл эксперту.'

/** Upper bound for any value read from OCR text (the text itself may be wrong). */
export const OCR_MAX_CONFIDENCE = 0.7

const OCR_LOW_QUALITY_MESSAGE =
  'Документ — скан, но распознать на нём текст не удалось (низкое качество изображения). Загрузите более чёткую копию или файл с текстом.'

/** Honest needs_ocr message per OCR failure reason. */
export function needsOcrMessage(ocr: OcrOutcome): string {
  if (ocr.ok) return OCR_LOW_QUALITY_MESSAGE
  switch (ocr.reason) {
    case 'timeout':
      return 'Документ — скан или фото без текстового слоя. Распознавание (OCR) не уложилось в отведённое время, поэтому показатели не извлечены. Попробуйте файл с меньшим числом страниц, PDF с текстом — или передайте файл эксперту.'
    case 'failed':
    case 'no_pages':
      return 'Документ — скан или фото без текстового слоя. Распознавание (OCR) завершилось ошибкой, поэтому показатели не извлечены. Загрузите более чёткую копию, PDF с текстом, DOCX или XLSX — или передайте файл эксперту.'
    default:
      return NEEDS_OCR_MESSAGE
  }
}

/** OCR provenance for parsed_data.source.ocr — engine and confidence per page. */
export function ocrSourceInfo(ocr: Extract<OcrOutcome, { ok: true }>) {
  return {
    engine: ocr.engine,
    engines: ocr.engines ?? [ocr.engine],
    label: ocrEngineLabel(ocr.engine),
    langs: ocr.langs ?? null,
    pages: ocr.pages.length,
    total_pages: ocr.totalPages,
    rendered_pages: ocr.renderedPages ?? ocr.pages.length,
    mean_confidence: ocr.meanConfidence === null ? null : Math.round(ocr.meanConfidence),
    partial: ocr.partial ?? ocr.pages.length < ocr.totalPages,
    stop_reason: ocr.stopReason ?? null,
    fallback: ocr.fallback ?? null,
    ms: ocr.ms ?? null,
    page_details: ocr.pages.map((p) => ({
      page: p.page,
      engine: p.engine ?? ocr.engine,
      confidence: p.confidence === null ? null : Math.round(p.confidence),
      chars: p.text.length,
      ms: p.ms ?? null,
    })),
  }
}

/** Cap confidence and stamp the OCR engine (of the field's page) into provenance. */
export function markOcrFields(fields: ParsedDataField[], ocr: Extract<OcrOutcome, { ok: true }>): ParsedDataField[] {
  const byPage = new Map<number, OcrPage>(ocr.pages.map((p) => [p.page, p]))
  return fields.map((f) => {
    const confidence = Math.min(typeof f.confidence === 'number' ? f.confidence : OCR_MAX_CONFIDENCE, OCR_MAX_CONFIDENCE)
    if (!f.provenance) return { ...f, confidence }
    const page = typeof f.provenance.page === 'number' ? byPage.get(f.provenance.page) : undefined
    return {
      ...f,
      confidence,
      provenance: {
        ...f.provenance,
        ocr: true,
        ocr_engine: page?.engine ?? ocr.engine,
        ocr_page_confidence: page && page.confidence !== null ? Math.round(page.confidence) : null,
      },
    }
  })
}

function rowsMode(docType: string): 'sales' | 'clients' | null {
  const t = docType.toLowerCase()
  if (SALES_LIKE_TYPES.has(t)) return 'sales'
  if (CLIENT_LIKE_TYPES.has(t)) return 'clients'
  return null
}

function sourceInfo(input: PipelineInput, st: StructuredText, ocr: OcrOutcome | null) {
  return {
    kind: input.kind,
    mime: input.mime,
    units: st.units,
    chars: st.text.length,
    empty_units: st.emptyUnits.slice(0, 50),
    ...(st.encoding ? { encoding: st.encoding } : {}),
    ...(input.preflightFlags?.length ? { preflight_flags: input.preflightFlags } : {}),
    ...(ocr?.ok ? { ocr: ocrSourceInfo(ocr) } : {}),
    ...(ocr && !ocr.ok ? { ocr_attempt: { reason: ocr.reason, message: ocr.message } } : {}),
  }
}

export async function runDocumentPipeline(input: PipelineInput): Promise<PipelineOutcome> {
  const extractedAt = () => new Date().toISOString()
  let st = await extractDocumentText(input.buffer, input.kind)
  let ocr: OcrOutcome | null = null
  const warnings: string[] = []

  // ── Scans: OCR or an honest needs_ocr ──────────────────────────────────
  if ((input.kind === 'pdf' || input.kind === 'image') && hasNoText(st)) {
    const run = input.ocr ?? (async (buf, kind, deadlineAt) => {
      // Remote OCR (e.g. DeepSeek OCR on Alem) only when the admin routed «ocr» to it.
      await syncRemoteOcr()
      return ocrDocument(buf, kind, { deadlineAt })
    })
    ocr = await run(input.buffer, input.kind === 'image' ? 'image' : 'pdf', Math.min(input.deadlineAt, Date.now() + 120_000))
    const ocrText = ocr.ok ? ocr.pages.map((p) => p.text).join('\n') : ''
    if (!ocr.ok || meaningfulChars(ocrText) < 20) {
      const message = needsOcrMessage(ocr)
      return {
        status: 'needs_ocr',
        message,
        payload: {
          summary: message,
          fields: [],
          raw_text_preview: '',
          extracted_at: extractedAt(),
          model_used: ocr.ok ? `ocr:${ocr.engine}` : 'document-parser',
          schema_version: 2,
          document_id: input.documentId,
          extraction_version: EXTRACTION_VERSION,
          prompt_version: null,
          empty_reason: { code: 'NEEDS_OCR', message },
          source: sourceInfo(input, st, ocr),
          coverage: { chars_total: 0, chars_processed: 0, truncated_input: st.truncated },
          stats: { field_count: 0, row_count: 0, ocr_reason: ocr.ok ? 'low_quality' : ocr.reason },
          warnings: [],
        },
      }
    }
    st = structuredFromPages(ocr.pages, ocr.totalPages)
    warnings.push(`Текст получен распознаванием скана (${ocrEngineLabel(ocr.engine)}) — проверьте значения.`)
    if (ocr.pages.length < ocr.totalPages) {
      const why = ocr.stopReason === 'deadline'
        ? ' — распознавание остановлено по лимиту времени'
        : ocr.stopReason === 'page_errors'
          ? ' — часть страниц распознать не удалось'
          : ocr.stopReason === 'max_pages'
            ? ' — ограничение на число страниц для OCR'
            : ''
      warnings.push(`Распознано страниц: ${ocr.pages.length} из ${ocr.totalPages}${why}.`)
    }
    if (ocr.fallback?.pages) {
      warnings.push(`Удалённый OCR (${ocr.fallback.from}) не справился — ${ocr.fallback.pages} стр. распознано локально (${ocr.fallback.to}).`)
    }
  }

  await input.onStage?.('extracting')

  // ── Deterministic paths ────────────────────────────────────────────────
  const tabular = TABULAR.has(input.kind)
  const table = tabular ? tableFields(st, input.documentId) : { fields: [], candidateRows: 0, matchedRows: 0 }
  const mode = rowsMode(input.docType)
  let rawRows: SalesRow[] = []
  let clientRows: ClientBaseRow[] = []
  let rowsMapped = false
  if (mode) {
    const det = deterministicRows(st, mode)
    rowsMapped = det.mapped
    if (mode === 'sales') rawRows = det.rows as SalesRow[]
    else clientRows = det.rows as ClientBaseRow[]
  }
  const rowCount = () => rawRows.length + clientRows.length
  const rowsCovered = rowCount() > 0
  const tableCovered = table.candidateRows >= 3 && table.matchedRows / table.candidateRows >= 0.6

  // ── Model, only when needed ────────────────────────────────────────────
  const models = new Set<string>()
  const llmUsable = () => input.llm !== null && input.aiBudgetLeft() && Date.now() < input.deadlineAt
  let llmSkipped: string | null = null
  let llmRes: LlmFieldExtraction | null = null
  const hasText = meaningfulChars(st.text) >= 20

  if (!hasText) llmSkipped = 'no_text'
  else if (rowsCovered) llmSkipped = 'rows_extracted_deterministically'
  else if (tableCovered) llmSkipped = 'table_covered_deterministically'
  else if (!input.llm) llmSkipped = 'llm_not_available'
  else if (!llmUsable()) llmSkipped = 'budget_exhausted'
  else {
    llmRes = await extractFieldsWithLlm({
      st,
      documentId: input.documentId,
      docType: input.docType,
      fileName: input.fileName,
      llm: input.llm,
      deadlineAt: input.deadlineAt,
      ocr: Boolean(ocr?.ok),
      tabular,
    })
    llmRes.models.forEach((m) => models.add(m))
  }

  let rowsLlm: LlmRowsExtraction | null = null
  if (mode && !rowsCovered && hasText) {
    if (input.llm && llmUsable()) {
      const r = await extractRowsWithLlm({ st, mode, llm: input.llm, deadlineAt: input.deadlineAt, tabular })
      rowsLlm = r
      if (r.model) models.add(r.model)
      if (mode === 'sales') rawRows = r.rows as SalesRow[]
      else clientRows = r.rows as ClientBaseRow[]
      if (r.unverified.length) {
        warnings.push(`${r.unverified.length} строк, предложенных ИИ, не найдены в документе и не используются.`)
      }
      if (r.error) warnings.push(rowsLlmWarning(r.error, mode))
      else if (!rowCount() && !r.unverified.length) {
        warnings.push(mode === 'sales'
          ? 'Строки продаж не распознаны: проверьте названия колонок (дата, сумма, клиент).'
          : 'Клиентская база не распознана: проверьте названия колонок (клиент, первая и последняя покупка, сумма, количество).')
      }
    } else if (!rowsMapped) {
      warnings.push('Строки не распознаны автоматически: названия колонок не совпали с ожидаемыми (дата, сумма, клиент).')
    }
  }

  const llmFields = llmRes?.fields ?? []
  let fields: ParsedDataField[] = combineFields(table.fields, llmFields)
  const llmProducedFacts = llmFields.length > 0
  if (!llmProducedFacts && !tabular && hasText) {
    const known = new Set(fields.map((f) => f.key))
    fields = [...fields, ...heuristicFields(st, input.documentId).filter((f) => !known.has(f.key))]
  }

  // Transient model failure with nothing to show: let the run retry.
  if (input.retryOnTransientLlm !== false && !fields.length && !rowCount()) {
    const runs = llmRes?.runs ?? []
    const failed = runs.filter((r) => !r.ok)
    const allTransient = failed.length > 0 && failed.length === runs.length
      && failed.every((r) => TRANSIENT_LLM_ERRORS.has(r.error ?? ''))
    if (allTransient) {
      return { status: 'retry', code: 'LLM_UNAVAILABLE', message: `модель недоступна (${failed[0].error})` }
    }
    if (rowsLlm?.error && TRANSIENT_LLM_ERRORS.has(rowsLlm.error)) {
      return { status: 'retry', code: 'LLM_UNAVAILABLE', message: `модель недоступна при распознавании строк (${rowsLlm.error})` }
    }
  }

  // Stored rows are capped (payload limit); the cut is never silent.
  const rowsTotal = rowCount()
  const rowsMethod: 'deterministic' | 'llm' | null = rowsTotal ? (rowsLlm?.rows.length ? 'llm' : 'deterministic') : null
  const cappedSales = capRowsForStorage(rawRows)
  const cappedClients = capRowsForStorage(clientRows)
  rawRows = cappedSales.rows
  clientRows = cappedClients.rows
  const rowsTruncated = cappedSales.truncated || cappedClients.truncated
  if (rowsTruncated) {
    warnings.push(`Сохранено строк: ${rowCount()} из ${rowsTotal} (ограничение объёма) — показатели по строкам посчитаны по части данных.`)
  }

  // OCR text may itself be wrong: every value read from it stays ≤ 0.7.
  if (ocr?.ok) fields = markOcrFields(fields, ocr)

  // ── Bind to the metric registry ────────────────────────────────────────
  await input.onStage?.('binding')
  const bound = await bindFieldsToMetrics(fields, input.docType)
  fields = bound.fields.map((f) => (f.metric_id && f.provenance && !f.provenance.binding
    ? { ...f, provenance: { ...f.provenance, binding: 'deterministic' as const } }
    : f))
  let aiBound = 0
  if (input.llm && llmUsable() && fields.some((f) => !f.metric_id)) {
    const res = await aiBindFields({ fields, docType: input.docType, llm: input.llm, deadlineAt: input.deadlineAt })
    fields = res.fields
    aiBound = res.bound
    if (res.model) models.add(res.model)
  }

  // ── Honest bookkeeping ─────────────────────────────────────────────────
  if (st.truncated) warnings.push('Обработана только часть документа (ограничение по объёму текста, строк или страниц).')
  if (llmRes) {
    const processed = llmRes.runs.filter((r) => r.ok).length
    if (llmRes.chunksSelected.length < llmRes.chunksTotal) {
      warnings.push(`Документ большой: ИИ проанализировал ${llmRes.chunksSelected.length} из ${llmRes.chunksTotal} фрагментов (наиболее насыщенные цифрами).`)
    }
    const failed = llmRes.runs.filter((r) => !r.ok).length
    if (failed) warnings.push(`${failed} фрагмент(ов) не обработано моделью — показатели из них могли не попасть в результат.`)
    if (llmRes.stopReason === 'BUDGET_EXCEEDED' || llmRes.stopReason === 'LLM_CALL_LIMIT') {
      warnings.push('Достигнут лимит ИИ для запуска — часть документа не проанализирована моделью.')
    }
    if (llmRes.stopReason === 'DEADLINE') warnings.push('Не хватило времени на анализ всех фрагментов.')
    if (llmRes.unverified.length) {
      warnings.push(`${llmRes.unverified.length} значений не подтверждены цитатой из документа и не используются в метриках.`)
    }
    if (!processed && failed) warnings.push('ИИ-извлечение не удалось — применён автоматический поиск показателей.')
  } else if (llmSkipped === 'llm_not_available' || llmSkipped === 'budget_exhausted') {
    warnings.push('ИИ-извлечение недоступно — применён только автоматический поиск показателей.')
  }

  const rows = rowCount()
  let emptyReason: { code: string; message: string } | null = null
  if (!fields.length && !rows) {
    if (!hasText) emptyReason = { code: 'EMPTY_DOCUMENT', message: 'В файле нет текста для анализа.' }
    else if (rowsLlm?.error && mode) {
      emptyReason = { code: 'ROWS_LLM_FAILED', message: rowsLlmWarning(rowsLlm.error, mode) }
    } else if (llmRes?.unverified.length || rowsLlm?.unverified.length) {
      emptyReason = { code: 'UNVERIFIED_ONLY', message: 'Найденные значения не подтверждены цитатами из документа — нужна проверка экспертом.' }
    } else {
      emptyReason = {
        code: 'NO_FACTS',
        message: llmRes
          ? 'Текст прочитан, но бизнес-показатели в нём не найдены.'
          : 'Текст прочитан, но автоматический поиск показателей ничего не нашёл (ИИ-извлечение не выполнялось).',
      }
    }
  }

  const deterministicSummary = rows
    ? (mode === 'sales' ? `Распознано строк продаж: ${rows}.` : `Распознано клиентов в базе: ${rows}.`)
    : fields.length
      ? `Найдено показателей: ${fields.length}. Проверьте значения перед использованием в диагностике.`
      : emptyReason?.message ?? ''
  const summary = (llmRes ? mergeSummaries(llmRes.summaries) : '') || deterministicSummary

  const methods = fields.reduce<Record<string, number>>((acc, f) => {
    const m = f.provenance?.method ?? 'unknown'
    acc[m] = (acc[m] ?? 0) + 1
    return acc
  }, {})
  const modelList = [...models]
  const payload: ParsedDataPayload = {
    summary,
    fields,
    raw_text_preview: st.text.slice(0, PREVIEW_CHARS),
    extracted_at: extractedAt(),
    model_used: modelList.length ? modelList.join(', ') : rows || table.fields.length ? 'deterministic-parser' : 'heuristic-parser',
    ...(rawRows.length ? { raw_rows: rawRows } : {}),
    ...(clientRows.length ? { client_rows: clientRows } : {}),
    ...(rowsMethod ? { rows_method: rowsMethod } : {}),
    ...(rowsLlm?.unverified.length ? { unverified_rows: rowsLlm.unverified.slice(0, MAX_UNVERIFIED_ROWS) } : {}),
    classification: mode ? input.docType.toLowerCase() : null,
    schema_version: 2,
    document_id: input.documentId,
    extraction_version: EXTRACTION_VERSION,
    prompt_version: llmRes ? EXTRACTION_PROMPT_VERSION : null,
    empty_reason: emptyReason,
    ...(llmRes?.unverified.length ? { unverified_fields: ocr?.ok ? markOcrFields(llmRes.unverified, ocr) : llmRes.unverified } : {}),
    source: sourceInfo(input, st, ocr),
    coverage: {
      chars_total: st.text.length,
      chars_processed: llmRes ? llmRes.charsProcessed : st.text.length,
      chunks_total: llmRes?.chunksTotal ?? 0,
      chunks_selected: llmRes?.chunksSelected ?? [],
      chunks_failed: llmRes?.runs.filter((r) => !r.ok).map((r) => ({ chunk: r.index, error: r.error })) ?? [],
      truncated_input: st.truncated,
      partial: Boolean(st.truncated || rowsTruncated || rowsLlm?.error
        || (llmRes && (llmRes.chunksSelected.length < llmRes.chunksTotal || llmRes.runs.some((r) => !r.ok)))),
      stop_reason: llmRes?.stopReason ?? null,
      rows_total: rowsTotal,
      rows_truncated: rowsTruncated,
      rows_llm_error: rowsLlm?.error ?? null,
    },
    stats: {
      field_count: fields.length,
      bound_count: fields.filter((f) => f.metric_id).length,
      ai_bound_count: aiBound,
      row_count: rows,
      unverified_count: llmRes?.unverified.length ?? 0,
      unverified_row_count: rowsLlm?.unverified.length ?? 0,
      methods,
      table_rows: { candidates: table.candidateRows, matched: table.matchedRows },
      llm_skipped: llmSkipped,
    },
    warnings,
  }
  return { status: 'parsed', payload, fieldCount: fields.length, rowCount: rows, models: modelList }
}
