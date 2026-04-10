'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface DocFile {
  id: string
  file_name: string
  file_url: string
  file_size: number | null
  mime_type: string | null
  doc_type: string
  parse_status: string | null
  uploaded_at: string
}

const ACCEPTED_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
}

const ACCEPT_STRING = Object.values(ACCEPTED_TYPES).flat().join(',')

const DOC_TYPE_OPTIONS = [
  { value: 'financial_report', label: 'Фин. отчёт' },
  { value: 'pl_statement',     label: 'P&L' },
  { value: 'balance_sheet',    label: 'Баланс' },
  { value: 'business_plan',    label: 'Бизнес-план' },
  { value: 'presentation',     label: 'Презентация' },
  { value: 'other',            label: 'Другое' },
]

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(mimeType: string | null): string {
  if (!mimeType) return 'description'
  if (mimeType.includes('pdf')) return 'picture_as_pdf'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'table_chart'
  if (mimeType.includes('word') || mimeType.includes('document')) return 'article'
  return 'description'
}

function fileIconColor(mimeType: string | null): string {
  if (!mimeType) return 'text-on-surface-variant'
  if (mimeType.includes('pdf')) return 'text-red-400'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'text-green-400'
  if (mimeType.includes('word') || mimeType.includes('document')) return 'text-blue-400'
  return 'text-on-surface-variant'
}

const PARSE_STATUS: Record<string, { label: string; color: string }> = {
  queued:     { label: 'В очереди',   color: 'text-on-surface-variant' },
  processing: { label: 'Анализ...',   color: 'text-amber-400' },
  done:       { label: 'Готово',      color: 'text-primary' },
  error:      { label: 'Ошибка',      color: 'text-error' },
}

interface FileAreaProps {
  userId: string
}

export function FileArea({ userId: userIdProp }: FileAreaProps) {
  const [resolvedUserId, setResolvedUserId] = useState(userIdProp)
  const [files, setFiles] = useState<DocFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [pendingFile, setPendingFile] = useState<{ file: File; docType: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // If userId not passed from server (e.g. GigaAccessGuard login), resolve client-side
  useEffect(() => {
    if (!userIdProp) {
      // 1. Try reading role cookie directly from document.cookie (non-httpOnly)
      const roleCookie = document.cookie
        .split('; ')
        .find(c => c.startsWith('aistart360_role='))
        ?.split('=')[1]
      if (roleCookie) {
        setResolvedUserId(`giga-${roleCookie}`)
        return
      }
      // 2. Try reading user_id cookie (might be non-httpOnly in some flows)
      const uidCookie = document.cookie
        .split('; ')
        .find(c => c.startsWith('aistart360_user_id='))
        ?.split('=')[1]
      if (uidCookie) {
        setResolvedUserId(uidCookie)
        return
      }
      // 3. Fallback: API call
      fetch('/api/v1/me', { credentials: 'include' })
        .then(r => r.json())
        .then(d => { if (d.userId) setResolvedUserId(d.userId) })
        .catch(() => {})
    }
  }, [userIdProp])

  const userId = resolvedUserId

  const loadFiles = useCallback(async () => {
    if (!userId) { setLoading(false); return }
    try {
      const res = await fetch(`/api/v1/onboarding/documents?user_id=${userId}`)
      const data = await res.json()
      if (data.ok) setFiles(data.data ?? [])
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { loadFiles() }, [loadFiles])

  const handleFilePick = (file: File) => {
    const validMimes = Object.keys(ACCEPTED_TYPES)
    if (!validMimes.some(m => file.type === m || file.name.match(/\.(pdf|xlsx?|csv|docx?)$/i))) {
      setError('Поддерживаются: PDF, Excel, CSV, Word')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Максимальный размер файла: 20 MB')
      return
    }
    setError(null)
    setPendingFile({ file, docType: 'financial_report' })
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFilePick(file)
  }

  const handleUpload = async () => {
    if (!pendingFile) return
    if (!userId) {
      setError('Не удалось определить пользователя. Попробуйте перезайти.')
      return
    }
    setUploading(true)
    setUploadProgress(0)
    setError(null)

    try {
      const sb = createClient()
      const ext = pendingFile.file.name.split('.').pop()
      const storagePath = `${userId}/${Date.now()}_${pendingFile.file.name}`

      setUploadProgress(20)

      const { data: uploadData, error: uploadError } = await sb.storage
        .from('documents')
        .upload(storagePath, pendingFile.file, {
          contentType: pendingFile.file.type || 'application/octet-stream',
          upsert: false,
        })

      if (uploadError) throw new Error(uploadError.message)

      setUploadProgress(70)

      const { data: { publicUrl } } = sb.storage.from('documents').getPublicUrl(storagePath)

      // Register in DB
      const res = await fetch('/api/v1/onboarding/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          file_name: pendingFile.file.name,
          file_url: publicUrl,
          file_size: pendingFile.file.size,
          mime_type: pendingFile.file.type,
          doc_type: pendingFile.docType,
        }),
      })

      const result = await res.json()
      if (!result.ok) throw new Error(result.error ?? 'Upload failed')

      setUploadProgress(100)
      setPendingFile(null)
      await loadFiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки')
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const handleDelete = async (file: DocFile) => {
    setDeletingId(file.id)
    try {
      const res = await fetch(`/api/v1/onboarding/documents/${file.id}?user_id=${userId}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (data.ok) {
        setFiles(prev => prev.filter(f => f.id !== file.id))
      } else {
        setError(data.error ?? 'Не удалось удалить файл')
      }
    } catch {
      setError('Ошибка удаления')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-headline text-lg font-bold text-on-surface">Файловая область</h2>
          <p className="text-xs text-on-surface-variant mt-0.5">PDF, Excel, CSV, Word — до 20 МБ</p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 text-sm font-mono text-[#003824] bg-gradient-to-r from-primary to-[#00e29e] px-4 py-2 rounded-xl font-bold hover:scale-[0.98] transition-all"
        >
          <span className="material-symbols-outlined text-base">upload_file</span>
          Загрузить
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_STRING}
          className="hidden"
          onChange={e => { if (e.target.files?.[0]) handleFilePick(e.target.files[0]) }}
        />
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !pendingFile && fileInputRef.current?.click()}
        className={`
          relative rounded-2xl border-2 border-dashed transition-all cursor-pointer
          ${dragOver
            ? 'border-primary/60 bg-primary/5'
            : 'border-white/[0.08] hover:border-primary/30 hover:bg-white/[0.02]'
          }
          ${pendingFile ? 'cursor-default' : ''}
          p-6
        `}
      >
        {!pendingFile ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <span className={`material-symbols-outlined text-3xl transition-colors ${dragOver ? 'text-primary' : 'text-on-surface-variant/40'}`}>
              cloud_upload
            </span>
            <p className="text-sm text-on-surface-variant">
              Перетащите файл сюда или <span className="text-primary">выберите</span>
            </p>
            <p className="text-[10px] font-mono text-on-surface-variant/50 uppercase tracking-wider">
              PDF · XLSX · CSV · DOCX
            </p>
          </div>
        ) : (
          <div className="space-y-4" onClick={e => e.stopPropagation()}>
            {/* File preview */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center flex-shrink-0">
                <span className={`material-symbols-outlined text-xl ${fileIconColor(pendingFile.file.type)}`}>
                  {fileIcon(pendingFile.file.type)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-on-surface truncate">{pendingFile.file.name}</p>
                <p className="text-[10px] text-on-surface-variant">{formatBytes(pendingFile.file.size)}</p>
              </div>
              <button
                onClick={() => setPendingFile(null)}
                className="text-on-surface-variant hover:text-error transition-colors p-1"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            {/* Doc type select */}
            <div>
              <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest block mb-1.5">
                Тип документа
              </label>
              <div className="flex flex-wrap gap-2">
                {DOC_TYPE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setPendingFile(p => p ? { ...p, docType: opt.value } : p)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      pendingFile.docType === opt.value
                        ? 'bg-primary/10 border-primary/30 text-primary'
                        : 'border-white/[0.08] text-on-surface-variant hover:border-white/[0.15]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Upload progress */}
            {uploading && (
              <div className="space-y-1.5">
                <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-[10px] font-mono text-primary">Загрузка... {uploadProgress}%</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="flex-1 flex items-center justify-center gap-2 text-sm font-mono text-[#003824] bg-gradient-to-r from-primary to-[#00e29e] px-4 py-2.5 rounded-xl font-bold hover:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {uploading ? (
                  <>
                    <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                    Загрузка...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">upload</span>
                    Загрузить
                  </>
                )}
              </button>
              <button
                onClick={() => setPendingFile(null)}
                disabled={uploading}
                className="px-4 py-2.5 rounded-xl border border-white/[0.08] text-sm text-on-surface-variant hover:bg-white/[0.04] transition-colors disabled:opacity-40"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2 bg-error/5 border border-error/20 rounded-xl px-4 py-2.5">
          <span className="material-symbols-outlined text-base text-error flex-shrink-0">error</span>
          <span className="text-xs text-error">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-error/60 hover:text-error">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      {/* File list */}
      <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
        {loading ? (
          <div className="divide-y divide-white/[0.03]">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-4">
                <div className="w-9 h-9 rounded-xl skeleton flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 rounded skeleton w-48" />
                  <div className="h-2.5 rounded skeleton w-28" />
                </div>
              </div>
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/20 mb-3 block">folder_open</span>
            <p className="text-sm text-on-surface-variant">Файлы не загружены</p>
            <p className="text-xs text-on-surface-variant/50 mt-1">Загрузите первый документ выше</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {files.map((file) => {
              const parseInfo = PARSE_STATUS[file.parse_status ?? 'queued'] ?? PARSE_STATUS.queued
              const isDeleting = deletingId === file.id
              return (
                <div key={file.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-white/[0.02] transition-colors group">
                  {/* Icon */}
                  <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center flex-shrink-0">
                    <span className={`material-symbols-outlined text-lg ${fileIconColor(file.mime_type)}`}>
                      {fileIcon(file.mime_type)}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-on-surface truncate">{file.file_name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] font-mono text-on-surface-variant">
                        {DOC_TYPE_OPTIONS.find(o => o.value === file.doc_type)?.label ?? file.doc_type}
                      </span>
                      <span className="text-on-surface-variant/30">·</span>
                      <span className="text-[10px] font-mono text-on-surface-variant">{formatBytes(file.file_size)}</span>
                      <span className="text-on-surface-variant/30">·</span>
                      <span className={`text-[10px] font-mono ${parseInfo.color}`}>{parseInfo.label}</span>
                    </div>
                  </div>

                  {/* Date */}
                  <span className="text-[10px] font-mono text-on-surface-variant/50 hidden sm:block flex-shrink-0">
                    {new Date(file.uploaded_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a
                      href={file.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Открыть файл"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors"
                    >
                      <span className="material-symbols-outlined text-base">open_in_new</span>
                    </a>
                    <button
                      onClick={() => handleDelete(file)}
                      disabled={isDeleting}
                      title="Удалить файл"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors disabled:opacity-30"
                    >
                      <span className={`material-symbols-outlined text-base ${isDeleting ? 'animate-spin' : ''}`}>
                        {isDeleting ? 'progress_activity' : 'delete_outline'}
                      </span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {files.length > 0 && (
        <p className="text-[10px] font-mono text-on-surface-variant/40 text-right">
          {files.length} {files.length === 1 ? 'файл' : files.length < 5 ? 'файла' : 'файлов'}
        </p>
      )}
    </div>
  )
}
