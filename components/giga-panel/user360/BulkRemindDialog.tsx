'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { BellRing } from 'lucide-react'
import { Button, Field, GigaApiError, Modal, gigaFetch, inputClass } from '../kit'

/**
 * Напоминание группе клиентов.
 *
 * Показываем поимённо, кому уйдёт письмо: «выделить всех и разослать вслепую»
 * — самый быстрый способ сжечь домен и доверие. Отчёт после отправки честно
 * разделяет отправленные, пропущенные и неудачные.
 */

interface Target { id: string; label: string; steps: number }
type Outcome = 'sent' | 'skipped' | 'failed'
interface Result { userId: string; outcome: Outcome; message: string }

export function BulkRemindDialog({ open, onClose, users, onSent }: {
  open: boolean
  onClose: () => void
  users: Target[]
  onSent: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[] | null>(null)

  const labelOf = (id: string) => users.find((u) => u.id === id)?.label ?? id

  const send = async () => {
    setBusy(true)
    setResults(null)
    try {
      const res = await gigaFetch<{ sent: number; total: number; results: Result[] }>('/api/giga-admin/users/bulk-remind', {
        method: 'POST',
        json: { userIds: users.map((u) => u.id), note: note.trim() || undefined },
      })
      setResults(res.results)
      if (res.sent) toast.success(`Отправлено писем: ${res.sent} из ${res.total}`)
      else toast.error('Ни одно письмо не отправлено')
      if (res.sent) onSent()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось отправить')
    } finally {
      setBusy(false)
    }
  }

  const tone: Record<Outcome, string> = {
    sent: 'text-emerald-300',
    skipped: 'text-slate-500',
    failed: 'text-red-300',
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={<span className="flex items-center gap-2"><BellRing size={15} className="text-blue-300" /> Напомнить про анкету — {users.length}</span>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Закрыть</Button>
          <Button variant="primary" icon={<BellRing size={13} />} loading={busy} disabled={!users.length} onClick={() => void send()}>
            Отправить {users.length}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-300">Письмо уйдёт этим клиентам. У каждого в письме будет свой прогресс и свои пустые разделы.</p>

      <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-slate-200">{u.label}</span>
            <span className="shrink-0 text-[11px] text-slate-500">{u.steps}/12</span>
          </li>
        ))}
      </ul>

      <div className="mt-3">
        <Field label="Общее сообщение (необязательно)" hint="Одинаковое для всех. Личное лучше писать из карточки.">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} className={inputClass} />
        </Field>
      </div>

      {results && (
        <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto border-t border-white/[0.06] pt-3 text-[11px]">
          {results.map((r) => (
            <li key={r.userId} className="flex items-center justify-between gap-2">
              <span className="truncate text-slate-300">{labelOf(r.userId)}</span>
              <span className={tone[r.outcome]}>{r.message}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-slate-600">Тем, кому напоминали за последние сутки, письмо не уйдёт.</p>
    </Modal>
  )
}
