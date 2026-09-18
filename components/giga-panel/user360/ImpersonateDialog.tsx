'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Eye, PencilLine } from 'lucide-react'
import { Field, GigaApiError, Modal, Button, cx, gigaFetch, inputClass } from '../kit'

/**
 * «Просмотреть кабинет от имени пользователя». The reason is mandatory and
 * stored with the session; the cabinet opens in a new tab.
 */
export function ImpersonateDialog({ open, onClose, userId, userLabel, allowEdit, redirect, defaultMode = 'view', defaultReason = '' }: {
  open: boolean; onClose: () => void; userId: string; userLabel: string; allowEdit: boolean
  /** Client page to open (whitelisted on the server). */
  redirect?: '/client/home' | '/client/onboarding' | '/client/point-a' | '/gri'
  defaultMode?: 'view' | 'edit'
  defaultReason?: string
}) {
  const [mode, setMode] = useState<'view' | 'edit'>(defaultMode === 'edit' && allowEdit ? 'edit' : 'view')
  const [reason, setReason] = useState(defaultReason)
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    try {
      const res = await gigaFetch<{ redirect: string; expiresAt: string }>('/api/giga-admin/impersonation', {
        method: 'POST',
        json: { userId, mode, reason, redirect },
      })
      toast.success('Кабинет открыт в новой вкладке. Сессия — 30 минут, действия записываются.')
      window.open(res.redirect, '_blank', 'noopener')
      setReason('')
      onClose()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось открыть кабинет')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Открыть кабинет от имени пользователя"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button variant="warning" onClick={start} loading={busy} disabled={reason.trim().length < 5}>Открыть кабинет</Button>
        </>
      }
    >
      <p className="text-xs leading-relaxed text-slate-400">
        Вы увидите кабинет <span className="font-semibold text-slate-200">{userLabel}</span> так, как его видит пользователь.
        Сессия длится 30 минут, в кабинете будет баннер режима администратора, каждое действие попадёт в журнал аудита.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {([
          { key: 'view', icon: <Eye size={15} />, title: 'Только просмотр', text: 'Любые изменения блокируются сервером', disabled: false },
          { key: 'edit', icon: <PencilLine size={15} />, title: 'Просмотр и правка', text: allowEdit ? 'Изменения сохраняются от вашего имени' : 'Нет права на правку', disabled: !allowEdit },
        ] as const).map((m) => (
          <button
            key={m.key}
            type="button"
            disabled={m.disabled}
            onClick={() => setMode(m.key)}
            aria-pressed={mode === m.key}
            className={cx(
              'rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-40',
              mode === m.key ? 'border-amber-400/40 bg-amber-400/10' : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05]',
            )}
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-slate-100">{m.icon}{m.title}</span>
            <span className="mt-1 block text-[11px] text-slate-500">{m.text}</span>
          </button>
        ))}
      </div>
      <div className="mt-4">
        <Field label="Причина (обязательно)" hint="Например: «клиент просит помочь заполнить анкету», тикет поддержки №…">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className={inputClass} />
        </Field>
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        Панель в этой вкладке продолжит работать. Если вы вошли личным аккаунтом, после выхода из режима пользователя может понадобиться войти заново.
      </p>
    </Modal>
  )
}
