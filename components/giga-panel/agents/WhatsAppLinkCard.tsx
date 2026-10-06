'use client'

/**
 * WhatsApp of the signed-in staff member (/api/giga-admin/whatsapp-link):
 * number + 6-digit code (10 min) + consent → staff alerts in WhatsApp by
 * level, with quiet hours and cooldown like Telegram. Approval decisions stay
 * in GIGA: the message carries a link, not buttons.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { MessageSquare, Pause, Play, Send, Trash2 } from 'lucide-react'
import { Badge, Button, ConfirmDialog, ErrorState, Panel, Select, Skeleton, fmtDateTime, gigaFetch, inputClass, useGigaQuery } from '../kit'

type Level = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL'

interface WhatsAppLinkStatus {
  phone: string | null
  verified: boolean
  optedIn: boolean
  minLevel: Level
  mutedUntil: string | null
  pending: { phoneMasked: string; expiresAt: string } | null
  available: boolean
}

const LEVELS: ReadonlyArray<{ value: Level; label: string }> = [
  { value: 'INFO', label: 'Все уровни' },
  { value: 'SUCCESS', label: 'Готово и выше' },
  { value: 'WARNING', label: 'Внимание и выше' },
  { value: 'CRITICAL', label: 'Только критичные' },
]

const LINK_URL = '/api/giga-admin/whatsapp-link'

export function WhatsAppLinkCard() {
  const q = useGigaQuery<WhatsAppLinkStatus>(LINK_URL)
  const s = q.data
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [code, setCode] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [askRemove, setAskRemove] = useState(false)

  const post = async (key: string, json: unknown, okText?: string): Promise<boolean> => {
    setBusy(key)
    setError(null)
    try {
      await gigaFetch(LINK_URL, { method: 'POST', json })
      await q.reload()
      if (okText) toast.success(okText)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выполнить действие')
      return false
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy('remove')
    setError(null)
    try {
      await gigaFetch(LINK_URL, { method: 'DELETE' })
      setAskRemove(false)
      await q.reload()
      toast.success('Номер удалён')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить номер')
    } finally {
      setBusy(null)
    }
  }

  const showForm = !!s?.available && (!s.verified || editing)
  const muted = s?.mutedUntil ? s.mutedUntil : null

  return (
    <Panel
      title={<span className="flex items-center gap-2"><MessageSquare size={14} className="text-emerald-300" /> Мой WhatsApp</span>}
      description="Уведомления команде в WhatsApp: те же уровни, тихие часы и паузы, что в Telegram. Одобрения — по ссылке в GIGA."
      actions={s && (!s.available ? <Badge tone="amber">Не настроен</Badge> : s.optedIn ? <Badge tone="green">включён</Badge> : s.verified ? <Badge>выключен</Badge> : <Badge>не привязан</Badge>)}
    >
      {q.error && <ErrorState error={q.error} onRetry={() => void q.reload()} />}
      {!s && q.loading && <Skeleton className="h-24" />}
      {s && (
        <div className="space-y-3 text-xs">
          {!s.available && (
            <p className="rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-[11px] leading-relaxed text-amber-200">
              WhatsApp не настроен: на сервере нужны WHATSAPP_TOKEN и WHATSAPP_PHONE_NUMBER_ID (Cloud API) или включённый мост WhatsApp Web с WHATSAPP_WEB_BRIDGE_FALLBACK=1. Инструкция — docs/platform/10-bot-and-credentials.md, раздел «WhatsApp».
            </p>
          )}

          {s.available && s.verified && !editing && (
            <>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5 text-slate-200">
                Номер <span className="font-mono">{s.phone}</span> подтверждён.
                {s.optedIn ? ' Уведомления приходят.' : ' Уведомления выключены.'}
              </div>
              {s.optedIn && (
                <div className="flex flex-wrap items-center gap-2">
                  <Select label="Уровень WhatsApp" value={s.minLevel} options={LEVELS} onChange={(v) => void post('level', { action: 'prefs', minLevel: v }, 'Уровень сохранён')} />
                  {muted ? (
                    <Button size="sm" variant="ghost" icon={<Play size={12} />} loading={busy === 'mute'} onClick={() => void post('mute', { action: 'prefs', mutedUntil: null }, 'Пауза снята')}>
                      Пауза до {fmtDateTime(muted)} — снять
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" icon={<Pause size={12} />} loading={busy === 'mute'} onClick={() => void post('mute', { action: 'prefs', mutedUntil: new Date(Date.now() + 8 * 3600_000).toISOString() }, 'Пауза на 8 часов')}>
                      Пауза 8 ч
                    </Button>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={s.optedIn ? 'secondary' : 'primary'} loading={busy === 'toggle'} disabled={!!busy}
                  onClick={() => void post('toggle', { action: s.optedIn ? 'opt_out' : 'opt_in' }, s.optedIn ? 'WhatsApp выключен' : 'WhatsApp включён')}>
                  {s.optedIn ? 'Выключить' : 'Включить'}
                </Button>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setEditing(true); setPhone(s.phone ?? '') }}>Изменить номер</Button>
                <Button size="sm" variant="danger" icon={<Trash2 size={12} />} disabled={!!busy} onClick={() => setAskRemove(true)}>Удалить</Button>
              </div>
            </>
          )}

          {showForm && (
            <>
              <input className={inputClass} type="tel" inputMode="tel" placeholder="+7 700 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Номер WhatsApp" />
              <label className="flex items-start gap-2 text-[11px] text-slate-400">
                <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>Согласен получать уведомления платформы в WhatsApp на этот номер. Отключить можно в любой момент.</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" icon={<Send size={12} />} loading={busy === 'start'} disabled={!!busy || !consent || phone.trim().length < 5}
                  onClick={() => void post('start', { action: 'start', phone, consent }, 'Код отправлен в WhatsApp').then((ok) => ok && setCode(''))}>
                  {s.pending ? 'Отправить код ещё раз' : 'Получить код'}
                </Button>
                {editing && <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Отмена</Button>}
              </div>
              {s.pending && (
                <div className="rounded-xl border border-blue-500/25 bg-blue-500/[0.06] px-3 py-2.5 space-y-2">
                  <p className="text-[11px] text-slate-300">Код отправлен на {s.pending.phoneMasked}, действует до {fmtDateTime(s.pending.expiresAt)}.</p>
                  <div className="flex gap-2">
                    <input className={`${inputClass} font-mono tracking-widest`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000"
                      value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="Код из WhatsApp" />
                    <Button size="sm" variant="primary" loading={busy === 'confirm'} disabled={!!busy || code.length !== 6}
                      onClick={() => void post('confirm', { action: 'confirm', code }, 'Номер подтверждён').then((ok) => { if (ok) { setEditing(false); setCode('') } })}>
                      Подтвердить
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {error && <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</p>}
        </div>
      )}

      <ConfirmDialog
        open={askRemove}
        onClose={() => setAskRemove(false)}
        title="Удалить номер WhatsApp?"
        text="Уведомления в WhatsApp перестанут приходить. Привязать номер снова можно в любой момент — понадобится новый код."
        confirmLabel="Удалить"
        loading={busy === 'remove'}
        onConfirm={() => void remove()}
      />
    </Panel>
  )
}
