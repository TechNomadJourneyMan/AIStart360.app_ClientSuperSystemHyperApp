'use client'

// The form used to post to `uploadReportAction`, which swallowed every error
// code the server action returns and resolved to void. A 60 MB file just
// re-rendered the page and the user had no idea why nothing appeared.
// Now the action's own result is read and shown, and the button reports progress.

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { uploadReport } from '@/app/actions/reports'
import { MAX_UPLOAD_BYTES, REPORT_CATEGORIES, CATEGORY_LABELS, formatBytes } from './format'

const ERROR_TEXT: Record<string, string> = {
  FILE_REQUIRED: 'Файл не выбран или пуст — прикрепите документ.',
  UNSUPPORTED_FILE_TYPE: 'Такой формат не поддерживается. Подойдут PDF, XLSX, CSV или DOCX.',
  FILE_TOO_LARGE: `Файл больше ${formatBytes(MAX_UPLOAD_BYTES)}. Сожмите его или разбейте на части.`,
  UPLOAD_FAILED: 'Не удалось сохранить файл на сервере. Попробуйте ещё раз, а если повторится — сообщите администратору.',
}

const inputClass =
  'bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60'

export function ReportUploadForm() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const form = event.currentTarget
    const formData = new FormData(form)
    setError(null)
    setDone(null)

    // Check the size before shipping megabytes the server will reject anyway.
    const file = formData.get('file')
    if (file instanceof File && file.size > MAX_UPLOAD_BYTES) {
      setError(`${ERROR_TEXT.FILE_TOO_LARGE} Ваш файл — ${formatBytes(file.size)}.`)
      return
    }

    setBusy(true)
    try {
      const result = await uploadReport(formData)
      if ('error' in result && result.error) {
        setError(ERROR_TEXT[result.error] ?? 'Загрузка не удалась. Попробуйте ещё раз.')
        return
      }
      form.reset()
      setDone('Отчёт загружен — он появился в списке ниже.')
      router.refresh()
    } catch {
      setError('Загрузка прервалась: сервер не ответил. Проверьте соединение и попробуйте снова.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      id="report-upload"
      data-tour="reports-upload"
      onSubmit={handleSubmit}
      aria-busy={busy}
      className="bg-surface-container rounded-xl p-5 border border-outline-variant/20 grid grid-cols-1 md:grid-cols-5 gap-3"
    >
      <label className="md:col-span-2 flex flex-col gap-1">
        <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">Название</span>
        <input name="name" placeholder="Название отчёта" className={inputClass} required disabled={busy} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">Клиент</span>
        <input name="clientName" placeholder="Клиент" className={inputClass} required disabled={busy} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">Категория</span>
        <select name="category" defaultValue="Custom" className={inputClass} disabled={busy}>
          {REPORT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">Файл</span>
        <input
          type="file"
          name="file"
          accept=".pdf,.xlsx,.csv,.docx"
          className={inputClass}
          required
          disabled={busy}
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="md:col-span-5 inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.99] active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <span className={`material-symbols-outlined text-lg ${busy ? 'animate-spin' : ''}`} aria-hidden="true">
          {busy ? 'progress_activity' : 'upload'}
        </span>
        {busy ? 'Загружаем…' : 'Загрузить отчёт'}
      </button>

      <p className="md:col-span-5 text-xs text-on-surface-variant/70">
        Поддерживаются PDF, XLSX, CSV и DOCX. Максимум {formatBytes(MAX_UPLOAD_BYTES)}.
      </p>

      <div className="md:col-span-5" role="status" aria-live="polite">
        {error && (
          <p className="flex items-start gap-2 text-sm text-error bg-error/10 border border-error/20 rounded-lg px-3 py-2">
            <span className="material-symbols-outlined text-base flex-shrink-0" aria-hidden="true">
              error
            </span>
            {error}
          </p>
        )}
        {done && (
          <p className="flex items-start gap-2 text-sm text-primary bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
            <span className="material-symbols-outlined text-base flex-shrink-0" aria-hidden="true">
              check_circle
            </span>
            {done}
          </p>
        )}
      </div>
    </form>
  )
}
