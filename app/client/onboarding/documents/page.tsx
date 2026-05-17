'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type DocType = 'pl_report' | 'balance_sheet' | 'marketing_report' | 'ops_report' | 'crm_export' | 'audit' | 'other'
type ParseStatus = 'queued' | 'processing' | 'parsed' | 'error'

type DiagnosticTab = 'finance' | 'sales' | 'operations' | 'marketing' | 'strategy' | 'anketa'

interface ExtractedField {
  key: string
  label: string
  value: string
  tab: DiagnosticTab
  parameter: string
  confidence: number
  source_excerpt: string
}

interface ParsedData {
  summary: string
  fields: ExtractedField[]
  raw_text_preview?: string
  extracted_at?: string
  model_used?: string
}

interface UploadedDoc {
  id: string
  file_name: string
  doc_type: DocType
  period_quarter: string | null
  period_year: number | null
  parse_status: ParseStatus
  uploaded_at: string
  file_size: number | null
  parsed_data: ParsedData | null
  parse_error: string | null
}

const TAB_META: Record<DiagnosticTab, { label: string; icon: string; color: string }> = {
  finance:    { label: 'Финансы',   icon: 'payments',     color: 'text-emerald-400' },
  sales:      { label: 'Продажи',   icon: 'trending_up',  color: 'text-sky-400' },
  operations: { label: 'Операции',  icon: 'settings',     color: 'text-orange-400' },
  marketing:  { label: 'Маркетинг', icon: 'campaign',     color: 'text-pink-400' },
  strategy:   { label: 'Стратегия', icon: 'flag',         color: 'text-violet-400' },
  anketa:     { label: 'Анкета',    icon: 'description',  color: 'text-slate-400' },
}

interface PendingFile {
  file: File
  doc_type: DocType | ''
  period_quarter: string
  period_year: string
}

const DOC_TYPES: { value: DocType; label: string; icon: string; example: string }[] = [
  { value: 'pl_report',        label: 'P&L (Отчёт о прибыли)',  icon: 'receipt_long',  example: 'Шаблон P&L' },
  { value: 'balance_sheet',    label: 'Баланс',                  icon: 'account_balance',example: 'Шаблон баланса' },
  { value: 'marketing_report', label: 'Маркетинговый отчёт',     icon: 'campaign',      example: 'Шаблон маркетинга' },
  { value: 'ops_report',       label: 'Операционный отчёт',      icon: 'settings',      example: 'Шаблон операций' },
  { value: 'crm_export',       label: 'CRM-выгрузка',            icon: 'people',        example: 'Шаблон CRM' },
  { value: 'audit',            label: 'Аудит',                   icon: 'fact_check',    example: 'Шаблон аудита' },
  { value: 'other',            label: 'Другое',                  icon: 'folder',        example: '' },
]

const STATUS_CONFIG: Record<ParseStatus, { label: string; color: string; icon: string }> = {
  queued:     { label: 'В очереди',   color: 'text-on-surface-variant', icon: 'schedule' },
  processing: { label: 'Обработка',   color: 'text-amber-400',          icon: 'autorenew' },
  parsed:     { label: 'Обработан',   color: 'text-primary',            icon: 'check_circle' },
  error:      { label: 'Ошибка',      color: 'text-error',              icon: 'error' },
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function pluralFields(n: number): string {
  const last = n % 10
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 14) return 'параметров'
  if (last === 1) return 'параметр'
  if (last >= 2 && last <= 4) return 'параметра'
  return 'параметров'
}

const ACCEPTED = '.pdf,.xlsx,.csv,.docx,.pptx'
const MAX_SIZE = 50 * 1024 * 1024

export default function DocumentsPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [pending, setPending] = useState<PendingFile | null>(null)
  const [uploaded, setUploaded] = useState<UploadedDoc[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reprocessingIds, setReprocessingIds] = useState<Set<string>>(new Set())
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

  const reprocess = useCallback(async (docId: string) => {
    setReprocessingIds(prev => new Set(prev).add(docId))
    try {
      await fetch(`/api/v1/onboarding/documents/${docId}/process`, { method: 'POST' })
    } catch {}
    // Refresh shortly after — parse_status will flip to processing immediately,
    // then polling picks up parsed/error when the route returns.
    setTimeout(() => {
      setReprocessingIds(prev => {
        const next = new Set(prev)
        next.delete(docId)
        return next
      })
      fetchDocs()
    }, 600)
  }, [fetchDocs])

  useEffect(() => {
    if (!userId) return
    fetchDocs()
    const interval = setInterval(fetchDocs, 10_000)
    return () => clearInterval(interval)
  }, [userId, fetchDocs])

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
      const ext = pending.file.name.split('.').pop()
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

      setPending(null)
      await fetchDocs()

      // Primary trigger: inline server-side processing. Fire-and-forget — the
      // server route runs the parse in its own invocation; the UI polls for
      // status updates every 10s.
      if (result.data?.id) {
        fetch(`/api/v1/onboarding/documents/${result.data.id}/process`, {
          method: 'POST',
        }).catch(() => {})
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
            <button onClick={() => { document.cookie = 'aistart360_role=; path=/; max-age=0'; window.location.href = '/login' }}
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
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Шаг 7 — Документы</p>
          <h1 className="font-headline text-2xl font-extrabold text-on-surface mb-1">Загрузите финансовые документы</h1>
          <p className="text-sm text-on-surface-variant">AI-система проанализирует ваши отчёты и дополнит диагностику реальными данными</p>
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
                onChange={e => setPending(p => p ? { ...p, doc_type: e.target.value as DocType } : p)}
                className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 appearance-none"
              >
                <option value="">— Выберите тип —</option>
                {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Квартал</label>
                <select
                  value={pending.period_quarter}
                  onChange={e => setPending(p => p ? { ...p, period_quarter: e.target.value } : p)}
                  className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 appearance-none"
                >
                  <option value="">Все кварталы</option>
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
                  {[2023,2024,2025].map(y => <option key={y} value={y}>{y}</option>)}
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
                const st = STATUS_CONFIG[doc.parse_status]
                const dt = DOC_TYPES.find(d => d.value === doc.doc_type)
                const canExpand = doc.parse_status === 'parsed' || doc.parse_status === 'error'
                const isExpanded = expandedId === doc.id
                const fieldGroups = doc.parsed_data?.fields
                  ? doc.parsed_data.fields.reduce<Record<DiagnosticTab, ExtractedField[]>>((acc, f) => {
                      (acc[f.tab] ||= []).push(f)
                      return acc
                    }, {} as Record<DiagnosticTab, ExtractedField[]>)
                  : null

                return (
                  <div key={doc.id} className="bg-surface-container-low rounded-xl border border-white/[0.06] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => canExpand && setExpandedId(isExpanded ? null : doc.id)}
                      disabled={!canExpand}
                      className={`w-full flex items-center gap-3 p-4 text-left transition-colors ${
                        canExpand ? 'hover:bg-white/[0.02] cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      <span className="material-symbols-outlined text-xl text-primary">{dt?.icon ?? 'description'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-on-surface truncate">{doc.file_name}</p>
                        <p className="text-xs text-on-surface-variant">
                          {dt?.label} {doc.period_quarter && `· ${doc.period_quarter}`} {doc.period_year && `${doc.period_year}`}
                          {doc.file_size && ` · ${formatBytes(doc.file_size)}`}
                        </p>
                      </div>
                      <div className={`flex items-center gap-1 ${st.color}`}>
                        <span className={`material-symbols-outlined text-sm ${doc.parse_status === 'processing' ? 'animate-spin' : ''}`}>{st.icon}</span>
                        <span className="text-xs font-mono">{st.label}</span>
                      </div>
                      {doc.parse_status !== 'processing' && (
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="Переобработать файл"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!reprocessingIds.has(doc.id)) reprocess(doc.id)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              e.stopPropagation()
                              if (!reprocessingIds.has(doc.id)) reprocess(doc.id)
                            }
                          }}
                          className={`text-[10px] font-mono px-2 py-1 rounded-lg border transition-all ${
                            reprocessingIds.has(doc.id)
                              ? 'border-white/[0.08] text-on-surface-variant/60 cursor-not-allowed'
                              : 'border-primary/30 text-primary hover:bg-primary/10 cursor-pointer'
                          }`}
                        >
                          {reprocessingIds.has(doc.id) ? '...' : 'Переобработать'}
                        </span>
                      )}
                      {canExpand && (
                        <span
                          className={`material-symbols-outlined text-base text-on-surface-variant transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        >
                          expand_more
                        </span>
                      )}
                    </button>

                    {canExpand && isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-white/[0.04] space-y-4">
                        {doc.parse_status === 'error' && (
                          <div className="bg-error/10 border border-error/20 rounded-xl px-4 py-3">
                            <p className="text-xs font-mono text-error uppercase tracking-widest mb-1">Ошибка обработки</p>
                            <p className="text-sm text-on-surface">{doc.parse_error ?? 'Неизвестная ошибка'}</p>
                            <p className="text-[11px] text-on-surface-variant mt-2">
                              Нажмите «Переобработать» в строке файла, чтобы попробовать ещё раз.
                            </p>
                          </div>
                        )}

                        {!doc.parsed_data && doc.parse_status === 'parsed' && (
                          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
                            <p className="text-xs font-mono text-amber-300 uppercase tracking-widest mb-1">Нет данных в БД</p>
                            <p className="text-sm text-on-surface/90">
                              Файл помечен как обработанный, но <code className="text-amber-300">parsed_data</code> пуст — скорее всего, обработан старым пайплайном (n8n) до выкатки нового парсера. Нажмите «Переобработать», чтобы прогнать через новый Claude-экстрактор.
                            </p>
                          </div>
                        )}

                        {doc.parsed_data?.summary && (
                          <div>
                            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1.5">Резюме документа</p>
                            <p className="text-sm text-on-surface/90 leading-relaxed">{doc.parsed_data.summary}</p>
                          </div>
                        )}

                        {fieldGroups && Object.keys(fieldGroups).length > 0 && (
                          <div className="space-y-3">
                            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
                              Извлечённые данные · {doc.parsed_data!.fields.length} {pluralFields(doc.parsed_data!.fields.length)}
                            </p>
                            {(Object.entries(fieldGroups) as [DiagnosticTab, ExtractedField[]][]).map(([tab, fields]) => {
                              const meta = TAB_META[tab]
                              return (
                                <div key={tab} className="bg-surface-container rounded-xl border border-white/[0.04] p-3">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className={`material-symbols-outlined text-base ${meta.color}`}>{meta.icon}</span>
                                    <span className="text-xs font-mono uppercase tracking-widest text-on-surface">
                                      Вкладка: {meta.label}
                                    </span>
                                    <span className="text-[10px] font-mono text-on-surface-variant ml-auto">
                                      {fields.length} {pluralFields(fields.length)}
                                    </span>
                                  </div>
                                  <ul className="space-y-2">
                                    {fields.map((f, i) => (
                                      <li key={`${f.key}-${i}`} className="border-l-2 border-white/[0.06] pl-3">
                                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                          <span className="text-xs font-mono text-on-surface-variant">{f.parameter}:</span>
                                          <span className="text-sm font-semibold text-on-surface">{f.value}</span>
                                          <span className="text-[10px] font-mono text-on-surface-variant/60 ml-auto">
                                            {Math.round(f.confidence * 100)}%
                                          </span>
                                        </div>
                                        {f.source_excerpt && (
                                          <p className="text-[11px] text-on-surface-variant/80 mt-1 italic line-clamp-2">
                                            «{f.source_excerpt}»
                                          </p>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {doc.parsed_data && (!doc.parsed_data.fields || doc.parsed_data.fields.length === 0) && doc.parse_status === 'parsed' && (
                          <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl px-4 py-3">
                            <p className="text-[11px] text-on-surface-variant">
                              Структурированные параметры не извлечены. Возможные причины: документ не содержит бизнес-цифр, либо <code>ANTHROPIC_API_KEY</code> не задан в окружении. Текст файла прочитан — см. ниже.
                            </p>
                          </div>
                        )}

                        {doc.parsed_data?.raw_text_preview && (
                          <details className="bg-surface-container/60 rounded-xl border border-white/[0.04] open:pb-3">
                            <summary className="cursor-pointer px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-on-surface-variant hover:text-on-surface select-none">
                              Сырой текст из файла ({doc.parsed_data.raw_text_preview.length} симв.)
                            </summary>
                            <pre className="text-[11px] text-on-surface-variant/90 leading-relaxed mt-1 px-3 whitespace-pre-wrap break-words max-h-64 overflow-auto">
{doc.parsed_data.raw_text_preview}
                            </pre>
                          </details>
                        )}

                        {doc.parsed_data && (doc.parsed_data.extracted_at || doc.parsed_data.model_used) && (
                          <p className="text-[10px] font-mono text-on-surface-variant/50">
                            {doc.parsed_data.model_used && <>модель: {doc.parsed_data.model_used} · </>}
                            {doc.parsed_data.extracted_at && <>обработано: {new Date(doc.parsed_data.extracted_at).toLocaleString('ru-RU')}</>}
                          </p>
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
