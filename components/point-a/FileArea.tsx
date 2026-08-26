'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

interface DocFile {
  id: string
  file_name: string
  file_size: number | null
  doc_type: string
  parse_status: string | null
  uploaded_at: string
}

const DOC_TYPE_LABELS: Record<string, string> = {
  pl_report: 'P&L · годовой',
  balance_sheet: 'Баланс',
  marketing_report: 'Маркетинговый отчёт',
  ops_report: 'Операционный отчёт',
  crm_export: 'CRM-выгрузка',
  audit: 'Аудит',
  other: 'Другое',
}

const STATUS: Record<string, { label: string; color: string }> = {
  queued: { label: 'Ожидает обработки', color: 'text-on-surface-variant' },
  processing: { label: 'Анализируется', color: 'text-amber-400' },
  parsed: { label: 'Обработан', color: 'text-primary' },
  completed: { label: 'Обработан', color: 'text-primary' },
  error: { label: 'Ошибка', color: 'text-error' },
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Read-only file inventory plus two canonical upload routes.
 *
 * Monthly Store workbooks and generic Point A documents deliberately use
 * different pipelines. The former preserves exact months and publishes
 * atomically into Store statistics; the latter feeds the document workspace.
 */
export function FileArea({ userId: _userId }: { userId: string }) {
  const [files, setFiles] = useState<DocFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadFiles = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/onboarding/documents', {
        credentials: 'include',
        cache: 'no-store',
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.ok !== true) {
        throw new Error(body?.error ?? 'Не удалось загрузить список документов')
      }
      setFiles(Array.isArray(body.data) ? body.data : [])
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить список документов')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  const deleteFile = async (id: string) => {
    setDeletingId(id)
    try {
      const response = await fetch(`/api/v1/onboarding/documents/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.ok !== true) {
        throw new Error(body?.error ?? 'Не удалось удалить документ')
      }
      setFiles((current) => current.filter((file) => file.id !== id))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Не удалось удалить документ')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="point-a-files-title">
      <div>
        <h2 id="point-a-files-title" className="font-headline text-lg font-bold text-on-surface">
          Файловая область
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
          Выберите правильный контур: месячный отчёт магазина обновляет Store‑статистику, остальные документы проходят отдельный разбор Точки А.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Link
          href="/store/imports"
          className="group rounded-2xl border border-primary/25 bg-primary/[0.07] p-4 transition-colors hover:bg-primary/[0.11] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <span className="material-symbols-outlined text-2xl text-primary" aria-hidden="true">storefront</span>
          <h3 className="mt-3 text-sm font-bold text-on-surface group-hover:text-primary">Отчёт магазина → статистика</h3>
          <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
            XLS/XLSX/CSV: продажи, месячный P&amp;L, маржа, расходы и EBITDA. Сначала preview, затем подтверждённая публикация.
          </p>
        </Link>

        <Link
          href="/client/onboarding/documents"
          className="group rounded-2xl border border-white/[0.07] bg-surface-container-low p-4 transition-colors hover:border-primary/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <span className="material-symbols-outlined text-2xl text-primary" aria-hidden="true">folder_open</span>
          <h3 className="mt-3 text-sm font-bold text-on-surface group-hover:text-primary">Документы Точки А</h3>
          <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
            Годовой P&amp;L, баланс, аудит, CRM и прочие документы для AI‑разбора.
          </p>
        </Link>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-error/20 bg-error/5 px-4 py-3 text-xs text-error">
          <span className="material-symbols-outlined text-base" aria-hidden="true">error</span>
          <span>{error}</span>
          <button type="button" onClick={() => void loadFiles()} className="ml-auto underline underline-offset-2">
            Повторить
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/[0.04] bg-surface-container-low">
        {loading ? (
          <div className="space-y-2 p-5" aria-busy="true">
            {[0, 1].map((item) => <div key={item} className="h-12 animate-pulse rounded-xl bg-white/[0.04]" />)}
          </div>
        ) : files.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant/30" aria-hidden="true">folder_open</span>
            <p className="mt-2 text-sm text-on-surface-variant">Документы Точки А ещё не загружены</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {files.map((file) => {
              const state = STATUS[file.parse_status ?? 'queued'] ?? STATUS.queued
              return (
                <li key={file.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="material-symbols-outlined text-xl text-primary/70" aria-hidden="true">description</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-on-surface">{file.file_name}</p>
                    <p className="mt-0.5 text-[10px] font-mono text-on-surface-variant">
                      {DOC_TYPE_LABELS[file.doc_type] ?? file.doc_type} · {formatBytes(file.file_size)} ·{' '}
                      <span className={state.color}>{state.label}</span>
                    </p>
                  </div>
                  <time className="hidden text-[10px] font-mono text-on-surface-variant/60 sm:block" dateTime={file.uploaded_at}>
                    {new Date(file.uploaded_at).toLocaleDateString('ru-RU')}
                  </time>
                  <button
                    type="button"
                    onClick={() => void deleteFile(file.id)}
                    disabled={deletingId === file.id}
                    aria-label={`Удалить ${file.file_name}`}
                    className="flex size-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-error/10 hover:text-error disabled:opacity-40"
                  >
                    <span className={`material-symbols-outlined text-base ${deletingId === file.id ? 'animate-spin' : ''}`} aria-hidden="true">
                      {deletingId === file.id ? 'progress_activity' : 'delete_outline'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
