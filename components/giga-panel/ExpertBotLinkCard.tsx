'use client'

/**
 * «Бот экспертов» in the SuperExpert cabinet: a one-time deep link (15 min) to
 * the expert Telegram bot. Same API as the expert portal card
 * (/api/expert/telegram-link), which admits experts and SuperExperts alike.
 * The bot sends finished diagnostics, reports to review (with publish / needs
 * changes buttons) and newly approved clients.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ExternalLink, Link2, MessageCircle, Unlink } from 'lucide-react'
import { Badge, Button, Panel, Skeleton } from './kit'

interface Status { linked: boolean; username: string | null; botConfigured: boolean }

const POLL_MS = 5000

export function ExpertBotLinkCard() {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<{ deepLink: string | null; expiresAt: string } | null>(null)
  const [busy, setBusy] = useState<'link' | 'unlink' | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/expert/telegram-link', { cache: 'no-store' })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.ok) { setError(d?.error === 'forbidden' ? 'Нет доступа к боту экспертов' : 'Не удалось загрузить статус'); return }
      setError(null)
      setStatus({ linked: !!d.linked, username: d.username ?? null, botConfigured: !!d.botConfigured })
    } catch {
      setError('Не удалось загрузить статус')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // While a link is open, check whether the bot bound the account.
  const waiting = !!link && !status?.linked && Date.parse(link.expiresAt) > Date.now()
  useEffect(() => {
    if (!waiting) return
    const id = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(id)
  }, [waiting, load])
  useEffect(() => {
    if (link && status?.linked) { setLink(null); toast.success('Telegram привязан') }
  }, [link, status?.linked])

  const request = async () => {
    setBusy('link')
    try {
      const res = await fetch('/api/expert/telegram-link', { method: 'POST' })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.ok) { toast.error(d?.error ?? 'Не удалось получить ссылку'); return }
      setLink({ deepLink: d.deepLink ?? null, expiresAt: d.expiresAt })
      if (d.deepLink) window.open(d.deepLink, '_blank', 'noopener,noreferrer')
    } finally {
      setBusy(null)
    }
  }

  const unlink = async () => {
    setBusy('unlink')
    try {
      await fetch('/api/expert/telegram-link', { method: 'DELETE' })
      setLink(null)
      await load()
      toast.success('Telegram отвязан')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel
      title={<span className="flex items-center gap-2"><MessageCircle size={14} className="text-blue-300" /> Бот экспертов</span>}
      description="Завершённые диагностики, отчёты на проверку с кнопками «Опубликовать / Нужны правки» и новые клиенты — в Telegram."
      actions={status && (status.linked ? <Badge tone="green">привязан</Badge> : status.botConfigured ? <Badge>не привязан</Badge> : <Badge tone="amber">Бот не настроен</Badge>)}
    >
      {error && <p className="text-[11px] text-red-300">{error}</p>}
      {!status && !error && <Skeleton className="h-16" />}
      {status && (
        <div className="space-y-3 text-xs">
          {!status.botConfigured ? (
            <p className="leading-relaxed text-amber-200">Бот экспертов ещё не подключён на сервере. Обратитесь к администратору платформы.</p>
          ) : (
            <>
              <p className="leading-relaxed text-slate-400">
                {status.linked
                  ? <>Привязан{status.username ? <> к <span className="font-mono text-slate-200">@{status.username}</span></> : ''}.</>
                  : 'Нажмите «Привязать Telegram» — откроется бот. Нажмите в нём «Start», и аккаунт привяжется.'}
              </p>
              {link && !status.linked && (
                <p className="text-[11px] text-slate-400">
                  {link.deepLink
                    ? <>Ссылка одноразовая, действует 15 минут. Если Telegram не открылся — <a className="inline-flex items-center gap-1 text-blue-300 underline" href={link.deepLink} target="_blank" rel="noopener noreferrer">откройте бота <ExternalLink size={11} /></a>.</>
                    : 'Ссылку построить нельзя: не задано имя бота (TELEGRAM_EXPERT_BOT_USERNAME).'}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={<Link2 size={12} />} loading={busy === 'link'} onClick={() => void request()}>
                  {status.linked ? 'Привязать другой аккаунт' : 'Привязать Telegram'}
                </Button>
                {status.linked && (
                  <Button size="sm" variant="ghost" icon={<Unlink size={12} />} loading={busy === 'unlink'} onClick={() => void unlink()}>
                    Отвязать
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Panel>
  )
}
