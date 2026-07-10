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
  const [error, setError] = useState<string | null>(null)

  const createLink = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/integrations/telegram/link', { method: 'POST' })
      const json = (await res.json()) as LinkResponse
      if (!res.ok || !json.ok) throw new Error(json.error || 'Не удалось создать код')
      setCode(json.code ?? null)
      setPersonalLink(json.personalLink ?? null)
      setExpiresAt(json.expiresAt ?? null)
      if (!json.personalLink) {
        setError('Укажите TELEGRAM_PERSONAL_USERNAME, чтобы открыть личный Telegram-аккаунт из портала.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать код')
    } finally {
      setLoading(false)
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
              Для ссылки на аккаунт задайте TELEGRAM_PERSONAL_USERNAME.
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
          <input
            readOnly
            value={code}
            className="w-full bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-sm font-mono text-on-surface"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-on-surface-variant">
              Отправьте этот код в личные сообщения {personalUsername ? `@${personalUsername.replace(/^@/, '')}` : 'подключённому аккаунту'}.
            </p>
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
          </div>
        </div>
      )}

      {expiresAt && (
        <p className="text-[11px] text-on-surface-variant mt-2">
          Ссылка активна до {new Date(expiresAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.
        </p>
      )}

      {error && <p className="text-xs text-error mt-3">{error}</p>}
    </div>
  )
}
