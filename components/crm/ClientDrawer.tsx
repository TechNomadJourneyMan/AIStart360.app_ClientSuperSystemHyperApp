'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  useCrmInteractions,
  useCrmReminders,
  useUpdateClient,
  useDeleteClient,
  useAddReminder,
  useCompleteReminder,
  useLogInteraction,
  type InteractionKind,
} from '@/hooks/useCrm'
import { CLIENT_STATUSES, type ClientStatus } from '@/lib/crm/client-validate'
import { CLIENT_STATUS_META } from './FunnelBar'

/** Minimal client seed the drawer needs — both CrmClient and the pulse queue map to it. */
export interface DrawerClient {
  id: string
  name: string
  phone: string | null
  phone_raw?: string | null
  email: string | null
  status: ClientStatus
  avg_check: number | null
  note: string | null
  next_contact_at: string | null
  last_contact_at: string | null
}

const KIND_ICON: Record<InteractionKind, string> = {
  call: 'call',
  message: 'chat',
  meeting: 'groups',
  note: 'sticky_note_2',
  status_change: 'sync_alt',
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}
function fromLocalInput(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function ClientDrawer({ client, onClose }: { client: DrawerClient | null; onClose: () => void }) {
  const clientId = client?.id ?? null

  const update = useUpdateClient()
  const del = useDeleteClient()
  const addReminder = useAddReminder()
  const completeReminder = useCompleteReminder()
  const logInteraction = useLogInteraction()

  const { data: interactions = [], isLoading: intLoading } = useCrmInteractions(clientId)
  const { data: reminders = [], isLoading: remLoading } = useCrmReminders(clientId)

  // Editable fields (seeded from the client, reset when the client changes).
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<ClientStatus>('new')
  const [avgCheck, setAvgCheck] = useState('')
  const [nextContact, setNextContact] = useState('')
  const [note, setNote] = useState('')

  // Reminder create form.
  const [remDue, setRemDue] = useState('')
  const [remNote, setRemNote] = useState('')

  useEffect(() => {
    if (!client) return
    setName(client.name ?? '')
    setPhone(client.phone_raw ?? client.phone ?? '')
    setEmail(client.email ?? '')
    setStatus(client.status)
    setAvgCheck(client.avg_check != null ? String(client.avg_check) : '')
    setNextContact(toLocalInput(client.next_contact_at))
    setNote(client.note ?? '')
    setRemDue('')
    setRemNote('')
  }, [client])

  // Close on Escape.
  useEffect(() => {
    if (!client) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [client, onClose])

  if (!client) return null

  const phoneDigits = (phone || client.phone || '').replace(/\D/g, '')

  const doCall = () => {
    if (!phoneDigits) { toast.error('Телефон не указан'); return }
    window.open(`tel:${client.phone ?? phoneDigits}`, '_self')
    logInteraction.mutate(
      { clientId: client.id, kind: 'call', comment: 'Звонок из карточки' },
      { onSuccess: () => toast.success('Звонок зафиксирован') },
    )
  }
  const doMessage = () => {
    if (!phoneDigits) { toast.error('Телефон не указан'); return }
    window.open(`https://wa.me/${phoneDigits}`, '_blank')
    logInteraction.mutate(
      { clientId: client.id, kind: 'message', comment: 'Сообщение в WhatsApp' },
      { onSuccess: () => toast.success('Сообщение зафиксировано') },
    )
  }

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) { toast.error('Имя не может быть пустым'); return }
    const avgNum = avgCheck.trim() === '' ? null : Number(avgCheck)
    if (avgNum != null && (!Number.isFinite(avgNum) || avgNum < 0)) {
      toast.error('Средний чек — число ≥ 0')
      return
    }
    update.mutate(
      {
        id: client.id,
        patch: {
          name: trimmed,
          phone: phone.trim(),
          email: email.trim() || null,
          status,
          avg_check: avgNum,
          next_contact_at: fromLocalInput(nextContact),
          note: note.trim() || null,
        },
      },
      {
        onSuccess: () => toast.success('Клиент сохранён'),
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Не удалось сохранить'),
      },
    )
  }

  const addRem = () => {
    const iso = fromLocalInput(remDue)
    if (!iso) { toast.error('Укажите дату и время напоминания'); return }
    addReminder.mutate(
      { clientId: client.id, due_at: iso, note: remNote.trim() || undefined },
      {
        onSuccess: () => { toast.success('Напоминание создано'); setRemDue(''); setRemNote('') },
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Ошибка'),
      },
    )
  }

  const removeClient = () => {
    if (!confirm(`Удалить клиента «${client.name}»? Это действие необратимо.`)) return
    del.mutate(client.id, {
      onSuccess: () => { toast.success('Клиент удалён'); onClose() },
      onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Не удалось удалить'),
    })
  }

  const meta = CLIENT_STATUS_META[status]

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-[#13151c] border-l border-white/[0.08] shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#13151c]/95 backdrop-blur border-b border-white/[0.06] px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center text-lg font-bold text-primary flex-shrink-0">
              {client.name[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface truncate">{client.name}</p>
              <span className={`inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-full border text-[10px] font-mono ${meta.chip}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                {meta.label}
              </span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Закрыть" className="text-on-surface-variant hover:text-on-surface transition-colors flex-shrink-0">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {/* Quick actions */}
          <div className="flex gap-2">
            <button onClick={doCall}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-error/10 hover:bg-error/20 border border-error/20 text-error text-sm font-medium transition-colors">
              <span className="material-symbols-outlined text-sm">call</span>
              Позвонить
            </button>
            <button onClick={doMessage}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-tertiary-container/10 hover:bg-tertiary-container/20 border border-tertiary-container/20 text-tertiary-container text-sm font-medium transition-colors">
              <span className="material-symbols-outlined text-sm">chat</span>
              Написать
            </button>
          </div>

          {/* Editable fields */}
          <div className="space-y-3">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Данные клиента</p>
            <Field label="Имя">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Телефон">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={`${inputCls} font-mono`} />
              </Field>
              <Field label="Ср. чек, ₸">
                <input value={avgCheck} onChange={(e) => setAvgCheck(e.target.value)} inputMode="numeric" className={`${inputCls} font-mono`} />
              </Field>
            </div>
            <Field label="Email">
              <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Статус">
                <select value={status} onChange={(e) => setStatus(e.target.value as ClientStatus)} className={inputCls}>
                  {CLIENT_STATUSES.map((s) => (
                    <option key={s} value={s} className="bg-surface-container text-on-surface">{CLIENT_STATUS_META[s].label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Следующий контакт">
                <input type="datetime-local" value={nextContact} onChange={(e) => setNextContact(e.target.value)} className={`${inputCls} [color-scheme:dark]`} />
              </Field>
            </div>
            <Field label="Заметка">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
            </Field>
            <div className="flex gap-2">
              <button onClick={save} disabled={update.isPending}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary/15 border border-primary/30 text-sm text-primary font-medium hover:bg-primary/25 disabled:opacity-40 transition-colors">
                <span className={`material-symbols-outlined text-sm ${update.isPending ? 'animate-spin' : ''}`}>{update.isPending ? 'progress_activity' : 'save'}</span>
                Сохранить
              </button>
              <button onClick={removeClient} aria-label="Удалить"
                className="inline-flex items-center justify-center px-3 py-2.5 rounded-xl border border-white/[0.08] text-on-surface-variant hover:text-error hover:border-error/30 transition-colors">
                <span className="material-symbols-outlined text-sm">delete</span>
              </button>
            </div>
          </div>

          {/* Reminders */}
          <div className="space-y-3">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Напоминания</p>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input type="datetime-local" value={remDue} onChange={(e) => setRemDue(e.target.value)} className={`${inputCls} [color-scheme:dark]`} />
                <button onClick={addRem} disabled={addReminder.isPending}
                  className="inline-flex items-center justify-center px-3 py-2.5 rounded-xl bg-surface-container border border-white/[0.08] text-on-surface-variant hover:text-primary hover:border-primary/30 disabled:opacity-40 transition-colors">
                  <span className="material-symbols-outlined text-sm">add_alarm</span>
                </button>
              </div>
              <input value={remNote} onChange={(e) => setRemNote(e.target.value)} placeholder="Комментарий к напоминанию…" className={inputCls} />
            </div>
            {remLoading ? (
              <p className="text-xs text-on-surface-variant/60">Загрузка…</p>
            ) : reminders.length === 0 ? (
              <p className="text-xs text-on-surface-variant/60">Нет открытых напоминаний</p>
            ) : (
              <div className="space-y-2">
                {reminders.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 bg-surface-container rounded-xl px-3 py-2">
                    <span className="material-symbols-outlined text-sm text-amber-400 flex-shrink-0">alarm</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-on-surface">{fmtDateTime(r.due_at)}</p>
                      {r.note && <p className="text-[11px] text-on-surface-variant truncate">{r.note}</p>}
                    </div>
                    <button onClick={() => completeReminder.mutate({ id: r.id, clientId: client.id, status: 'done' }, { onSuccess: () => toast.success('Напоминание выполнено') })}
                      title="Выполнено"
                      className="text-primary/70 hover:text-primary transition-colors flex-shrink-0">
                      <span className="material-symbols-outlined text-base">check_circle</span>
                    </button>
                    <button onClick={() => completeReminder.mutate({ id: r.id, clientId: client.id, status: 'dismissed' })}
                      title="Отменить"
                      className="text-on-surface-variant/60 hover:text-error transition-colors flex-shrink-0">
                      <span className="material-symbols-outlined text-base">cancel</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="space-y-3">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">История касаний</p>
            {intLoading ? (
              <p className="text-xs text-on-surface-variant/60">Загрузка…</p>
            ) : interactions.length === 0 ? (
              <p className="text-xs text-on-surface-variant/60">Пока нет ни одного касания</p>
            ) : (
              <div className="space-y-2.5">
                {interactions.map((it) => (
                  <div key={it.id} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg bg-surface-container flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="material-symbols-outlined text-sm text-on-surface-variant">{KIND_ICON[it.kind] ?? 'circle'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-on-surface">{it.comment || KIND_LABEL[it.kind] || it.kind}</p>
                      <p className="text-[10px] font-mono text-on-surface-variant/60 mt-0.5">{fmtDateTime(it.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const KIND_LABEL: Record<InteractionKind, string> = {
  call: 'Звонок',
  message: 'Сообщение',
  meeting: 'Встреча',
  note: 'Заметка',
  status_change: 'Смена статуса',
}

const inputCls =
  'w-full bg-surface-container border border-white/[0.06] rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/30'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider block mb-1">{label}</span>
      {children}
    </label>
  )
}
