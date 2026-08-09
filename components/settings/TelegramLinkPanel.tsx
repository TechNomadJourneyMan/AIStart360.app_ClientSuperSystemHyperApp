'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'

interface TelegramLinkPanelProps {
  initialLinked: boolean
  initialTelegramUsername?: string | null
  personalUsername?: string | null
}

interface LinkResponse {
  ok: boolean
  error?: string
  code?: string | null
  expiresAt?: string
  personalUsername?: string | null
  personalLink?: string | null
}

export default function TelegramLinkPanel({
  initialLinked,
  initialTelegramUsername,
  personalUsername,
}: TelegramLinkPanelProps) {
  const [linked, setLinked] = useState(initialLinked)
  const [telegramUsername, setTelegramUsername] = useState(initialTelegramUsername ?? null)
  const [code, setCode] = useState<string | null>(null)
  const [personalLink, setPersonalLink] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const createLink = async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/integrations/telegram/link', { method: 'POST' })
      const json = (await res.json()) as LinkResponse
      if (!res.ok || !json.ok) throw new Error(json.error || 'Не удалось создать код')
      setCode(json.code ?? null)
      setPersonalLink(json.personalLink ?? null)
      setExpiresAt(json.expiresAt ?? null)
      if (!json.personalLink) {
        // Was: «Укажите TELEGRAM_PERSONAL_USERNAME…» — the name of a server env
        // var shown to the client. That is a message for an admin, not a user.
        setError('Аккаунт ассистента не настроен на сервере — код отправить некуда. Обратитесь к администратору портала.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать код')
    } finally {
      setLoading(false)
    }
  }

  // The panel used to have no way to learn that the code went through: `linked`
  // was only ever set to false. Now the status endpoint (GET on the same route)
  // is re-read on demand. Audit 2026-08-09.
  const checkStatus = async () => {
    setChecking(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/integrations/telegram/link', { cache: 'no-store' })
      const json = (await res.json()) as LinkResponse & { linked?: boolean; telegramUsername?: string | null }
      if (!res.ok || !json.ok) throw new Error(json.error || 'Не удалось проверить статус')
      if (json.linked) {
        setLinked(true)
        setTelegramUsername(json.telegramUsername ?? null)
        setCode(null)
        setPersonalLink(null)
        setExpiresAt(null)
        setNotice('Аккаунт подключён.')
      } else {
        setNotice('Код ещё не получен. Отправьте его в чат и проверьте снова.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось проверить статус')
    } finally {
      setChecking(false)
    }
  }

  const copyCode = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Не удалось скопировать — выделите код вручную.')
    }
  }

  const unlink = async () => {
    setUnlinking(true)
    setError(null)
    try {
      const res = await fetch('/api/integrations/telegram/link', { method: 'DELETE' })
      const json = (await res.json()) as LinkResponse
      if (!res.ok || !json.ok) throw new Error(json.error || 'Не удалось отвязать Telegram')
      setLinked(false)
      setTelegramUsername(null)
      setCode(null)
      setPersonalLink(null)
      setExpiresAt(null)
      setNotice(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отвязать Telegram')
    } finally {
      setUnlinking(false)
    }
  }

  return (
    <div className="border border-outline-variant/20 rounded-lg p-4 bg-surface-container-high/40">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-lg">send</span>
            <h4 className="text-sm font-semibold text-on-surface">Личный Telegram</h4>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full border ${
                linked
                  ? 'text-primary border-primary/30 bg-primary/10'
                  : 'text-on-surface-variant border-outline-variant/20 bg-surface-container'
              }`}
            >
              {linked ? 'Подключён' : 'Не подключён'}
            </span>
          </div>
          <p className="text-xs text-on-surface-variant mt-2">
            Ассистент будет отвечать в личных сообщениях от подключённого аккаунта.
          </p>
          {telegramUsername && (
            <p className="text-xs text-on-surface-variant mt-1">@{telegramUsername}</p>
          )}
          {!personalUsername && (
            <p className="text-xs text-tertiary-container mt-2">
              Интеграция не настроена на сервере — обратитесь к администратору портала.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" leftIcon="link" loading={loading} onClick={createLink}>
            {linked ? 'Новый код' : 'Привязать'}
          </Button>
          {linked && (
            <Button type="button" size="sm" variant="outline" leftIcon="link_off" loading={unlinking} onClick={unlink}>
              Отключить
            </Button>
          )}
        </div>
      </div>

      {code && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <input
              readOnly
              value={code}
              aria-label="Код привязки Telegram"
              className="flex-1 min-w-0 bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-sm font-mono text-on-surface"
            />
            <button
              type="button"
              onClick={copyCode}
              aria-label="Скопировать код привязки"
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant/30 text-xs text-on-surface-variant hover:text-on-surface hover:border-primary/30 transition-colors"
            >
              <span className="material-symbols-outlined text-base">{copied ? 'check' : 'content_copy'}</span>
              {copied ? 'Скопировано' : 'Скопировать'}
            </button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-on-surface-variant">
              Отправьте этот код в личные сообщения {personalUsername ? `@${personalUsername.replace(/^@/, '')}` : 'подключённому аккаунту'}.
            </p>
            <div className="flex flex-wrap gap-2">
              {personalLink && (
                <a
                  href={personalLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:scale-[0.98] transition-transform"
                >
                  <span className="material-symbols-outlined text-base">open_in_new</span>
                  Открыть чат
                </a>
              )}
              <Button type="button" size="sm" variant="outline" leftIcon="refresh" loading={checking} onClick={checkStatus}>
                Проверить подключение
              </Button>
            </div>
          </div>
        </div>
      )}

      {expiresAt && (
        <p className="text-[11px] text-on-surface-variant mt-2">
          Код действует до {new Date(expiresAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.
          Позже нажмите «Новый код».
        </p>
      )}

      {notice && <p className="text-xs text-on-surface-variant mt-3">{notice}</p>}
      {error && <p className="text-xs text-error mt-3">{error}</p>}
    </div>
  )
}
