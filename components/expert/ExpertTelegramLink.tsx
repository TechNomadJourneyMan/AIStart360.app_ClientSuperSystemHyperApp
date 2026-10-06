'use client'

/**
 * «Привязать Telegram» in the expert cabinet: a one-time deep link (15 min) to
 * the expert bot (/api/expert/telegram-link). The bot then sends finished
 * diagnostics, published reports and newly approved clients, and answers
 * questions about clients.
 */
import { useCallback, useEffect, useState } from 'react'

interface Status { linked: boolean; username: string | null; botConfigured: boolean }

export function ExpertTelegramLink() {
  const [status, setStatus] = useState<Status | null>(null)
  const [link, setLink] = useState<{ deepLink: string | null; expiresAt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/expert/telegram-link', { cache: 'no-store' })
      const json = (await res.json()) as Status & { ok: boolean; error?: string }
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Не удалось загрузить статус')
      setStatus({ linked: json.linked, username: json.username, botConfigured: json.botConfigured })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить статус')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // While a link is open, check every few seconds whether the bot bound the account.
  useEffect(() => {
    if (!link || status?.linked) return
    const id = setInterval(() => void load(), 5000)
    return () => clearInterval(id)
  }, [link, status?.linked, load])

  const request = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/expert/telegram-link', { method: 'POST' })
      const json = (await res.json()) as { ok: boolean; deepLink?: string | null; expiresAt?: string; error?: string }
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Не удалось получить ссылку')
      setLink({ deepLink: json.deepLink ?? null, expiresAt: json.expiresAt ?? '' })
      if (json.deepLink) window.open(json.deepLink, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось получить ссылку')
    } finally {
      setBusy(false)
    }
  }

  const unlink = async () => {
    setBusy(true)
    setError(null)
    try {
      await fetch('/api/expert/telegram-link', { method: 'DELETE' })
      setLink(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
      <div className="px-6 py-4 border-b border-white/[0.04] flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-primary/70">send</span>
        <h2 className="text-sm font-headline font-bold text-on-surface">Telegram</h2>
      </div>
      <div className="p-6 space-y-3 text-sm">
        {!status && !error && <p className="text-on-surface-variant">Загрузка…</p>}
        {status && !status.botConfigured && (
          <p className="text-on-surface-variant">Бот экспертов ещё не подключён на сервере. Обратитесь к администратору платформы.</p>
        )}
        {status?.botConfigured && (
          <>
            <p className="text-on-surface-variant">
              {status.linked
                ? <>Привязан{status.username ? <> к <span className="font-mono">@{status.username}</span></> : ''}. Сюда приходят завершённые диагностики, опубликованные отчёты и новые клиенты; в боте можно открыть карточку любого клиента.</>
                : 'Привяжите Telegram, чтобы получать завершённые диагностики, опубликованные отчёты и новых клиентов, и смотреть карточки клиентов прямо в мессенджере.'}
            </p>
            {link && !status.linked && (
              <p className="text-xs text-on-surface-variant">
                {link.deepLink
                  ? <>Ссылка одноразовая, действует 15 минут. Если Telegram не открылся — <a className="text-primary underline" href={link.deepLink} target="_blank" rel="noopener noreferrer">откройте бота</a> и нажмите «Start».</>
                  : 'Ссылку построить нельзя: не задано имя бота (TELEGRAM_EXPERT_BOT_USERNAME).'}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => void request()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 border border-primary/30 text-primary text-sm font-medium px-4 py-2 transition-all disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">link</span>
                {status.linked ? 'Привязать другой аккаунт' : 'Привязать Telegram'}
              </button>
              {status.linked && (
                <button
                  onClick={() => void unlink()}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] text-on-surface-variant hover:text-on-surface text-sm px-4 py-2 transition-all disabled:opacity-50"
                >
                  Отвязать
                </button>
              )}
            </div>
          </>
        )}
        {error && <div className="p-3 rounded-xl bg-error/5 border border-error/20 text-xs text-error">{error}</div>}
      </div>
    </section>
  )
}
