'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { DocumentStageSteps, DocumentStatusChip, DocumentStatusDetails, toneTextClass } from '@/components/documents/DocumentStatus'
import { UploadMetaFields, emptyUploadMeta, uploadMetaToOptions, type UploadMeta } from '@/components/documents/UploadMetaFields'
import { openDocumentInNewTab } from '@/components/documents/openDocument'
import { notifyDocumentsChanged, useClientDocuments } from '@/hooks/useClientDocuments'
import {
  CLIENT_DOCUMENT_ACCEPT,
  CLIENT_DOCUMENT_FORMATS_LABEL,
  CLIENT_DOCUMENT_MAX_LABEL,
  checkClientFile,
  deleteClientDocument,
  reprocessClientDocument,
  uploadClientDocument,
  type ClientDocument,
} from '@/lib/documents/client-upload'
import { documentTypeLabel } from '@/lib/documents/doc-type-labels'
import { documentSize, documentStatusView, formatDocumentSize, isDocumentRejected } from '@/lib/documents/status-view'

function fileIcon(mimeType: string | null | undefined): string {
  if (!mimeType) return 'description'
  if (mimeType.includes('pdf')) return 'picture_as_pdf'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'table_chart'
  if (mimeType.includes('presentation')) return 'slideshow'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.includes('word') || mimeType.includes('document')) return 'article'
  return 'description'
}

function fileIconColor(mimeType: string | null | undefined): string {
  if (!mimeType) return 'text-on-surface-variant'
  if (mimeType.includes('pdf')) return 'text-red-400'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'text-green-400'
  if (mimeType.includes('word') || mimeType.includes('document')) return 'text-blue-400'
  return 'text-on-surface-variant'
}

type Phase = 'idle' | 'storage' | 'register'

const PHASE_TEXT: Record<Exclude<Phase, 'idle'>, string> = {
  storage: 'Загрузка в защищённое хранилище…',
  register: 'Проверка файла на сервере…',
}

interface FileAreaProps {
  /**
   * Kept for the page's API. Identity for uploads and the list comes from the
   * Supabase session (storage RLS + server), never from this prop.
   */
  userId?: string
}

export function FileArea(_props: FileAreaProps) {
  const { documents, loading, error: listError, upsert, remove } = useClientDocuments()
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [meta, setMeta] = useState<UploadMeta>(emptyUploadMeta)
  const [phase, setPhase] = useState<Phase>('idle')
  const [dragOver, setDragOver] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reprocessingId, setReprocessingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploading = phase !== 'idle'
  const options = uploadMetaToOptions(meta)

  const handleFilePick = (file: File) => {
    setNotice(null)
    const check = checkClientFile(file)
    if (!check.ok) {
      setError({ message: check.error })
      return
    }
    setError(null)
    setMeta(emptyUploadMeta())
    setPendingFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFilePick(file)
  }

  const handleUpload = async () => {
    if (!pendingFile || !options || uploading) return
    setError(null)
    setNotice(null)
    setPhase('storage')
    const res = await uploadClientDocument(pendingFile, { ...options, onPhase: setPhase })
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
        setError({ message: `Файл отклонён: ${res.error}`, code: res.code })
        break
      case 'failed':
        setError({ message: res.error, code: res.code })
        break
    }
  }

  const handleReprocess = async (file: ClientDocument) => {
    setReprocessingId(file.id)
    setError(null)
    setNotice(null)
    const res = await reprocessClientDocument(file.id)
    setReprocessingId(null)
    if (!res.ok) {
      setError({ message: res.error, code: res.code })
      return
    }
    if (res.alreadyQueued) setNotice('Документ уже в очереди на обработку.')
    if (res.document) upsert(res.document)
    notifyDocumentsChanged()
  }

  const handleDelete = async (file: ClientDocument) => {
    if (!window.confirm(`Удалить «${file.file_name}»? Данные, извлечённые из документа, тоже будут удалены.`)) return
    setDeletingId(file.id)
    setError(null)
    const res = await deleteClientDocument(file.id)
    setDeletingId(null)
    if (res.ok) remove(file.id)
    else setError({ message: res.error })
  }

  const handleOpen = async (file: ClientDocument) => {
    const err = await openDocumentInNewTab(file)
    if (err) setError({ message: err })
  }

  return (
    <div id="files" className="space-y-4 scroll-mt-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-headline text-lg font-bold text-on-surface">Файловая область</h2>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {CLIENT_DOCUMENT_FORMATS_LABEL} — до {CLIENT_DOCUMENT_MAX_LABEL}
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 text-sm font-mono text-[#003824] bg-gradient-to-r from-primary to-[#00e29e] px-4 py-2 rounded-xl font-bold hover:scale-[0.98] transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className="material-symbols-outlined text-base" aria-hidden>upload_file</span>
          Загрузить
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={CLIENT_DOCUMENT_ACCEPT}
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) handleFilePick(f)
          }}
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
              {CLIENT_DOCUMENT_FORMATS_LABEL.split(', ').join(' · ')}
            </p>
          </div>
        ) : (
          <div className="space-y-4" onClick={e => e.stopPropagation()}>
            {/* File preview */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center flex-shrink-0">
                <span className={`material-symbols-outlined text-xl ${fileIconColor(pendingFile.type)}`}>
                  {fileIcon(pendingFile.type)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-on-surface truncate">{pendingFile.name}</p>
                <p className="text-[10px] text-on-surface-variant">{formatDocumentSize(pendingFile.size)}</p>
              </div>
              <button
                onClick={() => setPendingFile(null)}
                disabled={uploading}
                aria-label="Убрать файл"
                className="text-on-surface-variant hover:text-error transition-colors p-1 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-lg"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <UploadMetaFields value={meta} onChange={setMeta} disabled={uploading} idPrefix="file-area" />

            {/* Real phases of the upload (no invented percentages) */}
            {uploading && (
              <p className="flex items-center gap-2 text-[11px] font-mono text-primary" role="status" aria-live="polite">
                <span className="material-symbols-outlined text-sm animate-spin" aria-hidden>progress_activity</span>
                {PHASE_TEXT[phase as Exclude<Phase, 'idle'>]}
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleUpload}
                disabled={uploading || !options}
                className="flex-1 flex items-center justify-center gap-2 text-sm font-mono text-[#003824] bg-gradient-to-r from-primary to-[#00e29e] px-4 py-2.5 rounded-xl font-bold hover:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {uploading ? (
                  <>
                    <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                    Загрузка...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">upload</span>
                    {options ? 'Загрузить' : 'Выберите тип документа'}
                  </>
                )}
              </button>
              <button
                onClick={() => setPendingFile(null)}
                disabled={uploading}
                className="px-4 py-2.5 rounded-xl border border-white/[0.08] text-sm text-on-surface-variant hover:bg-white/[0.04] transition-colors disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 bg-error/5 border border-error/20 rounded-xl px-4 py-2.5" role="alert">
          <span className="material-symbols-outlined text-base text-error flex-shrink-0">error</span>
          <div className="space-y-1">
            <span className="text-xs text-error">{error.message}</span>
            {error.code === 'NO_COMPANY' && (
              <Link href="/client/onboarding" className="block text-[11px] font-mono text-primary hover:underline">
                Заполнить данные компании →
              </Link>
            )}
          </div>
          <button onClick={() => setError(null)} aria-label="Закрыть" className="ml-auto text-error/60 hover:text-error">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      {/* Info (duplicate, already queued) */}
      {notice && (
        <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-xl px-4 py-2.5" role="status">
          <span className="material-symbols-outlined text-base text-primary flex-shrink-0">info</span>
          <span className="text-xs text-on-surface">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Закрыть" className="ml-auto text-on-surface-variant hover:text-on-surface">
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
        ) : documents.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/20 mb-3 block">folder_open</span>
            {listError ? (
              <p className="text-sm text-error">{listError}</p>
            ) : (
              <>
                <p className="text-sm text-on-surface-variant">Файлы не загружены</p>
                <p className="text-xs text-on-surface-variant/50 mt-1">Загрузите первый документ выше</p>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {listError && (
              <p className="px-5 py-2 text-[11px] text-error">Не удалось обновить статусы: {listError}</p>
            )}
            {documents.map((file) => {
              const view = documentStatusView(file)
              const isDeleting = deletingId === file.id
              const isReprocessing = reprocessingId === file.id
              const isExpanded = expandedId === file.id
              const mime = file.sniffed_mime ?? file.mime_type
              const size = formatDocumentSize(documentSize(file))
              const hasMore = view.warnings.length > 0
              return (
                <div key={file.id} className="px-5 py-3.5 hover:bg-white/[0.02] transition-colors group">
                  <div className="flex items-center gap-3">
                    {/* Icon */}
                    <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center flex-shrink-0">
                      <span className={`material-symbols-outlined text-lg ${fileIconColor(mime)}`}>
                        {fileIcon(mime)}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">{file.file_name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] font-mono text-on-surface-variant">{documentTypeLabel(file.doc_type)}</span>
                        {size && (
                          <>
                            <span className="text-on-surface-variant/30">·</span>
                            <span className="text-[10px] font-mono text-on-surface-variant">{size}</span>
                          </>
                        )}
                        <DocumentStatusChip view={view} />
                      </div>
                      {view.detail && (
                        <p className={`text-[11px] mt-1 leading-snug ${view.tone === 'success' ? 'text-on-surface-variant' : toneTextClass(view.tone)}`}>
                          {view.detail}
                        </p>
                      )}
                      {view.inFlight && (
                        <div className="mt-1.5">
                          <DocumentStageSteps view={view} />
                        </div>
                      )}
                      {hasMore && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : file.id)}
                          aria-expanded={isExpanded}
                          className="mt-1 text-[10px] font-mono text-amber-300/90 hover:text-amber-200 focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
                        >
                          {isExpanded ? 'Скрыть предупреждения' : `Предупреждения: ${view.warnings.length}`}
                        </button>
                      )}
                    </div>

                    {/* Date */}
                    {file.uploaded_at && (
                      <span className="text-[10px] font-mono text-on-surface-variant/50 hidden sm:block flex-shrink-0">
                        {new Date(file.uploaded_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                      </span>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      {view.canReprocess && (
                        <button
                          onClick={() => handleReprocess(file)}
                          disabled={isReprocessing}
                          title="Обработать заново"
                          aria-label="Обработать заново"
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          <span className={`material-symbols-outlined text-base ${isReprocessing ? 'animate-spin' : ''}`}>
                            {isReprocessing ? 'progress_activity' : 'refresh'}
                          </span>
                        </button>
                      )}
                      {!isDocumentRejected(file) && (
                        <button
                          onClick={() => handleOpen(file)}
                          title="Открыть файл"
                          aria-label="Открыть файл"
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          <span className="material-symbols-outlined text-base">open_in_new</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(file)}
                        disabled={isDeleting}
                        title="Удалить файл"
                        aria-label="Удалить файл"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-primary/40"
                      >
                        <span className={`material-symbols-outlined text-base ${isDeleting ? 'animate-spin' : ''}`}>
                          {isDeleting ? 'progress_activity' : 'delete_outline'}
                        </span>
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-2 ml-12 rounded-xl bg-surface-container border border-white/[0.04] px-3 py-2.5">
                      <DocumentStatusDetails view={view} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {documents.length > 0 && (
        <p className="text-[10px] font-mono text-on-surface-variant/40 text-right">
          {documents.length} {documents.length % 10 === 1 && documents.length % 100 !== 11 ? 'файл' : [2, 3, 4].includes(documents.length % 10) && ![12, 13, 14].includes(documents.length % 100) ? 'файла' : 'файлов'}
        </p>
      )}
    </div>
  )
}
