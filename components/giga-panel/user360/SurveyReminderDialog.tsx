'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { BellRing } from 'lucide-react'
import { Button, Field, GigaApiError, Modal, gigaFetch, inputClass } from '../kit'

/**
 * Письмо «допройдите анкету».
 *
 * Показываем сотруднику, что именно уйдёт клиенту: какие разделы пустые и
 * сколько шагов заполнено. Письмо подписывается адресом сотрудника — от живого
 * человека напоминание работает лучше, чем от робота.
 */
export function SurveyReminderDialog({ open, onClose, userId, userLabel, survey, onSent }: {
  open: boolean
  onClose: () => void
  userId: string
  userLabel: string
  survey: { startedSteps: number; totalSteps: number; sections: Array<{ id: string; title: string; filled: number; total: number }> }
  onSent: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const empty = survey.sections.filter((s) => s.filled === 0)

  const send = async () => {
    setBusy(true)
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/remind-survey`, {
        method: 'POST',
        json: { note: note.trim() || undefined },
      })
      toast.success('Напоминание отправлено')
      setNote('')
      onSent()
      onClose()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось отправить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={<span className="flex items-center gap-2"><BellRing size={15} className="text-blue-300" /> Напомнить про анкету</span>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button variant="primary" icon={<BellRing size={13} />} loading={busy} onClick={() => void send()}>Отправить письмо</Button>
        </>
      }
    >
      <p className="text-sm text-slate-300">
        Клиенту <span className="text-slate-100">{userLabel}</span> уйдёт письмо с прогрессом{' '}
        <span className="text-slate-100">{survey.startedSteps} из {survey.totalSteps}</span> и списком незаполненных разделов.
      </p>

      {empty.length > 0 && (
        <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
          <p className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">Пустые разделы</p>
          <div className="flex flex-wrap gap-1.5">
            {empty.map((s) => (
              <span key={s.id} className="rounded-lg border border-amber-500/20 bg-amber-500/[0.08] px-2 py-0.5 text-[11px] text-amber-200">{s.title}</span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3">
        <Field label="Личное сообщение (необязательно)" hint="Одна строка от вас — попадёт в письмо отдельной цитатой.">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder="Пример: без шага «Финансы» диагностика получится неточной — заполните, и я соберу разбор к четвергу."
            className={inputClass}
          />
        </Field>
      </div>

      <p className="mt-2 text-[11px] text-slate-600">
        Чаще раза в сутки одному человеку напоминание не уходит.
      </p>
    </Modal>
  )
}
