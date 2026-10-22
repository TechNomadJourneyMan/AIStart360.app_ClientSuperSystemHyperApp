'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DocumentStatusChip } from '@/components/documents/DocumentStatus'
import {
  CLIENT_DOCUMENT_ACCEPT, CLIENT_DOCUMENT_FORMATS_LABEL, CLIENT_DOCUMENT_MAX_LABEL, checkClientFile, documentDownloadUrl,
  httpErrorMessage, uploadClientDocument, type ClientDocument,
} from '@/lib/documents/client-upload'
import { documentStatusView, isDocumentInFlight } from '@/lib/documents/status-view'

/**
 * «Прикрепить файл» inside the answer editor. The file goes through the
 * normal document pipeline (private bucket → POST /api/v1/documents → checks,
 * dedupe, parsing / OCR) with `question_key`, so it is also in «Мои
 * документы» and feeds Точку А. The list shows the files of this question
 * with their real processing status (refreshed while one is in flight);
 * «Открепить» detaches the file from the question without deleting it.
 */
const POLL_MS = 5000

export default function QuestionAttachments({ questionKey, companyId, disabled }: {
  questionKey: string
  companyId: string | null
  disabled?: boolean
}) {
  const [docs, setDocs] = useState<ClientDocument[]>([])
  const [available, setAvailable] = useState(true)
  const [busy, setBusy] = useState<'upload' | string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/onboarding/survey/attachments?key=${encodeURIComponent(questionKey)}`, { credentials: 'include', cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (res.ok && json?.ok && Array.isArray(json.data)) {
        setDocs(json.data as ClientDocument[])
        setAvailable(json.available !== false)
      } else {
        setError(httpErrorMessage(res.status, json?.error, 'Не удалось загрузить прикреплённые файлы.'))
      }
    } catch {
      setError(httpErrorMessage(null, null))
    }
  }, [questionKey])

  useEffect(() => { void load() }, [load])

  // Refresh while a file is being checked / parsed.
  const inFlight = docs.some((d) => isDocumentInFlight(d))
  useEffect(() => {
    if (!inFlight) return
    const id = setInterval(() => { void load() }, POLL_MS)
    return () => clearInterval(id)
  }, [inFlight, load])

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setNote(null)
    const check = checkClientFile(file)
    if (!check.ok) { setError(check.error); return }
    setBusy('upload')
    try {
      const out = await uploadClientDocument(file, { docType: 'other', companyId, questionKey })
      if (out.kind === 'created') setNote(`Файл «${out.document.file_name}» прикреплён — проверяем и разбираем его.`)
      else if (out.kind === 'duplicate') setNote(out.message)
      else setError(out.error)
      await load()
    } finally {
      setBusy(null)
    }
  }

  const unlink = async (doc: ClientDocument) => {
    setBusy(doc.id)
    setError(null)
    try {
      const res = await fetch('/api/v1/onboarding/survey/attachments', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: doc.id, key: questionKey }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) setError(httpErrorMessage(res.status, json?.error, 'Не удалось открепить файл.'))
      else setDocs((prev) => prev.filter((d) => d.id !== doc.id))
    } catch {
      setError(httpErrorMessage(null, null))
    } finally {
      setBusy(null)
    }
  }

  const open = async (doc: ClientDocument) => {
    const out = await documentDownloadUrl(doc)
    if (out.ok) window.open(out.url, '_blank', 'noopener,noreferrer')
    else setError(out.error)
  }

  return (
    <section aria-label="Файлы к вопросу" className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-on-surface">
          <span className="material-symbols-outlined text-base text-primary/80" aria-hidden>attach_file</span>
          Файлы к вопросу
          {docs.length > 0 && <span className="font-mono text-[10px] text-on-surface-variant">{docs.length}</span>}
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy !== null}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/[0.12] disabled:opacity-50"
        >
          <span className={`material-symbols-outlined text-base ${busy === 'upload' ? 'animate-spin' : ''}`} aria-hidden>
            {busy === 'upload' ? 'progress_activity' : 'upload_file'}
          </span>
          {busy === 'upload' ? 'Загружаем…' : 'Прикрепить файл'}
        </button>
        <input ref={inputRef} type="file" accept={CLIENT_DOCUMENT_ACCEPT} onChange={onPick} className="hidden" />
      </div>
      <p className="mt-1 text-[11px] text-on-surface-variant/70">
        {CLIENT_DOCUMENT_FORMATS_LABEL} · до {CLIENT_DOCUMENT_MAX_LABEL}. Файл попадёт и в «Мои документы».
      </p>

      {!available && (
        <p className="mt-2 text-[11px] text-on-surface-variant">Привязка файлов к вопросам скоро заработает — пока файл сохранится в «Мои документы».</p>
      )}

      {docs.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {docs.map((d) => {
            const view = documentStatusView(d)
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-container px-2.5 py-2">
                <span className="material-symbols-outlined text-base text-primary/60" aria-hidden>description</span>
                <button type="button" onClick={() => void open(d)} className="min-w-0 flex-1 truncate text-left text-xs text-on-surface hover:underline" title={d.file_name}>
                  {d.file_name}
                </button>
                <DocumentStatusChip view={view} />
                <button
                  type="button"
                  onClick={() => void unlink(d)}
                  disabled={busy !== null}
                  className="text-[11px] text-on-surface-variant hover:text-error disabled:opacity-50"
                  aria-label={`Открепить файл «${d.file_name}» от вопроса`}
                >
                  Открепить
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {note && <p className="mt-2 text-[11px] text-on-surface-variant" aria-live="polite">{note}</p>}
      {error && <p className="mt-2 text-[11px] text-error" role="alert">{error}</p>}
    </section>
  )
}
