'use client'

/**
 * Кабинет → «Сообщения»: переписка пользователя с экспертами AIStart360.
 * Лента — все сообщения диалога (что пришло в Telegram, WhatsApp или на почту,
 * тоже видно здесь), ответ отсюда уходит эксперту. Данные: /api/v1/comm/*
 * (только своя переписка — пользователь берётся из сессии). Обновляется сама:
 * Realtime по новым сообщениям диалога + редкий опрос, пока вкладка открыта.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { BTN_PRIMARY, CARD, CHIP, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import type { ClientMessage } from '@/lib/comm/client'
import { CHANNEL_LABELS, MAX_BODY } from '@/lib/comm/types'

interface ThreadResponse {
  ok: boolean
  error?: string
  data?: { thread: { id: string; status: 'open' | 'closed' } | null; messages: ClientMessage[] }
}

const POLL_MS = 60_000

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function ClientMessages() {
  const [messages, setMessages] = useState<ClientMessage[] | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/comm/thread', { cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as ThreadResponse | null
      if (!res.ok || !body?.ok || !body.data) throw new Error(body?.error || 'Не удалось загрузить сообщения')
      setMessages(body.data.messages)
      setThreadId(body.data.thread?.id ?? null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить сообщения')
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load() }, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  // Realtime: a new message of this conversation (RLS: only the user's own thread).
  useEffect(() => {
    if (!threadId) return
    const sb = createClient()
    const channel = sb
      .channel(`comm-thread-${threadId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comm_messages', filter: `thread_id=eq.${threadId}` }, () => { void load() })
      .subscribe()
    return () => { void sb.removeChannel(channel) }
  }, [threadId, load])

  const count = messages?.length ?? 0
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight }) }, [count])

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/comm/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Не удалось отправить сообщение')
      setText('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить сообщение')
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 text-on-surface sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/client/home" className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface">
            <Icon name="arrow_back" className="text-sm" /> Мой профиль
          </Link>
          <h1 className="mt-1 font-headline text-2xl font-black">Сообщения</h1>
          <p className="text-sm text-on-surface-variant">Переписка с экспертами AIStart360. Ответы из Telegram, WhatsApp и почты тоже появляются здесь.</p>
        </div>
      </div>

      <section className={cn(CARD, 'flex flex-col p-0 sm:p-0')}>
        <div ref={feedRef} className="max-h-[60vh] min-h-[280px] space-y-3 overflow-y-auto p-4 sm:p-5" aria-live="polite">
          {messages === null && !error && <p className="py-10 text-center text-sm text-on-surface-variant">Загружаем…</p>}
          {messages?.length === 0 && (
            <div className="py-10 text-center">
              <Icon name="forum" className="text-3xl text-primary/70" />
              <p className="mt-2 text-sm text-on-surface">Здесь будет ваша переписка с экспертом</p>
              <p className="mt-1 text-xs text-on-surface-variant">Задайте вопрос — эксперт ответит здесь же, а уведомление придёт туда, где вам удобно.</p>
            </div>
          )}
          {messages?.map((m) => {
            const mine = m.direction === 'in'
            return (
              <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[85%] rounded-2xl border px-3.5 py-2.5',
                  mine ? 'border-primary/25 bg-primary/10' : 'border-white/[0.08] bg-white/[0.04]',
                )}>
                  <p className="mb-1 text-[10px] text-on-surface-variant">
                    {mine ? 'Вы' : m.authorName || 'Команда AIStart360'} · {fmtTime(m.createdAt)}
                  </p>
                  {m.subject && <p className="mb-1 text-xs font-semibold">{m.subject}</p>}
                  <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                  {!mine && m.channels.some((c) => c !== 'app') && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {m.channels.filter((c) => c !== 'app').map((c) => (
                        <span key={c} className={cn(CHIP, 'bg-white/[0.05] text-on-surface-variant')}>также в {CHANNEL_LABELS[c]}</span>
                      ))}
                    </div>
                  )}
                  {mine && m.channels[0] && m.channels[0] !== 'app' && (
                    <span className={cn(CHIP, 'mt-1.5 bg-white/[0.05] text-on-surface-variant')}>из {CHANNEL_LABELS[m.channels[0]]}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="border-t border-white/[0.06] p-4 sm:p-5">
          <label htmlFor="comm-reply" className="sr-only">Ваше сообщение</label>
          <textarea
            id="comm-reply"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }}
            rows={3}
            maxLength={MAX_BODY}
            placeholder="Напишите эксперту…"
            className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-base text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary/40 focus:outline-none sm:text-sm"
          />
          {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-on-surface-variant">Ctrl+Enter — отправить</span>
            <button type="button" onClick={() => void send()} disabled={sending || !text.trim()} className={BTN_PRIMARY}>
              <Icon name="send" className="text-sm" />
              {sending ? 'Отправляем…' : 'Отправить'}
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
