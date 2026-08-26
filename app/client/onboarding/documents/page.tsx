'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { SURVEY_LABELS, SURVEY_STEP_LABELS } from '@/lib/survey-labels'

type DocType = 'pl_report' | 'balance_sheet' | 'marketing_report' | 'ops_report' | 'crm_export' | 'audit' | 'other'
type ParseStatus = 'queued' | 'processing' | 'parsed' | 'error'

interface UploadedDoc {
  id: string
  file_name: string
  doc_type: DocType
  period_quarter: string | null
  period_year: number | null
  parse_status: ParseStatus
  parsed_data: ParsedDocumentData | null
  parse_error: string | null
  uploaded_at: string
  file_size: number | null
}

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
}

interface PendingFile {
  file: File
  doc_type: DocType | ''
  period_quarter: string
  period_year: string
}

const DOC_TYPES: { value: DocType; label: string; icon: string; example: string }[] = [
  { value: 'pl_report',        label: 'P&L (годовой · Точка А)', icon: 'receipt_long',  example: 'Шаблон P&L' },
  { value: 'balance_sheet',    label: 'Баланс',                  icon: 'account_balance',example: 'Шаблон баланса' },
  { value: 'marketing_report', label: 'Маркетинговый отчёт',     icon: 'campaign',      example: 'Шаблон маркетинга' },
  { value: 'ops_report',       label: 'Операционный отчёт',      icon: 'settings',      example: 'Шаблон операций' },
  { value: 'crm_export',       label: 'CRM-выгрузка',            icon: 'people',        example: 'Шаблон CRM' },
  { value: 'audit',            label: 'Аудит',                   icon: 'fact_check',    example: 'Шаблон аудита' },
  { value: 'other',            label: 'Другое',                  icon: 'folder',        example: '' },
]

const CURRENT_REPORT_YEAR = new Date().getFullYear()
const REPORT_YEARS = Array.from(
  { length: Math.max(1, CURRENT_REPORT_YEAR - 2019) },
  (_, index) => CURRENT_REPORT_YEAR - index,
)

const STATUS_CONFIG: Record<ParseStatus, { label: string; color: string; icon: string; hint: string }> = {
  queued: {
    label: 'Ожидает обработки',
    color: 'text-on-surface-variant',
    icon: 'schedule',
    hint: 'Файл загружен. Нажмите «Обработать», чтобы AI-парсер извлёк данные из документа',
  },
  processing: {
    label: 'Обработка',
    color: 'text-amber-400',
    icon: 'autorenew',
    hint: 'AI разбирает документ и извлекает показатели',
  },
  parsed: {
    label: 'Обработан',
    color: 'text-primary',
    icon: 'check_circle',
    hint: 'Нажмите, чтобы посмотреть извлечённые данные',
  },
  error: {
    label: 'Ошибка',
    color: 'text-error',
    icon: 'error',
    hint: 'Документ не удалось разобрать',
  },
}

const TECHNICAL_PARSED_KEYS = new Set([
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

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

function buildExtractedFields(data: ParsedDocumentData | null): ExtractedFieldView[] {
  if (!data) return []

  const arrayFields = getStructuredFieldSource(data)
  if (arrayFields.length > 0) {
    return arrayFields.map((item, index) => {
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
      const target = inferTarget(key, rawField)
      const confidence = firstValue(rawField, ['confidence', 'score'])
      const evidence = firstString(rawField, ['source', 'source_text', 'source_quote', 'evidence', 'quote'])

      return {
        id: `${key}-${index}`,
        sourceLabel: label,
        value: formatParsedValue(value),
        targetTab: target.tab,
        targetParam: target.param,
        evidence: evidence ? limitText(evidence, 180) : null,
        confidence: typeof confidence === 'number'
          ? `${Math.round(confidence * (confidence <= 1 ? 100 : 1))}%`
          : (typeof confidence === 'string' ? confidence : null),
      }
    })
  }

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
      }
    })
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

const ACCEPTED = '.pdf,.xlsx,.csv,.docx,.pptx'
const MAX_SIZE = 50 * 1024 * 1024

export default function DocumentsPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [pending, setPending] = useState<PendingFile | null>(null)
  const [uploaded, setUploaded] = useState<UploadedDoc[]>([])
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null)
  const [processingDocId, setProcessingDocId] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        setUserId(user?.id ?? null)

        const onbRaw = localStorage.getItem('aistart360_onboarding')
        if (onbRaw) {
          const parsed = JSON.parse(onbRaw)
          setCompanyId(parsed?.company_id ?? null)
        }
      } catch {
        setUserId(null)
      }
    }

    bootstrap()
  }, [])

  const fetchDocs = useCallback(async () => {
    if (!userId) return
    try {
      const res = await fetch(`/api/v1/onboarding/documents?user_id=${userId}`)
      const data = await res.json()
      if (data.ok) setUploaded(data.data)
    } catch {}
  }, [userId])

  const processDocument = useCallback(async (docId: string) => {
    setProcessingDocId(docId)
    setUploadError(null)
    setUploaded(prev => prev.map(doc => (
      doc.id === docId ? { ...doc, parse_status: 'processing' as ParseStatus, parse_error: null } : doc
    )))

    try {
      const res = await fetch(`/api/v1/onboarding/documents/${docId}/process`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? 'Не удалось запустить обработку файла')
      }
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : 'Ошибка обработки файла')
    } finally {
      setProcessingDocId(null)
      await fetchDocs()
    }
  }, [fetchDocs])

  // Initial load (and when the user id resolves).
  useEffect(() => {
    if (!userId) return
    fetchDocs()
  }, [userId, fetchDocs])

  // PERF-07: poll only while a document is still queued/processing; stop once
  // every document has settled (parsed / error) so the tab isn't hitting the
  // API every 10s forever.
  const hasPendingDocs = uploaded.some(
    (d) => d.parse_status === 'queued' || d.parse_status === 'processing',
  )
  useEffect(() => {
    if (!userId || !hasPendingDocs) return
    const interval = setInterval(fetchDocs, 10_000)
    return () => clearInterval(interval)
  }, [userId, hasPendingDocs, fetchDocs])

  const handleFile = (file: File) => {
    setUploadError(null)
    if (file.size > MAX_SIZE) {
      setUploadError('Файл слишком большой. Максимум 50 МБ.')
      return
    }
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['pdf','xlsx','csv','docx','pptx'].includes(ext ?? '')) {
      setUploadError('Формат не поддерживается. Используйте PDF, XLSX, CSV, DOCX, PPTX.')
      return
    }
    setPending({ file, doc_type: '', period_quarter: '', period_year: new Date().getFullYear().toString() })
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const uploadFile = async () => {
    if (!pending || !userId || !pending.doc_type) return
    setIsUploading(true)
    setUploadError(null)

    try {
      const sb = createClient()
      const path = `${userId}/${Date.now()}_${pending.file.name}`

      // Upload to Supabase Storage
      const { data: storageData, error: storageErr } = await sb.storage
        .from('client-documents')
        .upload(path, pending.file, { contentType: pending.file.type, upsert: false })

      if (storageErr) throw new Error(storageErr.message)

      // Get public URL (private bucket → signed URL)
      const { data: urlData } = await sb.storage
        .from('client-documents')
        .createSignedUrl(storageData.path, 60 * 60 * 24 * 365) // 1 year

      // Register in DB + trigger n8n
      const res = await fetch('/api/v1/onboarding/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          company_id: companyId,
          file_name: pending.file.name,
          file_url: urlData?.signedUrl ?? storageData.path,
          file_size: pending.file.size,
          mime_type: pending.file.type,
          doc_type: pending.doc_type,
          period_quarter: pending.period_quarter || null,
          period_year: pending.period_year ? parseInt(pending.period_year) : null,
        }),
      })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error)

      const docId = typeof result.data?.id === 'string' ? result.data.id : null
      setPending(null)
      if (docId) {
        void processDocument(docId)
      } else {
        await fetchDocs()
      }
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0B0F]">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#0A0B0F]/90 backdrop-blur border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/client/onboarding" className="text-on-surface-variant hover:text-on-surface transition-colors">
              <span className="material-symbols-outlined text-xl">arrow_back</span>
            </Link>
            <Image src="/logo.svg" alt="AIStart360" width={120} height={22} />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-on-surface-variant">Загрузка документов</span>
            <button onClick={async () => {
                // End the Supabase session too, or middleware bounces the user
                // right back (couldn't sign out from the documents step).
                try { await createClient().auth.signOut() } catch {}
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

        <div className="flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-on-surface">Отчёт магазина за месяц?</p>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
              Продажи и P&amp;L за август, сентябрь и другие месяцы публикуются через Store — там сохраняется точный месяц и сразу обновляется статистика.
            </p>
          </div>
          <Link
            href="/store/imports"
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-on-primary"
          >
            <span className="material-symbols-outlined text-base">storefront</span>
            Импорт в Магазин
          </Link>
        </div>

        {/* Drop Zone */}
        {!pending && (
          <div
            onDragEnter={e => { e.preventDefault(); setIsDragging(true) }}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
              isDragging
                ? 'border-primary/60 bg-primary/5'
                : 'border-white/[0.12] hover:border-primary/30 hover:bg-surface-container/50'
            }`}
          >
            <input ref={fileInputRef} type="file" accept={ACCEPTED} onChange={onFileChange} className="hidden" />
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-3xl text-primary">cloud_upload</span>
            </div>
            <p className="text-sm font-medium text-on-surface mb-1">
              {isDragging ? 'Отпустите файл' : 'Перетащите файл или нажмите'}
            </p>
            <p className="text-xs text-on-surface-variant">PDF, XLSX, CSV, DOCX, PPTX · Максимум 50 МБ</p>
          </div>
        )}

        {/* Error */}
        {uploadError && (
          <div className="flex items-center gap-2 bg-error/10 border border-error/20 rounded-xl px-4 py-3">
            <span className="material-symbols-outlined text-error text-lg">error</span>
            <p className="text-error text-sm">{uploadError}</p>
          </div>
        )}

        {/* Pending file metadata form */}
        {pending && (
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-lg text-primary">description</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-on-surface">{pending.file.name}</p>
                  <p className="text-xs text-on-surface-variant">{formatBytes(pending.file.size)}</p>
                </div>
              </div>
              <button onClick={() => setPending(null)} className="text-on-surface-variant hover:text-on-surface transition-colors">
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <div>
              <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Тип документа *</label>
              <select
                value={pending.doc_type}
                onChange={e => setPending(p => p ? {
                  ...p,
                  doc_type: e.target.value as DocType,
                  period_quarter: e.target.value === 'pl_report' ? '' : p.period_quarter,
                } : p)}
                className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 appearance-none"
              >
                <option value="">— Выберите тип —</option>
                {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
                  {pending.doc_type === 'pl_report' ? 'Период' : 'Квартал'}
                </label>
                <select
                  value={pending.period_quarter}
                  onChange={e => setPending(p => p ? { ...p, period_quarter: e.target.value } : p)}
                  disabled={pending.doc_type === 'pl_report'}
                  className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 appearance-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">{pending.doc_type === 'pl_report' ? 'Годовой отчёт' : 'Все кварталы'}</option>
                  {['Q1','Q2','Q3','Q4'].map(q => <option key={q} value={q}>{q}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Год *</label>
                <select
                  value={pending.period_year}
                  onChange={e => setPending(p => p ? { ...p, period_year: e.target.value } : p)}
                  className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 appearance-none"
                >
                  {REPORT_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setPending(null)}
                className="px-4 py-2.5 rounded-xl border border-white/[0.08] text-on-surface-variant hover:text-on-surface text-sm transition-all"
              >
                Отмена
              </button>
              <button
                onClick={uploadFile}
                disabled={isUploading || !pending.doc_type}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-all"
              >
                {isUploading ? (
                  <><span className="w-4 h-4 border-2 border-[#003824]/30 border-t-[#003824] rounded-full animate-spin" />Загружаем...</>
                ) : (
                  <><span className="material-symbols-outlined text-lg">upload</span>Загрузить</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Document type templates */}
        <div>
          <h2 className="text-xs font-mono text-on-surface-variant uppercase tracking-widest mb-3">Примеры шаблонов</h2>
          <div className="grid grid-cols-2 gap-2">
            {DOC_TYPES.filter(d => d.example).map(d => (
              <div key={d.value} className="flex items-center gap-2 bg-surface-container-low rounded-xl border border-white/[0.06] p-3">
                <span className={`material-symbols-outlined text-base text-primary`}>{d.icon}</span>
                <span className="text-xs text-on-surface flex-1">{d.label}</span>
                <span className="material-symbols-outlined text-xs text-on-surface-variant/40">download</span>
              </div>
            ))}
          </div>
        </div>

        {/* Uploaded documents */}
        {uploaded.length > 0 && (
          <div>
            <h2 className="text-xs font-mono text-on-surface-variant uppercase tracking-widest mb-3">
              Загружено ({uploaded.length})
            </h2>
            <div className="space-y-2">
              {uploaded.map(doc => {
                const st = STATUS_CONFIG[doc.parse_status] ?? STATUS_CONFIG.queued
                const dt = DOC_TYPES.find(d => d.value === doc.doc_type)
                const isExpanded = expandedDocId === doc.id
                const isProcessingThisDoc = processingDocId === doc.id
                const canStartProcessing = doc.parse_status !== 'processing' && !isProcessingThisDoc
                const extractedFields = buildExtractedFields(doc.parsed_data)
                const isClickable = doc.parse_status === 'parsed' || (doc.parsed_data !== null && extractedFields.length > 0)
                const summary = getParsedSummary(doc.parsed_data)
                const modelUsed = getParsedMeta(doc.parsed_data, 'model_used')
                const extractedAt = getParsedMeta(doc.parsed_data, 'extracted_at')
                const rawPreview = getParsedMeta(doc.parsed_data, 'raw_text_preview')
                return (
                  <div
                    key={doc.id}
                    className={`bg-surface-container-low rounded-xl border transition-all overflow-hidden ${
                      isExpanded ? 'border-primary/25' : 'border-white/[0.06]'
                    }`}
                  >
                    <div
                      role={isClickable ? 'button' : undefined}
                      tabIndex={isClickable ? 0 : -1}
                      onClick={() => {
                        if (isClickable) setExpandedDocId(current => current === doc.id ? null : doc.id)
                      }}
                      onKeyDown={event => {
                        if (!isClickable) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setExpandedDocId(current => current === doc.id ? null : doc.id)
                        }
                      }}
                      className={`w-full flex items-center gap-3 p-4 text-left transition-colors ${
                        isClickable ? 'hover:bg-white/[0.025] cursor-pointer' : 'cursor-default'
                      }`}
                      title={isClickable ? 'Показать извлечённые данные' : st.hint}
                    >
                      <span className="material-symbols-outlined text-xl text-primary">{dt?.icon ?? 'description'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-on-surface truncate">{doc.file_name}</p>
                        <p className="text-xs text-on-surface-variant">
                          {dt?.label} {doc.period_quarter && `· ${doc.period_quarter}`} {doc.period_year && `${doc.period_year}`}
                          {doc.file_size && ` · ${formatBytes(doc.file_size)}`}
                        </p>
                        {doc.parse_status !== 'parsed' && (
                          <p className="text-[10px] text-on-surface-variant/55 mt-1">{doc.parse_error ?? st.hint}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <div className={`flex items-center gap-1 ${st.color}`}>
                          <span className={`material-symbols-outlined text-sm ${doc.parse_status === 'processing' || isProcessingThisDoc ? 'animate-spin' : ''}`}>
                            {isProcessingThisDoc ? 'autorenew' : st.icon}
                          </span>
                          <span className="text-xs font-mono">{isProcessingThisDoc ? 'Обработка' : st.label}</span>
                        </div>
                        {canStartProcessing && (
                          <button
                            type="button"
                            onClick={event => {
                              event.stopPropagation()
                              void processDocument(doc.id)
                            }}
                            disabled={isProcessingThisDoc}
                            className="text-[10px] font-mono text-primary hover:text-primary/80 disabled:text-on-surface-variant transition-colors"
                          >
                            {isProcessingThisDoc
                              ? 'Запуск...'
                              : doc.parse_status === 'parsed'
                                ? 'Переобработать'
                                : 'Обработать'}
                          </button>
                        )}
                      </div>
                      {isClickable && (
                        <span className={`material-symbols-outlined text-lg text-on-surface-variant transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                          expand_more
                        </span>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="border-t border-white/[0.06] px-4 pb-4 pt-3 space-y-4">
                        {summary && (
                          <div>
                            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1.5">Кратко из файла</p>
                            <p className="text-xs leading-relaxed text-on-surface-variant">{summary}</p>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div className="rounded-lg bg-black/15 border border-white/[0.04] px-3 py-2">
                            <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase">Полей</p>
                            <p className="text-sm font-semibold text-on-surface mt-0.5">{extractedFields.length}</p>
                          </div>
                          <div className="rounded-lg bg-black/15 border border-white/[0.04] px-3 py-2">
                            <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase">Модель</p>
                            <p className="text-sm font-semibold text-on-surface mt-0.5 truncate">{modelUsed ?? '—'}</p>
                          </div>
                          <div className="rounded-lg bg-black/15 border border-white/[0.04] px-3 py-2">
                            <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase">Дата</p>
                            <p className="text-sm font-semibold text-on-surface mt-0.5 truncate">
                              {extractedAt ? new Date(extractedAt).toLocaleDateString('ru-RU') : '—'}
                            </p>
                          </div>
                        </div>

                        {extractedFields.length > 0 ? (
                          <div className="space-y-2">
                            <div className="hidden sm:grid grid-cols-[1.1fr_0.9fr_1fr] gap-3 px-3">
                              <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider">Взято из файла</p>
                              <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider">Значение</p>
                              <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider">Куда внесено</p>
                            </div>
                            {extractedFields.map(field => (
                              <div key={field.id} className="rounded-lg bg-black/15 border border-white/[0.04] px-3 py-2.5">
                                <div className="grid grid-cols-1 sm:grid-cols-[1.1fr_0.9fr_1fr] gap-3">
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium text-on-surface truncate">{field.sourceLabel}</p>
                                    {field.evidence && (
                                      <p className="text-[10px] text-on-surface-variant/60 mt-1 leading-relaxed">{field.evidence}</p>
                                    )}
                                  </div>
                                  <p className="text-xs text-on-surface-variant break-words">{field.value}</p>
                                  <div className="min-w-0">
                                    <p className="text-xs text-primary truncate">{field.targetTab}</p>
                                    <p className="text-[10px] text-on-surface-variant mt-1 truncate">{field.targetParam}</p>
                                    {field.confidence && (
                                      <p className="text-[10px] text-on-surface-variant/50 mt-1">Уверенность: {field.confidence}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-lg bg-black/15 border border-white/[0.04] px-3 py-3">
                            <p className="text-xs text-on-surface-variant">
                              Для этого файла нет сохранённой детализации полей в parsed_data.
                            </p>
                          </div>
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
