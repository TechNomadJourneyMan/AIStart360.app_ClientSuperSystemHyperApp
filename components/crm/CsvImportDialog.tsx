'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { crmKeys } from '@/hooks/useCrm'

interface ImportResult { inserted: number; updated: number; skipped: number }

export function CsvImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  if (!open) return null

  const reset = () => { setFile(null); setResult(null); setBusy(false) }
  const close = () => { reset(); onClose() }

  const doImport = async () => {
    if (!file) return
    setBusy(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/v1/crm/clients/import', { method: 'POST', body: fd })
      let json: unknown = null
      try { json = await res.json() } catch { /* non-json */ }
      const body = (json ?? {}) as { ok?: boolean; data?: ImportResult; error?: string }
      if (!res.ok || body.ok === false || !body.data) {
        const msg = res.status === 413 ? 'Файл слишком большой (макс. 5 МБ)' : body.error || 'Не удалось импортировать файл'
        toast.error(msg)
        setBusy(false)
        return
      }
      const r = body.data
      setResult(r)
      toast.success(`Импорт завершён: +${r.inserted}, обновлено ${r.updated}, пропущено ${r.skipped}`)
      qc.invalidateQueries({ queryKey: crmKeys.all })
    } catch {
      toast.error('Ошибка сети при импорте')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div className="relative bg-[#13151c] border border-white/[0.08] rounded-2xl w-full max-w-md shadow-2xl z-10">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-lg text-primary">upload_file</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-on-surface">Импорт клиентов</p>
              <p className="text-[10px] text-on-surface-variant">CSV или XLSX, до 5 МБ</p>
            </div>
          </div>
          <button onClick={close} className="text-on-surface-variant hover:text-on-surface transition-colors">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-on-surface-variant leading-relaxed">
            Распознаются колонки: <span className="font-mono text-on-surface">Имя</span>, <span className="font-mono text-on-surface">Телефон</span>,{' '}
            <span className="font-mono text-on-surface">Email</span>, <span className="font-mono text-on-surface">Сумма</span>,{' '}
            <span className="font-mono text-on-surface">Комментарий</span>. Дубли по телефону объединяются.
          </p>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null) }}
            className="hidden"
          />
          <button
            onClick={() => inputRef.current?.click()}
            className="w-full flex items-center gap-3 bg-surface-container border border-dashed border-white/[0.12] hover:border-primary/30 rounded-xl px-4 py-4 transition-colors"
          >
            <span className="material-symbols-outlined text-xl text-on-surface-variant">attach_file</span>
            <span className="text-sm text-on-surface truncate">{file ? file.name : 'Выберите файл…'}</span>
          </button>

          {result && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Добавлено', value: result.inserted, color: 'text-primary' },
                { label: 'Обновлено', value: result.updated, color: 'text-tertiary-container' },
                { label: 'Пропущено', value: result.skipped, color: 'text-on-surface-variant' },
              ].map((s) => (
                <div key={s.label} className="bg-surface-container rounded-xl p-3 text-center">
                  <p className={`text-xl font-mono font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={close} className="flex-1 px-4 py-2.5 rounded-xl border border-white/[0.08] text-sm text-on-surface-variant hover:bg-white/[0.04] transition-colors">
              {result ? 'Закрыть' : 'Отмена'}
            </button>
            <button
              onClick={doImport}
              disabled={!file || busy}
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary/15 border border-primary/30 text-sm text-primary font-medium hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                  Импорт…
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-sm">cloud_upload</span>
                  Импортировать
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
