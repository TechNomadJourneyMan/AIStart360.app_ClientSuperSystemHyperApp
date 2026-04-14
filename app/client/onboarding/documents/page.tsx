'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useTranslations } from 'next-intl'

type DocType = 'pl_report' | 'balance_sheet' | 'marketing_report' | 'ops_report' | 'crm_export' | 'audit' | 'other'
type ParseStatus = 'queued' | 'processing' | 'parsed' | 'error'

interface UploadedDoc {
  id: string
  file_name: string
  doc_type: DocType
  period_quarter: string | null
  period_year: number | null
  parse_status: ParseStatus
  uploaded_at: string
  file_size: number | null
}

interface PendingFile {
  file: File
  doc_type: DocType | ''
  period_quarter: string
  period_year: string
}

const DOC_TYPES: { value: DocType; label: string; icon: string; example: string }[] = [
  { value: 'pl_report',        label: 'plReport',  icon: 'receipt_long',  example: 'plTemplate' },
  { value: 'balance_sheet',    label: 'balance',                  icon: 'account_balance',example: 'balanceTemplate' },
  { value: 'marketing_report', label: 'marketingReport',     icon: 'campaign',      example: 'marketingTemplate' },
  { value: 'ops_report',       label: 'opsReport',      icon: 'settings',      example: 'opsTemplate' },
  { value: 'crm_export',       label: 'crmExport',            icon: 'people',        example: 'crmTemplate' },
  { value: 'audit',            label: 'audit',                   icon: 'fact_check',    example: 'auditTemplate' },
  { value: 'other',            label: 'other',                  icon: 'folder',        example: '' },
]

const STATUS_CONFIG: Record<ParseStatus, { label: string; color: string; icon: string }> = {
  queued:     { label: 'statusQueued',   color: 'text-on-surface-variant', icon: 'schedule' },
  processing: { label: 'statusProcessing',   color: 'text-amber-400',          icon: 'autorenew' },
  parsed:     { label: 'statusParsed',   color: 'text-primary',            icon: 'check_circle' },
  error:      { label: 'statusError',      color: 'text-error',              icon: 'error' },
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const ACCEPTED = '.pdf,.xlsx,.csv,.docx,.pptx'
const MAX_SIZE = 50 * 1024 * 1024

export default function DocumentsPage() {
  const t = useTranslations('documents')
  const [userId, setUserId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [pending, setPending] = useState<PendingFile | null>(null)
  const [uploaded, setUploaded] = useState<UploadedDoc[]>([])
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

  useEffect(() => {
    if (!userId) return
    fetchDocs()
    const interval = setInterval(fetchDocs, 10_000)
    return () => clearInterval(interval)
  }, [userId, fetchDocs])

  const handleFile = (file: File) => {
    setUploadError(null)
    if (file.size > MAX_SIZE) {
      setUploadError(t('fileTooLarge'))
      return
    }
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['pdf','xlsx','csv','docx','pptx'].includes(ext ?? '')) {
      setUploadError(t('unsupportedFormat'))
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
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : t('uploadError'))
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
            <span className="text-xs font-mono text-on-surface-variant">{t('headerTitle')}</span>
            <button onClick={() => { document.cookie = 'aistart360_role=; path=/; max-age=0'; window.location.href = '/login' }}
              className="text-xs text-red-400/70 hover:text-red-400 flex items-center gap-1 border border-red-500/10 px-2 py-1 rounded-lg transition-all">
              <span className="material-symbols-outlined text-sm">logout</span>
              {t('logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Title */}
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">{t('stepDocuments')}</p>
          <h1 className="font-headline text-2xl font-extrabold text-on-surface mb-1">{t('uploadFinancialDocs')}</h1>
          <p className="text-sm text-on-surface-variant">{t('aiAnalysisDesc')}</p>
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
              {isDragging ? t('dropFileHere') : t('dragOrClick')}
            </p>
            <p className="text-xs text-on-surface-variant">{t('maxFileSize')}</p>
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
              <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">{t('docTypeRequired')}</label>
              <select
                value={pending.doc_type}
                onChange={e => setPending(p => p ? { ...p, doc_type: e.target.value as DocType } : p)}
                className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 appearance-none"
              >
                <option value="">{t('selectType')}</option>
                {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{t(d.label)}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">{t('quarter')}</label>
                <select
                  value={pending.period_quarter}
                  onChange={e => setPending(p => p ? { ...p, period_quarter: e.target.value } : p)}
                  className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 appearance-none"
                >
                  <option value="">{t('allQuarters')}</option>
                  {['Q1','Q2','Q3','Q4'].map(q => <option key={q} value={q}>{q}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">{t('year')}</label>
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
                {t('cancel')}
              </button>
              <button
                onClick={uploadFile}
                disabled={isUploading || !pending.doc_type}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-all"
              >
                {isUploading ? (
                  <><span className="w-4 h-4 border-2 border-[#003824]/30 border-t-[#003824] rounded-full animate-spin" />{t('uploading')}</>
                ) : (
                  <><span className="material-symbols-outlined text-lg">upload</span>{t('upload')}</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Document type templates */}
        <div>
          <h2 className="text-xs font-mono text-on-surface-variant uppercase tracking-widest mb-3">{t('templateExamples')}</h2>
          <div className="grid grid-cols-2 gap-2">
            {DOC_TYPES.filter(d => d.example).map(d => (
              <div key={d.value} className="flex items-center gap-2 bg-surface-container-low rounded-xl border border-white/[0.06] p-3">
                <span className={`material-symbols-outlined text-base text-primary`}>{d.icon}</span>
                <span className="text-xs text-on-surface flex-1">{t(d.label)}</span>
                <span className="material-symbols-outlined text-xs text-on-surface-variant/40">download</span>
              </div>
            ))}
          </div>
        </div>

        {/* Uploaded documents */}
        {uploaded.length > 0 && (
          <div>
            <h2 className="text-xs font-mono text-on-surface-variant uppercase tracking-widest mb-3">
              {t('uploaded')} ({uploaded.length})
            </h2>
            <div className="space-y-2">
              {uploaded.map(doc => {
                const st = STATUS_CONFIG[doc.parse_status]
                const dt = DOC_TYPES.find(d => d.value === doc.doc_type)
                return (
                  <div key={doc.id} className="flex items-center gap-3 bg-surface-container-low rounded-xl border border-white/[0.06] p-4">
                    <span className={`material-symbols-outlined text-xl text-primary`}>{dt?.icon ?? 'description'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-on-surface truncate">{doc.file_name}</p>
                      <p className="text-xs text-on-surface-variant">
                        {dt?.label ? t(dt.label) : ''} {doc.period_quarter && `· ${doc.period_quarter}`} {doc.period_year && `${doc.period_year}`}
                        {doc.file_size && ` · ${formatBytes(doc.file_size)}`}
                      </p>
                    </div>
                    <div className={`flex items-center gap-1 ${st.color}`}>
                      <span className={`material-symbols-outlined text-sm ${doc.parse_status === 'processing' ? 'animate-spin' : ''}`}>{st.icon}</span>
                      <span className="text-xs font-mono">{t(st.label)}</span>
                    </div>
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
            {'\u2190 '}{t('backToSurvey')}
          </Link>
          <Link href="/client/point-a"
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm text-center transition-all hover:scale-[0.99]">
            {t('goToDiagnostics')}{' \u2192'}
          </Link>
        </div>
      </main>
    </div>
  )
}
