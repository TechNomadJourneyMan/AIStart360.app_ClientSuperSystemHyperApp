'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { SURVEY_LABELS, SURVEY_STEP_LABELS } from '@/lib/survey-labels'
import { DocumentStatusDetails } from '@/components/documents/DocumentStatus'
import { UploadMetaFields, emptyUploadMeta, uploadMetaToOptions, type UploadMeta } from '@/components/documents/UploadMetaFields'
import { notifyDocumentsChanged, useClientDocuments } from '@/hooks/useClientDocuments'
import {
  CLIENT_DOCUMENT_ACCEPT,
  CLIENT_DOCUMENT_FORMATS_LABEL,
  CLIENT_DOCUMENT_MAX_LABEL,
  checkClientFile,
  reprocessClientDocument,
  uploadClientDocument,
} from '@/lib/documents/client-upload'
import { DOCUMENT_TYPE_LABELS, documentTypeLabel } from '@/lib/documents/doc-type-labels'
import type { DocumentTypeValue } from '@/lib/documents/doc-types'
import {
  documentSize,
  documentStatusView,
  formatDocumentSize,
  type DocumentStatusView,
} from '@/lib/documents/status-view'

interface ParsedDocumentData {
  summary?: unknown
  fields?: unknown
  extracted_fields?: unknown
  mapped_fields?: unknown
  metrics?: unknown
  raw_text_preview?: unknown
  extracted_at?: unknown
  model_used?: unknown
  [key: string]: unknown
}

interface ExtractedFieldView {
  id: string
  sourceLabel: string
  value: string
  targetTab: string
  targetParam: string
  evidence: string | null
  confidence: string | null
  /** Period the value refers to, as stated in the document. */
  period: string | null
  /** Where in the document: page / sheet / slide (provenance). */
  location: string | null
  /** false = the quote was not found in the document. */
  quoteVerified: boolean | null
  /** Bound to a platform metric (metric_id). */
  bound: boolean
}

/** Icons of the document types (labels come from lib/documents/doc-type-labels). */
const DOC_TYPE_ICONS: Partial<Record<DocumentTypeValue, string>> = {
  pl_report: 'receipt_long',
  pl_statement: 'receipt_long',
  financial_report: 'receipt_long',
  balance_sheet: 'account_balance',
  marketing_report: 'campaign',
  ads_report: 'campaign',
  ops_report: 'settings',
  crm_export: 'people',
  client_base: 'people',
  sales_report: 'trending_up',
  audit: 'fact_check',
  business_plan: 'flag',
  presentation: 'slideshow',
}

/** Types shown in «Какие документы подходят». */
const SUGGESTED_TYPES: DocumentTypeValue[] = [
  'pl_report', 'balance_sheet', 'sales_report', 'crm_export', 'marketing_report', 'ops_report',
]

function docTypeIcon(value: string): string {
  return DOC_TYPE_ICONS[value as DocumentTypeValue] ?? 'description'
}

const TECHNICAL_PARSED_KEYS = new Set([
  // extraction v2 markers (lib/documents/pipeline.ts) — never shown as data
  'schema_version',
  'document_id',
  'extraction_version',
  'prompt_version',
  'empty_reason',
  'unverified_fields',
  'source',
  'coverage',
  'stats',
  'warnings',
  'classification',
  'raw_rows',
  'client_rows',
  'summary',
  'fields',
  'extracted_fields',
  'mapped_fields',
  'metrics',
  'raw_text_preview',
  'rawTextPreview',
  'extracted_at',
  'model_used',
  'modelUsed',
  'metadata',
  'meta',
])

const TARGET_HINTS: Array<{ pattern: RegExp; tab: string; param: string }> = [
  { pattern: /revenue|выруч|sales_amount/i, tab: 'Финансы', param: 'Выручка' },
  { pattern: /net_profit|profit|прибыл/i, tab: 'Финансы', param: 'Чистая прибыль' },
  { pattern: /gross_margin|margin|марж/i, tab: 'Финансы', param: 'Маржинальность' },
  { pattern: /expense|cost|расход|cogs/i, tab: 'Финансы', param: 'Расходы' },
  { pattern: /breakeven|безуб/i, tab: 'Финансы', param: 'Точка безубыточности' },
  { pattern: /cac|acquisition/i, tab: 'Работа с базой', param: 'CAC' },
  { pattern: /ltv/i, tab: 'Работа с базой', param: 'LTV' },
  { pattern: /avg_check|average_check|средн.*чек/i, tab: 'Ключевые метрики', param: 'Средний чек' },
  { pattern: /deal|lead|client|crm|ворон|сдел/i, tab: 'Работа с базой', param: 'CRM / продажи' },
  { pattern: /marketing|channel|campaign|ads|реклам|маркет/i, tab: 'Маркетинг', param: 'Маркетинговые показатели' },
  { pattern: /operation|ops|process|операц|процесс/i, tab: 'Орг. структура', param: 'Операционные показатели' },
  { pattern: /team|staff|employee|сотруд|штат/i, tab: 'Орг. структура', param: 'Команда / штат' },
  { pattern: /goal|strategy|цель|стратег/i, tab: 'Цели', param: 'Цели и стратегия' },
]

const TAB_ALIASES: Record<string, string> = {
  finance: 'Финансы',
  financial: 'Финансы',
  sales: 'Работа с базой',
  crm: 'Работа с базой',
  operations: 'Орг. структура',
  ops: 'Орг. структура',
  marketing: 'Маркетинг',
  strategy: 'Цели',
  metrics: 'Ключевые метрики',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function firstString(source: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!source) return null
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function firstValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key]
  }
  return undefined
}

function prettifyKey(key: string): string {
  return key
    .replace(/^s\d+[a-z]*_?/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, c => c.toUpperCase())
}

function limitText(value: string, max = 180): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1).trim()}…`
}

function formatParsedValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Нет значения'
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (typeof value === 'number') return new Intl.NumberFormat('ru-RU').format(value)
  if (typeof value === 'string') return limitText(value, 220)
  if (Array.isArray(value)) {
    const list = value.map(item => formatParsedValue(item)).filter(Boolean).join(', ')
    return limitText(list || '[]', 220)
  }
  if (isRecord(value)) {
    const nestedValue = firstValue(value, ['value', 'amount', 'text', 'answer', 'result'])
    if (nestedValue !== undefined) return formatParsedValue(nestedValue)
    return limitText(JSON.stringify(value), 220)
  }
  return String(value)
}

function getStructuredFieldSource(data: ParsedDocumentData): unknown[] {
  const fields: unknown[] = []

  for (const key of ['fields', 'extracted_fields', 'mapped_fields', 'metrics']) {
    const value = data[key]
    if (Array.isArray(value)) {
      fields.push(...value)
    } else if (isRecord(value)) {
      fields.push(
        ...Object.entries(value).map(([fieldKey, fieldValue]) => (
          isRecord(fieldValue) ? { key: fieldKey, ...fieldValue } : { key: fieldKey, value: fieldValue }
        )),
      )
    }
  }

  return fields
}

function inferTarget(fieldKey: string, rawField?: Record<string, unknown>): { tab: string; param: string } {
  const target = isRecord(rawField?.target) ? rawField?.target : undefined
  const explicitTab = firstString(rawField, ['target_tab', 'destination_tab', 'tab', 'section', 'block'])
    ?? firstString(target, ['tab', 'section', 'block'])
  const explicitParam = firstString(rawField, ['target_parameter', 'destination_parameter', 'parameter', 'target_field', 'question_key'])
    ?? firstString(target, ['parameter', 'field', 'question_key'])

  const normalizedTab = explicitTab ? (TAB_ALIASES[explicitTab.toLowerCase()] ?? explicitTab) : null
  const normalizedParam = explicitParam ? (SURVEY_LABELS[explicitParam] ?? prettifyKey(explicitParam)) : null

  if (fieldKey && SURVEY_LABELS[fieldKey]) {
    const step = fieldKey.match(/^s(\d+)/)?.[1]
    return {
      tab: step ? (SURVEY_STEP_LABELS[Number(step)] ?? `Шаг ${step}`) : (normalizedTab ?? 'Анкета'),
      param: SURVEY_LABELS[fieldKey],
    }
  }

  if (normalizedTab || normalizedParam) {
    return {
      tab: normalizedTab ?? 'Анкета',
      param: normalizedParam ?? (fieldKey ? prettifyKey(fieldKey) : 'Параметр'),
    }
  }

  const hint = TARGET_HINTS.find(item => item.pattern.test(fieldKey))
  if (hint) return { tab: hint.tab, param: hint.param }

  const step = fieldKey.match(/^s(\d+)/)?.[1]
  if (step) {
    return {
      tab: SURVEY_STEP_LABELS[Number(step)] ?? `Шаг ${step}`,
      param: SURVEY_LABELS[fieldKey] ?? prettifyKey(fieldKey),
    }
  }

  return {
    tab: 'Диагностика',
    param: fieldKey ? prettifyKey(fieldKey) : 'Извлечённый параметр',
  }
}

function provenanceLocation(provenance: unknown): string | null {
  if (!isRecord(provenance)) return null
  if (typeof provenance.page === 'number') return `стр. ${provenance.page}`
  if (typeof provenance.sheet === 'string' && provenance.sheet.trim()) return `лист «${provenance.sheet.trim()}»`
  if (typeof provenance.slide === 'number') return `слайд ${provenance.slide}`
  return null
}

function fieldView(item: unknown, index: number): ExtractedFieldView {
  const rawField = isRecord(item) ? item : { value: item }
  const key = firstString(rawField, [
    'target_key',
    'question_key',
    'field_key',
    'key',
    'metric_key',
    'metric',
    'name',
  ]) ?? `field_${index + 1}`
  const label = firstString(rawField, [
    'label',
    'field_label',
    'metric_label',
    'name',
    'title',
    'source_field',
  ]) ?? SURVEY_LABELS[key] ?? prettifyKey(key)
  const value = firstValue(rawField, ['value', 'amount', 'metric_value', 'text', 'answer', 'result'])
  const unit = firstString(rawField, ['unit'])
  const target = inferTarget(key, rawField)
  const confidence = firstValue(rawField, ['confidence', 'score'])
  const provenance = isRecord(rawField.provenance) ? rawField.provenance : null
  const evidence = firstString(rawField, ['source', 'source_text', 'source_quote', 'evidence', 'quote'])
    ?? firstString(provenance ?? undefined, ['quote'])
  const formatted = formatParsedValue(value)

  return {
    id: `${key}-${index}`,
    sourceLabel: label,
    value: unit && value !== undefined ? `${formatted} ${unit}` : formatted,
    targetTab: target.tab,
    targetParam: target.param,
    evidence: evidence ? limitText(evidence, 180) : null,
    confidence: typeof confidence === 'number'
      ? `${Math.round(confidence * (confidence <= 1 ? 100 : 1))}%`
      : (typeof confidence === 'string' ? confidence : null),
    period: firstString(rawField, ['period']),
    location: provenanceLocation(provenance),
    quoteVerified: typeof provenance?.quote_verified === 'boolean' ? provenance.quote_verified : null,
    bound: typeof rawField.metric_id === 'string' && rawField.metric_id.length > 0,
  }
}

function buildExtractedFields(data: ParsedDocumentData | null): ExtractedFieldView[] {
  if (!data) return []

  const arrayFields = getStructuredFieldSource(data)
  if (arrayFields.length > 0) return arrayFields.map(fieldView)

  // Extraction v2 payloads are structured: an empty `fields` means nothing was
  // found (see empty_reason) — never turn their technical keys into «data».
  if (typeof data.schema_version === 'number' && data.schema_version >= 2) return []

  return Object.entries(data)
    .filter(([key, value]) => !TECHNICAL_PARSED_KEYS.has(key) && value !== null && value !== undefined && value !== '')
    .map(([key, value], index) => {
      const target = inferTarget(key)
      return {
        id: `${key}-${index}`,
        sourceLabel: SURVEY_LABELS[key] ?? prettifyKey(key),
        value: formatParsedValue(value),
        targetTab: target.tab,
        targetParam: target.param,
        evidence: null,
        confidence: null,
        period: null,
        location: null,
        quoteVerified: null,
        bound: false,
      }
    })
}

/** parsed_data.unverified_fields — values whose quote was not found in the document. */
function buildUnverifiedFields(data: ParsedDocumentData | null): ExtractedFieldView[] {
  const list = data?.unverified_fields
  return Array.isArray(list) ? list.map(fieldView) : []
}

function getParsedSummary(data: ParsedDocumentData | null): string | null {
  if (!data?.summary) return null
  return typeof data.summary === 'string'
    ? limitText(data.summary, 260)
    : limitText(JSON.stringify(data.summary), 260)
}

function getParsedMeta(data: ParsedDocumentData | null, key: 'model_used' | 'extracted_at' | 'raw_text_preview'): string | null {
  const value = data?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

type UploadPhase = 'idle' | 'storage' | 'register'

const PHASE_TEXT: Record<Exclude<UploadPhase, 'idle'>, string> = {
  storage: 'Загрузка в защищённое хранилище…',
  register: 'Проверка файла на сервере…',
}

function reprocessLabel(view: DocumentStatusView): string {
  if (view.stalled) return 'Запустить обработку'
  if (view.tone === 'success') return 'Переобработать'
  return 'Обработать заново'
}

function periodLabel(quarter: string | null | undefined, year: number | null | undefined): string | null {
  if (!quarter && !year) return null
  return [quarter, year].filter(Boolean).join(' ')
}

function FieldRow({ field }: { field: ExtractedFieldView }) {
  return (
    <div className="rounded-lg bg-black/15 border border-white/[0.04] px-3 py-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-[1.1fr_0.9fr_1fr] gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-on-surface truncate">{field.sourceLabel}</p>
          {field.evidence && (
            <p className="text-[10px] text-on-surface-variant/60 mt-1 leading-relaxed">{field.evidence}</p>
          )}
          {(field.location || field.period) && (
            <p className="text-[10px] font-mono text-on-surface-variant/60 mt-1">
              {[field.location, field.period ? `период: ${field.period}` : null].filter(Boolean).join(' · ')}
            </p>
          )}
          {field.quoteVerified === false && (
            <p className="text-[10px] text-amber-300/90 mt-1">Цитата не найдена в документе</p>
          )}
        </div>
        <p className="text-xs font-mono text-on-surface-variant break-words">{field.value}</p>
        <div className="min-w-0">
          <p className="text-xs text-primary truncate">{field.targetTab}</p>
          <p className="text-[10px] text-on-surface-variant mt-1 truncate">{field.targetParam}</p>
          {field.bound && (
            <p className="text-[10px] font-mono text-primary/70 mt-1">Привязано к метрике</p>
          )}
          {field.confidence && (
            <p className="text-[10px] text-on-surface-variant/50 mt-1">Уверенность: {field.confidence}</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function DocumentsPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [meta, setMeta] = useState<UploadMeta>(emptyUploadMeta)
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null)
  const [reprocessingId, setReprocessingId] = useState<string | null>(null)
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [uploadError, setUploadError] = useState<{ message: string; code?: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Live list: re-read every 5 s while a document is queued / processing.
  const { documents: uploaded, error: listError, upsert } = useClientDocuments()

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        setUserId(user?.id ?? null)

        // company_id comes from the server for THIS session — the survey
        // draft in localStorage is per-user and no longer carries it (the old
        // shared key could hand another user's company to these uploads).
        if (user?.id) {
          const compRes = await fetch('/api/v1/onboarding/company', { credentials: 'include' })
          const compJson = await compRes.json().catch(() => null)
          if (compRes.ok && compJson?.ok && compJson.data?.id) setCompanyId(String(compJson.data.id))
        }
      } catch (err) {
        console.warn('[onboarding/documents] session bootstrap failed', err instanceof Error ? err.message : err)
        setUserId(null)
      }
    }

    bootstrap()
  }, [])

  const isUploading = phase !== 'idle'
  const options = uploadMetaToOptions(meta)

  const reprocess = async (docId: string) => {
    setReprocessingId(docId)
    setUploadError(null)
    setNotice(null)
    const res = await reprocessClientDocument(docId)
    setReprocessingId(null)
    if (!res.ok) {
      setUploadError({ message: res.error, code: res.code })
      return
    }
    if (res.alreadyQueued) setNotice('Документ уже в очереди на обработку.')
    if (res.document) upsert(res.document)
    notifyDocumentsChanged()
  }

  const handleFile = (file: File) => {
    setUploadError(null)
    setNotice(null)
    const check = checkClientFile(file)
    if (!check.ok) {
      setUploadError({ message: check.error })
      return
    }
    setMeta(emptyUploadMeta())
    setPendingFile(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) handleFile(file)
  }

  const uploadFile = async () => {
    if (!pendingFile || !options || isUploading) return
    setUploadError(null)
    setNotice(null)
    setPhase('storage')
    // Processing starts on the server by itself — no /process call here.
    const res = await uploadClientDocument(pendingFile, { ...options, companyId, onPhase: setPhase })
    setPhase('idle')
    if (res.kind !== 'failed') notifyDocumentsChanged()
    switch (res.kind) {
      case 'created':
        upsert(res.document)
        setPendingFile(null)
        break
      case 'duplicate':
        upsert(res.document)
        setPendingFile(null)
        setNotice(res.message)
        break
      case 'rejected':
        if (res.document) upsert(res.document)
        setPendingFile(null)
        setUploadError({ message: `Файл отклонён: ${res.error}`, code: res.code })
        break
      case 'failed':
        setUploadError({ message: res.error, code: res.code })
        break
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0B0F]">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#0A0B0F]/90 backdrop-blur border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/client/onboarding" aria-label="Назад к анкете" className="text-on-surface-variant hover:text-on-surface transition-colors">
              <span className="material-symbols-outlined text-xl">arrow_back</span>
            </Link>
            <Image src="/logo.svg" alt="AIStart360" width={120} height={22} />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-on-surface-variant">Загрузка документов</span>
            <button onClick={async () => {
                // End the Supabase session too, or middleware bounces the user
                // right back (couldn't sign out from the documents step).
                try {
                  await createClient().auth.signOut()
                } catch (err) {
                  console.warn('[onboarding/documents] sign-out failed', err instanceof Error ? err.message : err)
                }
                document.cookie = 'aistart360_role=; path=/; max-age=0'
                document.cookie = 'aistart360_user_id=; path=/; max-age=0'
                window.location.href = '/login'
              }}
              className="text-xs text-red-400/70 hover:text-red-400 flex items-center gap-1 border border-red-500/10 px-2 py-1 rounded-lg transition-all">
              <span className="material-symbols-outlined text-sm">logout</span>
              Выход
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Title */}
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Документы · загрузка файлов</p>
          <h1 className="font-headline text-2xl font-extrabold text-on-surface mb-1">Загрузите финансовые документы</h1>
          <p className="text-sm text-on-surface-variant">AI-система проанализирует ваши отчёты и дополнит диагностику реальными данными</p>
        </div>

        {/* Drop Zone */}
        {!pendingFile && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Выбрать файл для загрузки"
            onDragEnter={e => { e.preventDefault(); setIsDragging(true) }}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${
              isDragging
                ? 'border-primary/60 bg-primary/5'
                : 'border-white/[0.12] hover:border-primary/30 hover:bg-surface-container/50'
            }`}
          >
            <input ref={fileInputRef} type="file" accept={CLIENT_DOCUMENT_ACCEPT} onChange={onFileChange} className="hidden" />
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-3xl text-primary">cloud_upload</span>
            </div>
            <p className="text-sm font-medium text-on-surface mb-1">
              {isDragging ? 'Отпустите файл' : 'Перетащите файл или нажмите'}
            </p>
            <p className="text-xs text-on-surface-variant">{CLIENT_DOCUMENT_FORMATS_LABEL} · Максимум {CLIENT_DOCUMENT_MAX_LABEL}</p>
          </div>
        )}

        {/* Error */}
        {uploadError && (
          <div className="flex items-start gap-2 bg-error/10 border border-error/20 rounded-xl px-4 py-3" role="alert">
            <span className="material-symbols-outlined text-error text-lg">error</span>
            <div className="space-y-1">
              <p className="text-error text-sm">{uploadError.message}</p>
              {uploadError.code === 'NO_COMPANY' && (
                <Link href="/client/onboarding" className="text-xs font-mono text-primary hover:underline">
                  Заполнить данные компании →
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Info (duplicate / already queued) */}
        {notice && (
          <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3" role="status">
            <span className="material-symbols-outlined text-primary text-lg">info</span>
            <p className="text-on-surface text-sm">{notice}</p>
          </div>
        )}

        {/* Pending file metadata form */}
        {pendingFile && (
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-lg text-primary">description</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-on-surface">{pendingFile.name}</p>
                  <p className="text-xs text-on-surface-variant">{formatDocumentSize(pendingFile.size)}</p>
                </div>
              </div>
              <button
                onClick={() => setPendingFile(null)}
                disabled={isUploading}
                aria-label="Убрать файл"
                className="text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <UploadMetaFields value={meta} onChange={setMeta} disabled={isUploading} idPrefix="onboarding-doc" />

            {isUploading && (
              <p className="flex items-center gap-2 text-xs font-mono text-primary" role="status" aria-live="polite">
                <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                {PHASE_TEXT[phase as Exclude<UploadPhase, 'idle'>]}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setPendingFile(null)}
                disabled={isUploading}
                className="px-4 py-2.5 rounded-xl border border-white/[0.08] text-on-surface-variant hover:text-on-surface text-sm transition-all disabled:opacity-40"
              >
                Отмена
              </button>
              <button
                onClick={uploadFile}
                disabled={isUploading || !options || !userId}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {isUploading ? (
                  <><span className="w-4 h-4 border-2 border-[#003824]/30 border-t-[#003824] rounded-full animate-spin" />Загружаем...</>
                ) : (
                  <><span className="material-symbols-outlined text-lg">upload</span>{options ? 'Загрузить' : 'Выберите тип документа'}</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Which documents fit */}
        <div>
          <h2 className="text-xs font-mono text-on-surface-variant uppercase tracking-widest mb-3">Какие документы подходят</h2>
          <div className="grid grid-cols-2 gap-2">
            {SUGGESTED_TYPES.map(t => (
              <div key={t} className="flex items-center gap-2 bg-surface-container-low rounded-xl border border-white/[0.06] p-3">
                <span className="material-symbols-outlined text-base text-primary">{docTypeIcon(t)}</span>
                <span className="text-xs text-on-surface flex-1">{DOCUMENT_TYPE_LABELS[t]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Uploaded documents */}
        {listError && (
          <p className="text-xs text-error" role="alert">Не удалось обновить список документов: {listError}</p>
        )}
        {uploaded.length > 0 && (
          <div>
            <h2 className="text-xs font-mono text-on-surface-variant uppercase tracking-widest mb-3">
              Загружено ({uploaded.length})
            </h2>
            <div className="space-y-2">
              {uploaded.map(doc => {
                const view = documentStatusView(doc)
                const parsed = (doc.parsed_data ?? null) as ParsedDocumentData | null
                const isExpanded = expandedDocId === doc.id
                const isReprocessing = reprocessingId === doc.id
                const extractedFields = buildExtractedFields(parsed)
                const unverifiedFields = buildUnverifiedFields(parsed)
                // Details exist once the pipeline wrote a result (any outcome).
                const isClickable = !view.inFlight && parsed !== null && isRecord(parsed)
                const summary = getParsedSummary(parsed)
                const modelUsed = getParsedMeta(parsed, 'model_used')
                const extractedAt = getParsedMeta(parsed, 'extracted_at')
                const rawPreview = getParsedMeta(parsed, 'raw_text_preview')
                const period = periodLabel(doc.period_quarter, doc.period_year)
                const size = formatDocumentSize(documentSize(doc))
                return (
                  <div
                    key={doc.id}
                    className={`bg-surface-container-low rounded-xl border transition-all overflow-hidden ${
                      isExpanded ? 'border-primary/25' : 'border-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-start gap-3 p-4">
                      <span className="material-symbols-outlined text-xl text-primary mt-0.5">{docTypeIcon(doc.doc_type)}</span>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div>
                          <p className="text-sm text-on-surface truncate">{doc.file_name}</p>
                          <p className="text-xs text-on-surface-variant">
                            {[documentTypeLabel(doc.doc_type), period, size].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <DocumentStatusDetails view={view} showWarnings={false} />
                      </div>
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        {view.canReprocess && (
                          <button
                            type="button"
                            onClick={() => void reprocess(doc.id)}
                            disabled={isReprocessing}
                            className="text-[10px] font-mono text-primary hover:text-primary/80 disabled:text-on-surface-variant transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
                          >
                            {isReprocessing ? 'Запуск…' : reprocessLabel(view)}
                          </button>
                        )}
                        {isClickable && (
                          <button
                            type="button"
                            onClick={() => setExpandedDocId(current => current === doc.id ? null : doc.id)}
                            aria-expanded={isExpanded}
                            className="inline-flex items-center gap-0.5 text-[10px] font-mono text-on-surface-variant hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
                          >
                            Подробнее
                            <span className={`material-symbols-outlined text-sm transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                              expand_more
                            </span>
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-white/[0.06] px-4 pb-4 pt-3 space-y-4">
                        {summary && (
                          <div>
                            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1.5">Кратко из файла</p>
                            <p className="text-xs leading-relaxed text-on-surface-variant">{summary}</p>
                          </div>
                        )}

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div className="rounded-lg bg-black/15 border border-white/[0.04] px-3 py-2">
                            <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase">Показателей</p>
                            <p className="text-sm font-mono font-semibold text-on-surface mt-0.5">{view.fieldCount ?? extractedFields.length}</p>
                          </div>
                          <div className="rounded-lg bg-black/15 border border-white/[0.04] px-3 py-2">
                            <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase">Строк</p>
                            <p className="text-sm font-mono font-semibold text-on-surface mt-0.5">{view.rowCount ?? '—'}</p>
                          </div>
                          <div className="rounded-lg bg-black/15 border border-white/[0.04] px-3 py-2">
                            <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase">Модель</p>
                            <p className="text-sm font-semibold text-on-surface mt-0.5 truncate" title={modelUsed ?? undefined}>{modelUsed ?? '—'}</p>
                          </div>
                          <div className="rounded-lg bg-black/15 border border-white/[0.04] px-3 py-2">
                            <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase">Дата</p>
                            <p className="text-sm font-mono font-semibold text-on-surface mt-0.5 truncate">
                              {extractedAt ? new Date(extractedAt).toLocaleDateString('ru-RU') : '—'}
                            </p>
                          </div>
                        </div>

                        {view.partial && (
                          <p className="text-[11px] text-amber-300/90">Проанализирована только часть документа — подробности в предупреждениях.</p>
                        )}
                        {view.warnings.length > 0 && (
                          <div className="rounded-lg bg-amber-400/[0.06] border border-amber-400/15 px-3 py-2.5">
                            <p className="text-[10px] font-mono text-amber-300/80 uppercase tracking-wider mb-1.5">Предупреждения</p>
                            <ul className="space-y-1">
                              {view.warnings.map((w, i) => (
                                <li key={i} className="text-[11px] leading-relaxed text-amber-200/90">{w}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {extractedFields.length > 0 ? (
                          <div className="space-y-2">
                            <div className="hidden sm:grid grid-cols-[1.1fr_0.9fr_1fr] gap-3 px-3">
                              <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider">Взято из файла</p>
                              <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider">Значение</p>
                              <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider">Куда внесено</p>
                            </div>
                            {extractedFields.map(field => <FieldRow key={field.id} field={field} />)}
                          </div>
                        ) : (
                          <div className="rounded-lg bg-black/15 border border-white/[0.04] px-3 py-3">
                            <p className="text-xs text-on-surface-variant">
                              {view.detail && view.tone !== 'success' ? view.detail : 'Показатели из этого файла не извлечены.'}
                            </p>
                          </div>
                        )}

                        {unverifiedFields.length > 0 && (
                          <details className="rounded-lg bg-black/15 border border-white/[0.04] px-3 py-2">
                            <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider text-amber-300/90">
                              Не подтверждены цитатой из документа ({unverifiedFields.length}) — не используются в метриках
                            </summary>
                            <div className="space-y-2 mt-2">
                              {unverifiedFields.map(field => <FieldRow key={field.id} field={field} />)}
                            </div>
                          </details>
                        )}

                        {rawPreview && (
                          <details className="rounded-lg bg-black/15 border border-white/[0.04] px-3 py-2">
                            <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
                              Фрагмент распознанного текста
                            </summary>
                            <p className="text-[10px] leading-relaxed text-on-surface-variant/70 mt-2 whitespace-pre-wrap">
                              {limitText(rawPreview, 900)}
                            </p>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t border-white/[0.06]">
          <Link href="/client/onboarding"
            className="flex-1 py-3 rounded-xl border border-white/[0.08] text-on-surface-variant hover:text-on-surface text-sm font-medium text-center transition-all">
            ← К анкете
          </Link>
          <Link href="/client/point-a"
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm text-center transition-all hover:scale-[0.99]">
            Перейти к диагностике →
          </Link>
        </div>
      </main>
    </div>
  )
}
