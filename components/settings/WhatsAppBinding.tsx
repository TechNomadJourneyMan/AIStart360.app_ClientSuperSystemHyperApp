'use client'

/**
 * «WhatsApp» — the person's number for notifications: enter the number, agree,
 * receive a 6-digit code in WhatsApp (valid 10 minutes), confirm; then turn
 * messages on/off at any time. Used in the client's Настройки › Уведомления
 * (CRM digest, /api/whatsapp/link) and in the expert cabinet
 * (/api/expert/whatsapp-link). Contract: lib/whatsapp/link-api.ts.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

type Level = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL'

interface Status {
  ok: boolean
  phone: string | null
  verified: boolean
  optedIn: boolean
  minLevel: Level
  mutedUntil: string | null
  pending: { phoneMasked: string; expiresAt: string } | null
  available: boolean
  suggestedPhone: string | null
}

const LEVELS: Array<{ value: Level; label: string }> = [
  { value: 'INFO', label: 'Все уведомления' },
  { value: 'SUCCESS', label: 'Готово и важнее' },
  { value: 'WARNING', label: 'Внимание и критичные' },
  { value: 'CRITICAL', label: 'Только критичные' },
]

async function call(endpoint: string, init?: { method?: string; body?: unknown }): Promise<Status> {
  const res = await fetch(endpoint, {
    method: init?.method ?? 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as Partial<Status> & { error?: string }
  if (!res.ok || !json.ok) throw new Error(json.error || 'Не удалось выполнить действие')
  return json as Status
}

export function WhatsAppBinding({
  endpoint,
  purpose,
  showLevels = false,
  framed = false,
}: {
  endpoint: string
  /** One line: what will arrive in WhatsApp. */
  purpose: string
  /** Experts/staff choose a level and can pause; clients get only the digest. */
  showLevels?: boolean
  /** Render as a standalone section (expert cabinet) instead of a block inside a card. */
  framed?: boolean
}) {
  const [s, setS] = useState<Status | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [code, setCode] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const next = await call(endpoint)
      setS(next)
      setLoadError(null)
      setPhone((p) => p || next.suggestedPhone || '')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить')
    }
  }, [endpoint])

  useEffect(() => { void load() }, [load])

  const run = async (key: string, body: unknown, method = 'POST', ok?: string) => {
    setBusy(key)
    setError(null)
    try {
      if (method === 'DELETE') {
        const res = await fetch(endpoint, { method: 'DELETE', credentials: 'include' })
        if (!res.ok) throw new Error('Не удалось удалить номер')
        await load()
      } else {
        const res = await fetch(endpoint, {
          method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        if (!res.ok || !json.ok) throw new Error(json.error || 'Не удалось выполнить действие')
        await load()
      }
      if (ok) toast.success(ok)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
      return false
    } finally {
      setBusy(null)
    }
  }

  const start = async () => {
    if (await run('start', { action: 'start', phone, consent }, 'POST', 'Код отправлен в WhatsApp')) setCode('')
  }
  const confirm = async () => {
    if (await run('confirm', { action: 'confirm', code }, 'POST', 'Номер подтверждён — уведомления включены')) {
      setEditing(false)
      setCode('')
    }
  }

  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40'
  const primary = `${btn} bg-primary/15 border border-primary/30 text-primary hover:bg-primary/25`
  const ghost = `${btn} border border-white/[0.08] text-on-surface-variant hover:bg-white/[0.04]`
  const input = 'w-full bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50'

  const showForm = s && s.available && (!s.verified || editing)
  const muted = s?.mutedUntil ? new Date(s.mutedUntil) : null

  const body = (
    <div className="space-y-3">
      {!s && !loadError && <p className="text-xs text-on-surface-variant">Загрузка…</p>}
      {loadError && <p className="text-xs text-error">{loadError}</p>}
      {s && !s.available && (
        <p className="text-xs text-on-surface-variant">WhatsApp пока не подключён на платформе — обратитесь к администратору.</p>
      )}

      {s?.available && s.verified && !editing && (
        <>
          <p className="text-xs text-on-surface-variant">
            Номер <span className="font-mono text-on-surface">{s.phone}</span> подтверждён.{' '}
            {s.optedIn ? purpose : 'Сообщения выключены — включите, чтобы получать их снова.'}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-on-surface-variant">Получать уведомления в WhatsApp</span>
            <button
              type="button" role="switch" aria-checked={s.optedIn} aria-label="Уведомления в WhatsApp" disabled={!!busy}
              onClick={() => void run('toggle', { action: s.optedIn ? 'opt_out' : 'opt_in' }, 'POST', s.optedIn ? 'Уведомления в WhatsApp выключены' : 'Уведомления в WhatsApp включены')}
              className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${s.optedIn ? 'bg-primary' : 'bg-surface-container-high'}`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${s.optedIn ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          {showLevels && s.optedIn && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-on-surface-variant" htmlFor={`${endpoint}-level`}>Уровень</label>
              <select
                id={`${endpoint}-level`} value={s.minLevel} disabled={!!busy}
                onChange={(e) => void run('level', { action: 'prefs', minLevel: e.target.value })}
                className="bg-surface-container-high border border-outline-variant/30 rounded-lg px-2 py-1.5 text-xs text-on-surface"
              >
                {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
              {muted ? (
                <button className={ghost} disabled={!!busy} onClick={() => void run('mute', { action: 'prefs', mutedUntil: null }, 'POST', 'Пауза снята')}>
                  Пауза до {muted.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — снять
                </button>
              ) : (
                <button className={ghost} disabled={!!busy} onClick={() => void run('mute', { action: 'prefs', mutedUntil: new Date(Date.now() + 8 * 3600_000).toISOString() }, 'POST', 'Пауза на 8 часов')}>
                  Пауза на 8 часов
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button className={ghost} disabled={!!busy} onClick={() => { setEditing(true); setPhone(s.phone ?? '') }}>Изменить номер</button>
            <button className={ghost} disabled={!!busy} onClick={() => void run('delete', null, 'DELETE', 'Номер удалён')}>Удалить номер</button>
          </div>
        </>
      )}

      {showForm && (
        <>
          <p className="text-xs text-on-surface-variant">{purpose} Укажите номер WhatsApp — пришлём код подтверждения.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className={input} type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 700 123 45 67"
              value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Номер WhatsApp"
            />
            <button className={`${primary} justify-center whitespace-nowrap`} disabled={!!busy || !consent || phone.trim().length < 5} onClick={() => void start()}>
              {s?.pending ? 'Отправить код ещё раз' : 'Получить код'}
            </button>
          </div>
          <label className="flex items-start gap-2 text-xs text-on-surface-variant">
            <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>Согласен получать уведомления AIStart360 в WhatsApp на этот номер. Отключить можно в любой момент.</span>
          </label>
          {s?.pending && (
            <div className="rounded-lg border border-primary/20 bg-primary/[0.05] p-3 space-y-2">
              <p className="text-xs text-on-surface-variant">
                Код отправлен на {s.pending.phoneMasked}. Он действует до{' '}
                {new Date(s.pending.expiresAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.
              </p>
              <div className="flex gap-2">
                <input
                  className={`${input} font-mono tracking-widest`} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="Код из WhatsApp"
                />
                <button className={primary} disabled={!!busy || code.length !== 6} onClick={() => void confirm()}>Подтвердить</button>
              </div>
            </div>
          )}
          {editing && <button className={ghost} onClick={() => setEditing(false)}>Отмена</button>}
        </>
      )}

      {error && <p role="alert" className="rounded-lg border border-error/20 bg-error/5 p-2 text-xs text-error">{error}</p>}
    </div>
  )

  if (framed) {
    return (
      <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.04] flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary/70">chat</span>
          <h2 className="text-sm font-headline font-bold text-on-surface">WhatsApp</h2>
        </div>
        <div className="p-6">{body}</div>
      </section>
    )
  }
  return (
    <div className="mt-5 pt-4 border-t border-outline-variant/10">
      <p className="text-sm font-medium text-on-surface flex items-center gap-1.5 mb-2">
        <span className="material-symbols-outlined text-base text-primary">chat</span>
        WhatsApp
      </p>
      {body}
    </div>
  )
}
