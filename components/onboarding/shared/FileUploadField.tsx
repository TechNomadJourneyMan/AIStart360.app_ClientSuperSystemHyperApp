'use client'

import React, { useState, useRef, useCallback } from 'react'
import { CLIENT_DOCUMENT_ACCEPT, uploadClientDocument } from '@/lib/documents/client-upload'
import { encodeFileRef, fileHref, fileRefName, isFileRouteBucket, surveyFileRef } from '@/lib/documents/survey-files'
import { FieldLabel } from './FieldLabel'
import { FieldError } from './FieldError'

interface FileUploadFieldProps {
  label: string
  /** The questionnaire key: the uploaded document is attached to this question. */
  fieldKey: string
  /** Empty (preview without a session) — the picker is disabled, nothing is uploaded. */
  userId: string
  accept?: string
  /** Stored answer: `<bucket>/<path>` (new) or a legacy public Storage URL. */
  value?: string
  /** Receives the storage reference `<bucket>/<path>` — never a URL. */
  onChange: (ref: string) => void
}

/**
 * A file answer of the questionnaire (step 6 «Скрипты»). The file goes through
 * the normal document pipeline — private bucket `client-documents`, then
 * POST /api/v1/documents (checks, dedupe, processing, «Мои документы»), linked
 * to the question. The answer keeps the storage reference; the «Открыть» link
 * goes through the access-checked route (lib/documents/survey-files.ts).
 */
export function FileUploadField({
  label,
  fieldKey,
  userId,
  accept = CLIENT_DOCUMENT_ACCEPT,
  value,
  onChange,
}: FileUploadFieldProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [fileName, setFileName] = useState<string | undefined>()
  const inputRef = useRef<HTMLInputElement>(null)
  const disabled = !userId

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file || disabled) return

      setError(undefined)
      setUploading(true)

      try {
        const out = await uploadClientDocument(file, { docType: 'scripts', questionKey: fieldKey })
        if (out.kind === 'failed' || out.kind === 'rejected') {
          setError(out.error)
          return
        }
        const doc = out.document
        if (!doc.storage_path || !isFileRouteBucket(doc.storage_bucket)) {
          setError('Файл загружен, но ссылка на него недоступна. Загрузите файл ещё раз.')
          return
        }
        setFileName(doc.file_name || file.name)
        onChange(encodeFileRef({ bucket: doc.storage_bucket, path: doc.storage_path }))
      } catch (err) {
        setError(err instanceof Error && /[а-яё]/i.test(err.message) ? err.message : 'Ошибка загрузки файла')
      } finally {
        setUploading(false)
      }
    },
    [disabled, fieldKey, onChange]
  )

  const ref = surveyFileRef(value)
  const displayName = fileName ?? (ref ? fileRefName(ref) : value ? 'Файл загружен' : undefined)

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>

      <div
        onClick={() => { if (!disabled && !uploading) inputRef.current?.click() }}
        aria-disabled={disabled || undefined}
        className={`flex items-center gap-3 bg-surface-container border border-dashed border-white/[0.12] rounded-xl px-4 py-3 transition-all ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-primary/30'}`}
      >
        <span className="material-symbols-outlined text-on-surface-variant text-xl">
          {uploading ? 'hourglass_empty' : value ? 'check_circle' : 'upload_file'}
        </span>

        <div className="flex-1 min-w-0">
          {uploading ? (
            <span className="text-sm text-on-surface-variant">Загрузка...</span>
          ) : displayName ? (
            <span className="text-sm text-on-surface truncate block">{displayName}</span>
          ) : (
            <span className="text-sm text-on-surface-variant/50">
              Нажмите для загрузки файла
            </span>
          )}
        </div>

        {ref && !uploading && (
          <a
            href={fileHref(ref)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-primary hover:underline"
          >
            Открыть
          </a>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleUpload}
        disabled={disabled}
        className="hidden"
      />

      <FieldError msg={error} />
    </div>
  )
}
