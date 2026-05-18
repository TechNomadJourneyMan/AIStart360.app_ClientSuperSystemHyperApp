'use client'

/**
 * UniversalIntake — single drop zone + free-form textarea.
 * Submits to /api/ai/intake; renders per-item routing result.
 *
 * Upload flow: files go directly browser → Supabase Storage (bucket
 * 'client-documents'), then a JSON manifest with metadata is POSTed
 * to /api/ai/intake. This bypasses Vercel's 4.5 MB serverless body
 * limit that previously caused 413 → "Unexpected token R, Request En…
 * is not valid JSON" crashes on multi-MB xlsx uploads.
 */

import { useCallback, useRef, useState } from 'react'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'

interface UploadedFileManifest {
  fileName: string
  storagePath: string
  size: number
  mimeType: string
}

function sanitizeStem(name: string): { stem: string; ext: string } {
  const ext = (name.split('.').pop() ?? 'bin').toLowerCase()
  const stem = name.replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 50) || 'file'
  return { stem, ext }
}

type DocType =
  | 'pl_report' | 'balance_sheet' | 'marketing_report' | 'ops_report'
  | 'crm_export' | 'audit' | 'patient_base' | 'other'

const DOC_LABELS: Record<DocType, string> = {
  pl_report: 'P&L (прибыль)',
  balance_sheet: 'Баланс',
  marketing_report: 'Маркетинг',
  ops_report: 'Операции',
  crm_export: 'CRM-выгрузка',
  audit: 'Аудит',
  patient_base: 'База пациентов',
  other: 'Другое',
}

const BLOCK_LABELS: Record<string, string> = {
  finance: 'Финансы',
  sales: 'Продажи',
  marketing: 'Маркетинг',
  operations: 'Операции',
  strategy: 'Стратегия',
}

interface FileResult {
  fileName: string
  ok: boolean
  doc_type?: DocType
  confidence?: number
  document_id?: string
  ai_run_id?: string
  error?: string
}

interface TextResult {
  ok: boolean
  block?: string
  category?: string
  summary?: string
  confidence?: number
  error?: string
}

interface IntakeResponse {
  ok: boolean
  files: FileResult[]
  text: TextResult | null
  summary: { files_total: number; files_ok: number; text_routed: boolean }
}

const ACCEPTED = '.pdf,.xlsx,.csv,.docx,.pptx,.txt'
const MAX_FILE_SIZE = 50 * 1024 * 1024
const MAX_FILES = 20

export function UniversalIntake({ companyId }: { companyId?: string | null }) {
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<IntakeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles)
    setError(null)
    const filtered: File[] = []
    for (const f of arr) {
      if (f.size > MAX_FILE_SIZE) {
        setError(`Файл "${f.name}" больше 50МБ`)
        continue
      }
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      if (!['pdf', 'xlsx', 'csv', 'docx', 'pptx', 'txt'].includes(ext)) {
        setError(`Формат "${ext}" не поддерживается`)
        continue
      }
      filtered.push(f)
    }
    setFiles((prev) => {
      const combined = [...prev, ...filtered]
      return combined.slice(0, MAX_FILES)
    })
  }, [])

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx))

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files)
  }

  const submit = async () => {
    if (files.length === 0 && !text.trim()) {
      setError('Добавьте файлы или текст')
      return
    }
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const sb = createSupabaseClient()
      const { data: userData, error: userErr } = await sb.auth.getUser()
      if (userErr || !userData.user) {
        setError('Нужно войти в систему, чтобы загружать файлы')
        setSubmitting(false)
        return
      }
      const userId = userData.user.id

      // Upload each file directly to Storage so we never push >4.5 MB
      // through the Vercel serverless function.
      const uploaded: UploadedFileManifest[] = []
      for (const f of files) {
        const { stem, ext } = sanitizeStem(f.name)
        const path = `${userId}/${Date.now()}_${stem}.${ext}`
        const { error: upErr } = await sb.storage
          .from('client-documents')
          .upload(path, f, {
            contentType: f.type || 'application/octet-stream',
            upsert: false,
          })
        if (upErr) {
          setError(`Не удалось загрузить "${f.name}": ${upErr.message}`)
          setSubmitting(false)
          return
        }
        uploaded.push({
          fileName: f.name,
          storagePath: path,
          size: f.size,
          mimeType: f.type || '',
        })
      }

      const body: { files: UploadedFileManifest[]; text?: string; companyId?: string } = {
        files: uploaded,
      }
      if (text.trim()) body.text = text
      if (companyId) body.companyId = companyId

      const res = await fetch('/api/ai/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      // Defensive: 413 / 500 from Vercel's edge often return plain text
      // ("Request Entity Too Large", HTML error page, etc.). Parsing as
      // JSON would throw "Unexpected token R, Request En… is not valid
      // JSON" with no useful info. Detect non-JSON and surface raw text.
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        const raw = await res.text()
        throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200) || 'no body'}`)
      }

      const data = await res.json() as IntakeResponse | { error: string }
      if ('error' in data) {
        setError(data.error)
      } else {
        setResult(data)
        setFiles([])
        setText('')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка отправки')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-primary/[0.04] to-blue-500/[0.04] border border-primary/15 p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-primary">auto_awesome</span>
          <h2 className="font-headline text-lg font-bold text-on-surface">Загрузка через AI</h2>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
            AI авто-маршрутизация
          </span>
        </div>
        <p className="text-xs text-on-surface-variant mb-4 leading-relaxed">
          Закинь любые файлы (P&L, CRM, отчёты, базу клиентов) и/или впиши данные текстом —
          AI определит тип каждого, разложит по блокам и обновит метрики на дашборде.
        </p>

        {/* Drop zone */}
        <div
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onClick={() => inputRef.current?.click()}
          className={`rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-all ${
            dragging
              ? 'border-primary bg-primary/10'
              : 'border-white/[0.10] bg-surface-container-low hover:border-primary/40 hover:bg-surface-container'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED}
            onChange={onFileInput}
            className="hidden"
          />
          <span className="material-symbols-outlined text-3xl text-primary/70 mb-1">cloud_upload</span>
          <p className="text-sm text-on-surface font-medium">
            {dragging ? 'Отпусти — добавлю' : 'Перетащи файлы или кликни'}
          </p>
          <p className="text-[11px] text-on-surface-variant mt-1">
            PDF / XLSX / CSV / DOCX / PPTX / TXT · до 50МБ · до {MAX_FILES} штук
          </p>
        </div>

        {/* Selected files */}
        {files.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">
              Выбрано: {files.length}
            </p>
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 bg-surface-container rounded-lg border border-white/[0.04] px-3 py-2">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">draft</span>
                <span className="text-xs text-on-surface truncate flex-1">{f.name}</span>
                <span className="text-[10px] font-mono text-on-surface-variant">
                  {f.size < 1_048_576 ? `${Math.round(f.size / 1024)}KB` : `${(f.size / 1_048_576).toFixed(1)}MB`}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                  className="w-6 h-6 rounded-md hover:bg-error/15 text-on-surface-variant hover:text-error inline-flex items-center justify-center"
                  aria-label="Удалить"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Text */}
        <div className="mt-4">
          <label className="block text-[10px] font-mono text-on-surface-variant uppercase tracking-wider mb-2">
            Или впиши данные текстом
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Например: "В августе выручка 4.5M, прибыль 0.8M, маржа 18%. CAC 7500₸, лучший канал — Google Ads."'
            rows={3}
            className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-none"
          />
          <p className="text-[10px] text-on-surface-variant/70 mt-1">{text.length}/8000 символов</p>
        </div>

        {error && (
          <div className="mt-3 rounded-lg bg-error/10 border border-error/30 px-3 py-2 text-xs text-error">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={() => void submit()}
          disabled={submitting || (files.length === 0 && !text.trim())}
          className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-primary text-on-primary px-5 py-3 rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {submitting ? (
            <>
              <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
              Обрабатываем…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-base">auto_fix</span>
              Загрузить и обработать через AI
            </>
          )}
        </button>
        <p className="text-[10px] text-on-surface-variant/60 mt-2 text-center font-mono">
          AI классифицирует через Haiku (~$0.0001/файл) · текст через Sonnet (~$0.005/заметку)
        </p>
      </div>

      {/* Result summary */}
      {result && (
        <div className="rounded-2xl bg-surface-container-low border border-primary/20 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">check_circle</span>
            <h3 className="font-headline text-base font-bold text-on-surface">
              Загружено: {result.summary.files_ok}/{result.summary.files_total} файлов
              {result.summary.text_routed && ' + текст'}
            </h3>
          </div>

          {result.files.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">Файлы</p>
              {result.files.map((f, i) => (
                <div key={i} className={`rounded-lg p-3 border ${f.ok ? 'bg-primary/[0.04] border-primary/20' : 'bg-error/[0.06] border-error/25'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={`material-symbols-outlined text-[18px] ${f.ok ? 'text-primary' : 'text-error'}`}>
                        {f.ok ? 'check_circle' : 'error'}
                      </span>
                      <span className="text-xs text-on-surface truncate">{f.fileName}</span>
                    </div>
                    {f.doc_type && (
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full whitespace-nowrap ${
                        (f.confidence ?? 0) >= 0.7
                          ? 'bg-primary/15 text-primary border border-primary/30'
                          : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                      }`}>
                        {DOC_LABELS[f.doc_type]} · {Math.round((f.confidence ?? 0) * 100)}%
                      </span>
                    )}
                  </div>
                  {f.error && <p className="text-[10px] text-error mt-1">{f.error}</p>}
                </div>
              ))}
            </div>
          )}

          {result.text && (
            <div className="space-y-2">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">Текст</p>
              <div className={`rounded-lg p-3 border ${result.text.ok ? 'bg-blue-500/[0.06] border-blue-500/25' : 'bg-error/[0.06] border-error/25'}`}>
                {result.text.ok ? (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="material-symbols-outlined text-[18px] text-blue-300">notes</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                        Блок: {result.text.block ? BLOCK_LABELS[result.text.block] ?? result.text.block : '—'}
                      </span>
                      <span className="text-[10px] font-mono text-on-surface-variant">
                        {result.text.category} · {Math.round((result.text.confidence ?? 0) * 100)}%
                      </span>
                    </div>
                    <p className="text-xs text-on-surface italic leading-relaxed">{result.text.summary}</p>
                  </>
                ) : (
                  <p className="text-xs text-error">{result.text.error ?? 'Ошибка обработки текста'}</p>
                )}
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-white/[0.04] flex flex-wrap gap-2 text-[11px]">
            <a href="/dashboard" className="text-primary hover:underline inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">dashboard</span>
              Открыть дашборд
            </a>
            <span className="text-on-surface-variant/40">·</span>
            <a href="/point-a" className="text-primary hover:underline inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">radar</span>
              Точка А
            </a>
            <span className="text-on-surface-variant/40">·</span>
            <a href="/gri" className="text-primary hover:underline inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">psychology</span>
              GRI стратегия
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
