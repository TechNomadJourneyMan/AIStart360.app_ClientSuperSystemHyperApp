'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type DocType = 'pl_report' | 'balance_sheet' | 'marketing_report' | 'ops_report' | 'crm_export' | 'audit' | 'patient_base' | 'other'
type ParseStatus = 'queued' | 'processing' | 'parsed' | 'completed' | 'failed' | 'error'

interface AiStep {
  name: string
  status?: string
  duration_ms?: number
  meta?: Record<string, unknown>
}

interface AiRunSummary {
  id: string
  status: string
  backbone: string | null
  cost_usd: number
  steps: AiStep[]
  duration_ms: number
  started_at: string | null
  finished_at: string | null
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
  ai_run?: AiRunSummary | null
  extracted_entities?: number
  patient_segments_total?: number
}

interface PendingFile {
  file: File
  doc_type: DocType | ''
  period_quarter: string
  period_year: string
}

const DOC_TYPES: { value: DocType; label: string; icon: string; example: string; templateUrl?: string }[] = [
  { value: 'pl_report',        label: 'P&L (Отчёт о прибыли)',  icon: 'receipt_long',  example: 'Шаблон P&L',          templateUrl: '/templates/pl_report.csv' },
  { value: 'balance_sheet',    label: 'Баланс',                  icon: 'account_balance',example: 'Шаблон баланса',      templateUrl: '/templates/balance_sheet.csv' },
  { value: 'marketing_report', label: 'Маркетинговый отчёт',     icon: 'campaign',      example: 'Шаблон маркетинга',   templateUrl: '/templates/marketing_report.csv' },
  { value: 'ops_report',       label: 'Операционный отчёт',      icon: 'settings',      example: 'Шаблон операций',     templateUrl: '/templates/ops_report.csv' },
  { value: 'crm_export',       label: 'CRM-выгрузка',            icon: 'people',        example: 'Шаблон CRM',          templateUrl: '/templates/crm_export.csv' },
  { value: 'audit',            label: 'Аудит',                   icon: 'fact_check',    example: 'Шаблон аудита',       templateUrl: '/templates/audit.csv' },
  { value: 'patient_base',     label: 'База пациентов',          icon: 'groups',        example: '' },
  { value: 'other',            label: 'Другое',                  icon: 'folder',        example: '' },
]

const STATUS_CONFIG: Record<ParseStatus, { label: string; color: string; icon: string }> = {
  queued:     { label: 'В очереди',   color: 'text-on-surface-variant', icon: 'schedule' },
  processing: { label: 'Обработка',   color: 'text-amber-400',          icon: 'autorenew' },
  parsed:     { label: 'Обработан',   color: 'text-primary',            icon: 'check_circle' },
  completed:  { label: 'Обработан',   color: 'text-primary',            icon: 'check_circle' },
  error:      { label: 'Ошибка',      color: 'text-error',              icon: 'error' },
  failed:     { label: 'Ошибка',      color: 'text-error',              icon: 'error' },
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [aiSuggestion, setAiSuggestion] = useState<{ type: DocType; confidence: number; reasoning: string } | null>(null)
  const [classifying, setClassifying] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

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

  useEffect(() => {
    if (!userId) return
    fetchDocs()
    const interval = setInterval(fetchDocs, 10_000)
    return () => clearInterval(interval)
  }, [userId, fetchDocs])

  /** Read a small text excerpt from the file for AI classification.
      For CSV/TXT — plain text. For XLSX/DOCX/PDF/PPTX — skip (binary) and
      let server classify from filename + mime only. */
  async function readExcerpt(file: File): Promise<string> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'csv' || ext === 'txt') {
      try {
        const text = await file.slice(0, 2048).text()
        return text
      } catch {
        return ''
      }
    }
    return ''
  }

  /** Ask Haiku (server-side) to suggest doc_type. Silently noop on any error. */
  async function classifyDocType(file: File) {
    setClassifying(true)
    setAiSuggestion(null)
    try {
      const textExcerpt = await readExcerpt(file)
      const res = await fetch('/api/ai/classify-doc-type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          textExcerpt,
        }),
      })
      const data = await res.json() as { ok: boolean; suggestedType?: DocType; confidence?: number; reasoning?: string }
      if (data.ok && data.suggestedType && typeof data.confidence === 'number') {
        setAiSuggestion({
          type: data.suggestedType,
          confidence: data.confidence,
          reasoning: data.reasoning ?? '',
        })
        // Auto-fill dropdown only if confident
        if (data.confidence >= 0.7) {
          setPending(p => (p ? { ...p, doc_type: data.suggestedType! } : p))
        }
      }
    } catch {
      // silent
    } finally {
      setClassifying(false)
    }
  }

  const handleFile = (file: File) => {
    setUploadError(null)
    setAiSuggestion(null)
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
    // Fire classification in background — no await, UI stays responsive.
    void classifyDocType(file)
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
      const ext = pending.file.name.split('.').pop()?.toLowerCase() ?? 'bin'
      // Supabase Storage S3 API rejects keys with non-ASCII / spaces.
      // Sanitize: strip ext, replace non-safe chars with _, collapse, cap length.
      const safeName = pending.file.name
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .substring(0, 50) || 'file'
      const path = `${userId}/${Date.now()}_${safeName}.${ext}`

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
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider">Тип документа *</label>
                {classifying && (
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-primary">
                    <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                    AI анализирует…
                  </span>
                )}
                {!classifying && aiSuggestion && (
                  <span
                    className={`inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                      aiSuggestion.confidence >= 0.7
                        ? 'bg-primary/10 border-primary/30 text-primary'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    }`}
                    title={aiSuggestion.reasoning}
                  >
                    <span className="material-symbols-outlined text-[12px]">{aiSuggestion.confidence >= 0.7 ? 'check_circle' : 'help'}</span>
                    {aiSuggestion.confidence >= 0.7 ? 'AI определил' : 'AI предполагает'}: {DOC_TYPES.find(d => d.value === aiSuggestion.type)?.label ?? aiSuggestion.type} · {Math.round(aiSuggestion.confidence * 100)}%
                  </span>
                )}
              </div>
              <select
                value={pending.doc_type}
                onChange={e => setPending(p => p ? { ...p, doc_type: e.target.value as DocType } : p)}
                className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 appearance-none"
              >
                <option value="">— Выберите тип —</option>
                {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              {!classifying && aiSuggestion && aiSuggestion.confidence < 0.7 && pending.doc_type !== aiSuggestion.type && (
                <button
                  type="button"
                  onClick={() => setPending(p => p ? { ...p, doc_type: aiSuggestion.type } : p)}
                  className="text-[11px] text-primary hover:underline mt-1.5 inline-flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[12px]">auto_fix</span>
                  Применить AI-подсказку
                </button>
              )}
              {!classifying && aiSuggestion && (
                <p className="text-[10px] text-on-surface-variant/70 mt-1.5 italic">{aiSuggestion.reasoning}</p>
              )}
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
            {DOC_TYPES.filter(d => d.example && d.templateUrl).map(d => (
              <a
                key={d.value}
                href={d.templateUrl}
                download={d.templateUrl?.split('/').pop()}
                className="flex items-center gap-2 bg-surface-container-low rounded-xl border border-white/[0.06] p-3 hover:border-primary/30 hover:bg-white/[0.02] transition-all"
              >
                <span className={`material-symbols-outlined text-base text-primary`}>{d.icon}</span>
                <span className="text-xs text-on-surface flex-1">{d.label}</span>
                <span className="material-symbols-outlined text-sm text-primary">download</span>
              </a>
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
                const st = STATUS_CONFIG[doc.parse_status] ?? { label: doc.parse_status, color: 'text-on-surface-variant', icon: 'help' }
                const dt = DOC_TYPES.find(d => d.value === doc.doc_type)
                const isOpen = expanded.has(doc.id)
                const ai = doc.ai_run
                const hasDetails = ai || (doc.extracted_entities ?? 0) > 0 || typeof doc.patient_segments_total === 'number'
                return (
                  <div key={doc.id} className="bg-surface-container-low rounded-xl border border-white/[0.06] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => hasDetails && toggleExpanded(doc.id)}
                      className={`w-full flex items-center gap-3 p-4 text-left ${hasDetails ? 'hover:bg-white/[0.02] cursor-pointer' : 'cursor-default'}`}
                    >
                      <span className={`material-symbols-outlined text-xl text-primary`}>{dt?.icon ?? 'description'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-on-surface truncate">{doc.file_name}</p>
                        <p className="text-xs text-on-surface-variant">
                          {dt?.label ?? doc.doc_type} {doc.period_quarter && `· ${doc.period_quarter}`} {doc.period_year && `${doc.period_year}`}
                          {doc.file_size && ` · ${formatBytes(doc.file_size)}`}
                        </p>
                      </div>
                      <div className={`flex items-center gap-1 ${st.color}`}>
                        <span className={`material-symbols-outlined text-sm ${doc.parse_status === 'processing' ? 'animate-spin' : ''}`}>{st.icon}</span>
                        <span className="text-xs font-mono">{st.label}</span>
                      </div>
                      {hasDetails && (
                        <span className={`material-symbols-outlined text-sm text-on-surface-variant transition-transform ${isOpen ? 'rotate-180' : ''}`}>expand_more</span>
                      )}
                    </button>

                    {isOpen && hasDetails && (
                      <div className="border-t border-white/[0.06] bg-black/20 px-4 py-3 space-y-2 text-xs">
                        {ai && (
                          <>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-on-surface-variant">
                              <span>AI run: <span className="text-on-surface font-mono">{ai.status}</span></span>
                              {ai.backbone && <span>backbone: <span className="font-mono">{ai.backbone}</span></span>}
                              {ai.duration_ms > 0 && <span>длительность: <span className="font-mono">{(ai.duration_ms / 1000).toFixed(1)}s</span></span>}
                              {ai.cost_usd > 0 && <span>cost: <span className="font-mono">${ai.cost_usd.toFixed(4)}</span></span>}
                            </div>
                            {ai.steps.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-on-surface-variant text-[10px] uppercase tracking-wider">Pipeline steps</p>
                                {ai.steps.map((step, i) => (
                                  <div key={i} className="flex items-center gap-2 font-mono">
                                    <span className={`material-symbols-outlined text-[14px] ${step.status === 'completed' ? 'text-primary' : step.status === 'failed' ? 'text-error' : 'text-on-surface-variant'}`}>
                                      {step.status === 'completed' ? 'check_circle' : step.status === 'failed' ? 'error' : 'schedule'}
                                    </span>
                                    <span className="text-on-surface">{step.name}</span>
                                    {step.duration_ms != null && <span className="text-on-surface-variant ml-auto">{step.duration_ms}ms</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-on-surface-variant pt-2 border-t border-white/[0.04]">
                          {(doc.extracted_entities ?? 0) > 0 && (
                            <span>извлечено сущностей: <span className="text-on-surface font-mono">{doc.extracted_entities}</span></span>
                          )}
                          {typeof doc.patient_segments_total === 'number' && (
                            <span>RFM сегментов: <span className="text-on-surface font-mono">{doc.patient_segments_total}</span></span>
                          )}
                        </div>

                        {doc.doc_type === 'patient_base' && (doc.patient_segments_total ?? 0) > 0 && (
                          <a href="/client/dashboard-medical" className="inline-flex items-center gap-1 text-primary hover:underline mt-1">
                            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                            Открыть кабинет клиники
                          </a>
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
