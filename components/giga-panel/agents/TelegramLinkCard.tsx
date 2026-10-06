'use client'

/**
 * Telegram of the signed-in staff member: alerts and approval buttons.
 * GET status · POST one-time deep link (15 min) · DELETE unlink
 * (/api/giga-admin/telegram-link). Break-glass sessions cannot link — the API
 * says so and the card shows it.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, ExternalLink, Link2, MessageCircle, RefreshCw, Unlink } from 'lucide-react'
import { useStaff } from '../StaffContext'
import { Badge, Button, ConfirmDialog, ErrorState, Panel, Skeleton, fmtDateTime, gigaFetch, useGigaQuery } from '../kit'
import { fmtCountdown, notificationLevelMeta } from './model'
import type { TelegramLinkStatus } from './types'
import { StatusChip, useNow } from './ui'

const POLL_MS = 5000

export function TelegramLinkCard() {
  const { can } = useStaff()
  const q = useGigaQuery<TelegramLinkStatus>('/api/giga-admin/telegram-link')
  const [link, setLink] = useState<{ deepLink: string | null; expiresAt: string; before: { linked: boolean; username: string | null } } | null>(null)
  const [busy, setBusy] = useState<'link' | 'unlink' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [askUnlink, setAskUnlink] = useState(false)
  const now = useNow(15_000)
  const s = q.data
  const cd = link ? fmtCountdown(link.expiresAt, now) : null
  // Bound by the bot since the link was issued (a new account, or the first one).
  const bound = !!link && !!s?.linked && (!link.before.linked || s.username !== link.before.username)
  const waiting = !!link && !cd?.expired && !bound
  const { reload } = q

  // While a link is open, check every few seconds whether the bot bound the account.
  useEffect(() => {
    if (!waiting) return
    const id = setInterval(() => void reload(), POLL_MS)
    return () => clearInterval(id)
  }, [waiting, reload])
  useEffect(() => {
    if (bound) { setLink(null); toast.success('Telegram привязан') }
  }, [bound])

  const requestLink = async () => {
    setBusy('link')
    setError(null)
    try {
      const r = await gigaFetch<{ deepLink: string | null; expiresAt: string }>('/api/giga-admin/telegram-link', { method: 'POST' })
      setLink({ ...r, before: { linked: !!s?.linked, username: s?.username ?? null } })
      if (r.deepLink) window.open(r.deepLink, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось получить ссылку')
    } finally {
      setBusy(null)
    }
  }

  const unlink = async () => {
    setBusy('unlink')
    setError(null)
    try {
      await gigaFetch('/api/giga-admin/telegram-link', { method: 'DELETE' })
      toast.success('Telegram отвязан')
      setAskUnlink(false)
      setLink(null)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отвязать')
    } finally {
      setBusy(null)
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Ссылка скопирована')
    } catch {
      toast.error('Не удалось скопировать — выделите ссылку вручную')
    }
  }

  return (
    <Panel
      title={<span className="flex items-center gap-2"><MessageCircle size={14} className="text-blue-300" /> Мой Telegram</span>}
      description="Срочные уведомления и кнопки «Одобрить / Отклонить» прямо в мессенджере."
      actions={s && (s.linked ? <Badge tone="green">привязан</Badge> : s.botConfigured ? <Badge>не привязан</Badge> : <Badge tone="amber">Бот не настроен</Badge>)}
    >
      {q.error && (q.error.status === 403 ? (
        <p className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-[11px] leading-relaxed text-slate-400">
          {q.error.message}. Войдите в панель через свой аккаунт сотрудника, чтобы привязать Telegram и получать запросы на одобрение.
        </p>
      ) : <ErrorState error={q.error} onRetry={() => void reload()} />)}
      {!s && q.loading && <Skeleton className="h-28" />}
      {s && (
        <div className="space-y-3 text-xs">
          {!s.botConfigured ? (
            <p className="rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-[11px] leading-relaxed text-amber-200">
              Бот не настроен: на сервере нужны TELEGRAM_ADMIN_BOT_TOKEN и TELEGRAM_ADMIN_WEBHOOK_SECRET (бот-панель управления) или TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET. Пока их нет, уведомления видны только здесь, в ленте.
            </p>
          ) : s.linked ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5">
              <p className="text-slate-200">Привязан{s.username ? <> к <span className="font-mono">@{s.username}</span></> : ''}.</p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                Приходят уведомления от уровня <StatusChip meta={notificationLevelMeta(s.minLevel)} /> и выше.
              </p>
            </div>
          ) : (
            <p className="leading-relaxed text-slate-400">
              Нажмите «Привязать Telegram» — откроется бот. Нажмите в нём «Start», и аккаунт привяжется к вашему профилю сотрудника.
              {s.bot === 'admin' && ' В боте-панели доступны статус платформы, агенты, одобрения, заявки, клиенты, отчёты, ключи и расходы — в пределах прав вашей роли.'}
            </p>
          )}

          {link && (
            <div className="rounded-xl border border-blue-500/25 bg-blue-500/[0.06] px-3 py-2.5">
              {link.deepLink ? (
                <>
                  <p className="text-slate-200">Ссылка для привязки готова.</p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Одноразовая, действует 15 минут — до {fmtDateTime(link.expiresAt)}
                    {cd && <> ({cd.expired ? 'истекла' : cd.text})</>}.
                  </p>
                  {!cd?.expired && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <a href={link.deepLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-blue-400/40 bg-blue-500 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
                        <ExternalLink size={12} /> Открыть в Telegram
                      </a>
                      <Button size="sm" icon={<Copy size={12} />} onClick={() => void copy(link.deepLink!)}>Скопировать ссылку</Button>
                      <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} loading={q.loading} onClick={() => void reload()}>Проверить</Button>
                    </div>
                  )}
                  {waiting && <p className="mt-2 text-[10px] text-slate-500">Ждём подтверждения от бота — статус обновится сам.</p>}
                </>
              ) : (
                <p className="text-[11px] text-amber-200">Ссылку построить нельзя: не задано имя бота (TELEGRAM_BOT_USERNAME). Обратитесь к администратору платформы.</p>
              )}
            </div>
          )}

          {error && <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</p>}

          <div className="flex flex-wrap gap-2">
            {s.botConfigured && (
              <Button size="sm" variant={s.linked ? 'secondary' : 'primary'} icon={<Link2 size={12} />} loading={busy === 'link'} disabled={!!busy} onClick={() => void requestLink()}>
                {s.linked ? 'Привязать другой аккаунт' : link ? 'Новая ссылка' : 'Привязать Telegram'}
              </Button>
            )}
            {s.linked && (
              <Button size="sm" variant="danger" icon={<Unlink size={12} />} disabled={!!busy} onClick={() => setAskUnlink(true)}>Отвязать</Button>
            )}
          </div>

          <div className="space-y-1 border-t border-white/[0.05] pt-3 text-[11px] leading-relaxed text-slate-500">
            <p>Кнопки одобрения в Telegram работают, только если аккаунт привязан и у вашей роли есть право «Решения по действиям агентов». Запросы на одобрение получают только такие сотрудники.</p>
            <p>
              Ваша роль:{' '}
              {can('approvals.decide')
                ? <span className="text-emerald-300">может решать запросы агентов</span>
                : <span className="text-slate-300">получает только уведомления, без кнопок решения</span>}
              .
            </p>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={askUnlink}
        onClose={() => setAskUnlink(false)}
        title="Отвязать Telegram?"
        text="Уведомления и запросы на одобрение перестанут приходить в этот Telegram. Привязать снова можно в любой момент."
        confirmLabel="Отвязать"
        loading={busy === 'unlink'}
        onConfirm={() => void unlink()}
      />
    </Panel>
  )
}
