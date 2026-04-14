'use client'

import React, { useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FieldLabel } from './FieldLabel'
import { FieldError } from './FieldError'

interface FileUploadFieldProps {
  label: string
  fieldKey: string
  userId: string
  accept?: string
  value?: string
  onChange: (url: string) => void
}

export function FileUploadField({
  label,
  fieldKey,
  userId,
  accept = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.png',
  value,
  onChange,
}: FileUploadFieldProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [fileName, setFileName] = useState<string | undefined>()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setError(undefined)
      setUploading(true)
      setFileName(file.name)

      try {
        const supabase = createClient()
        const ext = file.name.split('.').pop()
        const path = `${userId}/${fieldKey}/${Date.now()}.${ext}`

        const { error: uploadErr } = await supabase.storage
          .from('documents')
          .upload(path, file, { upsert: true })

        if (uploadErr) throw uploadErr

        const {
          data: { publicUrl },
        } = supabase.storage.from('documents').getPublicUrl(path)

        onChange(publicUrl)
      } catch (err: any) {
        setError(err?.message ?? 'Ошибка загрузки файла')
        setFileName(undefined)
      } finally {
        setUploading(false)
      }
    },
    [userId, fieldKey, onChange]
  )

  const displayName = fileName ?? (value ? decodeURIComponent(value.split('/').pop() ?? '') : undefined)

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>

      <div
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-3 bg-surface-container border border-dashed border-white/[0.12] rounded-xl px-4 py-3 cursor-pointer hover:border-primary/30 transition-all"
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

        {value && !uploading && (
          <a
            href={value}
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
        className="hidden"
      />

      <FieldError msg={error} />
    </div>
  )
}
