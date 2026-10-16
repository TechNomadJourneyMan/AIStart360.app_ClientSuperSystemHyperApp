'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, LogOut, RefreshCw, Send } from 'lucide-react'

/**
 * Telegram in the GIGA «Единый inbox»: the business bot connection block
 * (token → @username, webhook, last update) and the platform client bot
 * source. The token is sent once to the server and never comes back.
 */

export interface TelegramBotConnectionView {
  id: string
  bot_id: string
  bot_username: string
  bot_name: string | null
  status: 'pending' | 'active' | 'error'
  webhook_ok: boolean
  webhook_set_at: string | null
  last_update_at: string | null
  last_error: string | null
  connected_at: string
}

export interface TelegramInboxStatus {
  connection: TelegramBotConnectionView | null
  encryption_configured: boolean
  client_bot: { configured: boolean; username: string | null; inbox_enabled: boolean }
  error?: string
}

/** Contact ids are `tgbot:<bot>:<user>` (business bot) or `tgclient:<bot>:<user>` (platform bot). */
export function telegramSourceLabel(
  contactExternalId: string | null | undefined,
  status: TelegramInboxStatus | null,
): string | null {
  if (!contactExternalId) return null
  if (contactExternalId.startsWith('tgclient:')) return 'Бот AIStart360'
  if (contactExternalId.startsWith('tgbot:')) {
    const botId = contactExternalId.split(':')[1]
    const connection = status?.connection
    return connection && connection.bot_id === botId ? `@${connection.bot_username}` : 'Бизнес-бот'
  }
  return null
}

export function isTelegramBotReady(status: TelegramInboxStatus | null): boolean {
  return status?.connection?.status === 'active' && status.connection.webhook_ok === true
}

export function useTelegramInboxBot() {
  const [status, setStatus] = useState<TelegramInboxStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async (verify = false, notifyOnError = false) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/giga-admin/omnichannel/telegram${verify ? '?verify=1' : ''}`, { cache: 'no-store' })
      const json = (await res.json()) as TelegramInboxStatus
      if (!res.ok && json.error) throw new Error(json.error)
      setStatus(json)
    } catch (error) {
      if (notifyOnError) toast.error(error instanceof Error ? error.message : 'Не удалось получить статус Telegram')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])
  return { status, setStatus, loading, reload }
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

export function TelegramBotConnectBlock({
  status,
  loading,
  onStatus,
  onReload,
}: {
  status: TelegramInboxStatus | null
  loading: boolean
  onStatus: (status: TelegramInboxStatus) => void
  onReload: (verify?: boolean, notifyOnError?: boolean) => Promise<void>
}) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null)
  const connection = status?.connection ?? null

  async function connect() {
    if (busy || !token.trim()) return
    setBusy('connect')
    try {
      const res = await fetch('/api/giga-admin/omnichannel/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      const json = (await res.json()) as TelegramInboxStatus & { error?: string }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setToken('')
      onStatus(json)
      toast.success(`Бот @${json.connection?.bot_username ?? ''} подключён`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось подключить бота')
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    if (busy || !connection) return
    if (!window.confirm(`Отключить @${connection.bot_username}? Webhook будет снят, токен удалён. Диалоги останутся в inbox.`)) return
    setBusy('disconnect')
    try {
      const res = await fetch('/api/giga-admin/omnichannel/telegram', { method: 'DELETE' })
      const json = (await res.json()) as TelegramInboxStatus & { error?: string; webhook_deleted?: boolean }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      onStatus(json)
      if (json.webhook_deleted === false) toast.warning('Бот отключён, но Telegram не подтвердил снятие webhook')
      else toast.success('Telegram-бот отключён')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось отключить бота')
    } finally {
      setBusy(null)
    }
  }

  const statusBadge = !connection
    ? { text: 'Не подключён', cls: 'bg-white/[0.04] text-slate-400 border-white/[0.08]' }
    : connection.status === 'active' && connection.webhook_ok
      ? { text: 'Подключён', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' }
      : connection.status === 'pending'
        ? { text: 'Подключаем', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/20' }
        : { text: 'Ошибка webhook', cls: 'bg-red-500/10 text-red-300 border-red-500/20' }

  return (
    <div className="rounded-xl bg-sky-500/[0.04] border border-sky-500/15 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-sky-300">Бизнес-бот Telegram</p>
        <span className={`px-2 py-0.5 rounded-lg border text-[10px] ${statusBadge.cls}`}>
          {loading && !status ? 'Проверяем…' : statusBadge.text}
        </span>
      </div>

      {connection ? (
        <div className="space-y-1 text-[10px] text-slate-400">
          <p><span className="text-slate-200 font-semibold">@{connection.bot_username}</span>{connection.bot_name ? ` · ${connection.bot_name}` : ''}</p>
          <p>Webhook: {connection.webhook_ok ? 'работает' : 'не подтверждён'}{connection.last_error ? ` · ${connection.last_error}` : ''}</p>
          <p>Последнее сообщение: {formatTime(connection.last_update_at)}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => void onReload(true, true)}
              disabled={loading || busy !== null}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] text-slate-300 bg-white/[0.04] border border-white/[0.08] disabled:opacity-40"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Проверить webhook
            </button>
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 disabled:opacity-40"
            >
              {busy === 'disconnect' ? <Loader2 size={11} className="animate-spin" /> : <LogOut size={11} />} Отключить
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Создайте бота в @BotFather и вставьте его токен. Сервер проверит токен, сохранит его в зашифрованном виде и сам настроит webhook. Токен больше нигде не показывается.
          </p>
          {status && !status.encryption_configured && (
            <p className="text-[10px] text-amber-300">На сервере не задан SECRETS_ENCRYPTION_KEY — подключение недоступно.</p>
          )}
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="123456789:AA…"
              disabled={busy !== null || status?.encryption_configured === false}
              className="flex-1 min-w-0 rounded-lg bg-white/[0.04] border border-white/[0.08] px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-700 outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void connect()}
              disabled={busy !== null || !token.trim() || status?.encryption_configured === false}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-sky-500/15 text-sky-300 border border-sky-500/20 disabled:opacity-40 whitespace-nowrap"
            >
              {busy === 'connect' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Подключить Telegram-бота
            </button>
          </div>
        </div>
      )}

      <p className="text-[10px] text-slate-600 border-t border-white/[0.05] pt-2">
        {status?.client_bot.inbox_enabled
          ? `Также сюда попадают сообщения клиентского бота${status.client_bot.username ? ` @${status.client_bot.username}` : ''} («Бот AIStart360») из чатов без привязки к профилю — только черновики, отправляет оператор.`
          : 'Клиентский бот AIStart360 не передаёт сообщения в inbox (не настроен токен/секрет webhook или выключено).'}
      </p>
    </div>
  )
}
