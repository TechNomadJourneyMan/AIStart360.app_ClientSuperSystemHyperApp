'use client'

/**
 * The unified AI chat panel (spec 2026-10-12 §6): one chat over the company's
 * data on every screen. Opened by openAiChat() (components/ai-chat/open.ts) —
 * «Спросить AI» on Point A / a block / GRI, or Гри. Streams progress, shows
 * proposed changes as «было → станет» cards with «Применить» / «Отмена»,
 * keeps the conversation (per screen) on the server.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BodyPortal } from '@/components/ui/body-portal'
import { cn } from '@/lib/utils'
import { OPEN_CHAT_EVENT, type OpenChatDetail } from './open'
import { readEvents, type StreamEvent } from './stream'

type Surface = NonNullable<OpenChatDetail['surface']>
type Preview = { title: string; before: string | null; after: string; note?: string | null }
type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'action'; id: string; preview?: Preview; status: 'pending' | 'applied' | 'rejected' | 'expired' | 'failed' | 'busy' }

const SUGGESTIONS: Record<Surface, string[]> = {
  point_a: ['Почему у меня такой балл?', 'Что улучшить в первую очередь?', 'Каких данных не хватает?'],
  gri: ['Что мешает росту больше всего?', 'Чем GRI отличается от Точки А?', 'С чего начать план на 90 дней?'],
  point_b: ['Реалистична ли моя цель?', 'Какой темп роста нужен?', 'Что сделать в этом квартале?'],
  dashboard: ['Как идут мои цели?', 'Какие метрики проседают?', 'Что изменилось за месяц?'],
  global: ['Как дела у бизнеса?', 'Что улучшить в первую очередь?', 'Какие есть расхождения в данных?'],
}

function surfaceFromPath(path: string): Surface {
  if (path.includes('point-a')) return 'point_a'
  if (path.includes('point-b')) return 'point_b'
  if (path.includes('/gri')) return 'gri'
  if (path.includes('dashboard') || path.includes('/client/home')) return 'dashboard'
  return 'global'
}

function Icon({ name, className }: { name: string; className?: string }) {
  return <span className={cn('material-symbols-outlined', className)} aria-hidden="true">{name}</span>
}

function ActionCard({ item, onDecide }: { item: Extract<Item, { kind: 'action' }>; onDecide: (id: string, d: 'apply' | 'reject') => void }) {
  const p = item.preview
  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.05] p-3">
      <p className="text-[10px] font-mono uppercase tracking-wider text-primary/80">Предлагаю изменить</p>
      {p && (
        <>
          <p className="mt-1 text-sm font-semibold text-on-surface">{p.title}</p>
          <p className="mt-1 font-mono text-sm text-on-surface">
            <span className="text-on-surface-variant line-through decoration-on-surface-variant/50">{p.before ?? 'нет'}</span>
            <Icon name="arrow_forward" className="mx-1.5 align-middle text-[14px] text-on-surface-variant" />
            <span className="text-primary">{p.after}</span>
          </p>
          {p.note && <p className="mt-1 text-xs text-on-surface-variant">{p.note}</p>}
        </>
      )}
      {item.status === 'pending' || item.status === 'busy' ? (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={item.status === 'busy'} onClick={() => onDecide(item.id, 'apply')}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary disabled:opacity-60">Применить</button>
          <button type="button" disabled={item.status === 'busy'} onClick={() => onDecide(item.id, 'reject')}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface">Отмена</button>
        </div>
      ) : (
        <p className={cn('mt-2 text-xs font-mono', item.status === 'applied' ? 'text-primary' : 'text-on-surface-variant')}>
          {item.status === 'applied' ? '✓ Применено — Точка А пересчитается' : item.status === 'rejected' ? 'Отменено' : item.status === 'expired' ? 'Предложение устарело' : 'Не удалось применить'}
        </p>
      )}
    </div>
  )
}

export function ChatHost() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [surface, setSurface] = useState<Surface>('global')
  const [focus, setFocus] = useState<OpenChatDetail['focus']>({})
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const loaded = useRef<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (s: Surface) => {
    if (loaded.current === s) return
    loaded.current = s
    try {
      const res = await fetch(`/api/v1/ai/assistant?surface=${s}`, { cache: 'no-store' })
      const body = await res.json()
      if (!body?.ok) return
      const msgs = (body.data.messages as Array<{ role: 'user' | 'assistant'; content: string }>).map((m): Item => ({ kind: m.role, text: m.content }))
      const acts = (body.data.actions as Array<{ id: string; preview: Preview; status: Item extends { status: infer S } ? S : never; expires_at: string }>)
        .filter((a) => a.status === 'pending' && Date.parse(a.expires_at) > Date.now())
        .map((a): Item => ({ kind: 'action', id: a.id, preview: a.preview, status: 'pending' }))
      setItems([...msgs, ...acts])
      setConversationId(body.data.conversationId)
    } catch { /* offline — an empty chat */ }
  }, [])

  const ask = useCallback(async (text: string, s: Surface, f: OpenChatDetail['focus']) => {
    const q = text.trim()
    if (!q || busy) return
    setBusy(true)
    setInput('')
    setStatus('Думаю…')
    setItems((list) => [...list, { kind: 'user', text: q }])
    try {
      const res = await fetch('/api/v1/ai/assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, surface: s, focus: f ? { block: f.block ?? null, metric: f.metric ?? null } : undefined, conversationId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setItems((list) => [...list, { kind: 'assistant', text: body?.error ?? 'Не удалось ответить — попробуйте ещё раз.' }])
        return
      }
      await readEvents(res, (e: StreamEvent) => {
        if (e.type === 'status') setStatus(e.text)
        else if (e.type === 'proposal') setItems((list) => [...list, { kind: 'action', id: e.action.id, preview: e.action.preview, status: 'pending' }])
        else if (e.type === 'answer' || e.type === 'error') setItems((list) => [...list, { kind: 'assistant', text: e.text }])
        else if (e.type === 'done' && e.conversationId) setConversationId(e.conversationId)
      })
    } catch {
      setItems((list) => [...list, { kind: 'assistant', text: 'Связь прервалась — попробуйте ещё раз.' }])
    } finally {
      setBusy(false)
      setStatus(null)
    }
  }, [busy, conversationId])

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const d = (ev as CustomEvent<OpenChatDetail>).detail ?? {}
      const s = d.surface ?? surfaceFromPath(window.location.pathname)
      if (s !== surface) { setItems([]); setConversationId(null) }
      setSurface(s)
      setFocus(d.focus ?? {})
      setOpen(true)
      void load(s).then(() => { if (d.question) void ask(d.question, s, d.focus ?? {}) })
    }
    window.addEventListener(OPEN_CHAT_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpen)
  }, [ask, load, surface])

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [items, status])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const decide = async (id: string, decision: 'apply' | 'reject') => {
    setItems((list) => list.map((it) => (it.kind === 'action' && it.id === id ? { ...it, status: 'busy' } : it)))
    try {
      const res = await fetch(`/api/v1/ai/actions/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) })
      const body = await res.json().catch(() => null)
      const next: Extract<Item, { kind: 'action' }>['status'] = res.ok ? (decision === 'apply' ? 'applied' : 'rejected') : res.status === 410 ? 'expired' : 'failed'
      setItems((list) => [
        ...list.map((it) => (it.kind === 'action' && it.id === id ? { ...it, status: next } : it)),
        ...(!res.ok && body?.error ? [{ kind: 'assistant' as const, text: body.error as string }] : []),
      ])
      if (res.ok && decision === 'apply') void qc.invalidateQueries()
    } catch {
      setItems((list) => list.map((it) => (it.kind === 'action' && it.id === id ? { ...it, status: 'failed' } : it)))
    }
  }

  if (!open) return null
  return (
    <BodyPortal>
      <div className="fixed inset-0 z-[70] flex items-end sm:items-stretch sm:justify-end" onClick={() => setOpen(false)}>
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
        <aside role="dialog" aria-modal="true" aria-label="AI-чат" onClick={(e) => e.stopPropagation()}
          className="relative z-10 flex w-full flex-col sm:max-w-md h-[88vh] sm:h-full bg-surface-container-low border-t sm:border-t-0 sm:border-l border-white/[0.08] rounded-t-2xl sm:rounded-none">
          <header className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
            <div className="min-w-0">
              <p className="font-headline text-base font-bold text-on-surface flex items-center gap-1.5"><Icon name="auto_awesome" className="text-[18px] text-primary" />AI-аналитик</p>
              <p className="truncate text-[11px] text-on-surface-variant">Отвечает по данным вашей компании{focus?.label ? ` · ${focus.label}` : ''}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть" className="h-9 w-9 rounded-lg text-on-surface-variant hover:bg-white/[0.06]"><Icon name="close" className="text-xl" /></button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" aria-live="polite">
            {items.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-on-surface-variant">Спросите о своём бизнесе — отвечу по вашим данным, с периодом и источником каждой цифры. Изменить данные могу только с вашего подтверждения.</p>
                {SUGGESTIONS[surface].map((s) => (
                  <button key={s} type="button" onClick={() => void ask(s, surface, focus)} className="block w-full rounded-xl border border-white/[0.08] px-3 py-2 text-left text-sm text-on-surface hover:border-primary/40">{s}</button>
                ))}
              </div>
            )}
            {items.map((it, i) => it.kind === 'action'
              ? <ActionCard key={it.id} item={it} onDecide={(id, d) => void decide(id, d)} />
              : (
                <div key={i} className={cn('max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm', it.kind === 'user' ? 'ml-auto bg-primary/15 text-on-surface' : 'bg-white/[0.04] text-on-surface')}>
                  {it.text}
                </div>
              ))}
            {status && <p className="flex items-center gap-1.5 text-xs text-on-surface-variant"><Icon name="progress_activity" className="text-[14px] animate-spin" />{status}</p>}
            <div ref={endRef} />
          </div>

          <form className="flex gap-2 border-t border-white/[0.06] p-3" onSubmit={(e) => { e.preventDefault(); void ask(input, surface, focus) }}>
            <label className="flex-1">
              <span className="sr-only">Вопрос</span>
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={2000}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(input, surface, focus) } }}
                placeholder="Спросите о выручке, марже, целях…"
                className="w-full resize-none rounded-xl border border-white/10 bg-surface-container px-3 py-2 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary/50" />
            </label>
            <button type="submit" disabled={busy || !input.trim()} aria-label="Отправить" className="h-10 w-10 shrink-0 rounded-xl bg-primary text-on-primary disabled:opacity-50"><Icon name="send" className="text-[18px]" /></button>
          </form>
        </aside>
      </div>
    </BodyPortal>
  )
}
