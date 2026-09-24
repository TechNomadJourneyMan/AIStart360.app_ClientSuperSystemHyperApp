'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button, ErrorState, GigaApiError, Panel, Skeleton, Timeline, cx, gigaFetch, type Tone } from '../kit'
import { TIMELINE_KIND_LABELS, type TimelineEntry, type TimelineKind } from '@/lib/admin/timeline'

/**
 * «Лента» — вся история клиента одним списком: что делал он сам, что с ним
 * делал персонал, какие письма ушли, заметки, задачи, эскалации, комментарии
 * экспертов и правки анкеты. Фильтр по видам и «показать ещё».
 */

const TONE: Record<TimelineKind, Tone> = {
  event: 'neutral', audit: 'violet', email: 'blue', note: 'amber', task: 'green', case: 'red', comment: 'blue', survey: 'neutral',
}

interface Resp { data: TimelineEntry[]; nextCursor: string | null; kinds: TimelineKind[] }

export function TimelineTab({ userId }: { userId: string }) {
  const [kinds, setKinds] = useState<Set<TimelineKind>>(new Set())
  const [all, setAll] = useState(false)
  const [items, setItems] = useState<TimelineEntry[]>([])
  const [available, setAvailable] = useState<TimelineKind[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<GigaApiError | null>(null)
  const seq = useRef(0)

  const load = useCallback(async (from: string | null) => {
    const my = ++seq.current
    setLoading(true)
    setError(null)
    const p = new URLSearchParams({ limit: '40' })
    if (from) p.set('cursor', from)
    if (kinds.size) p.set('kinds', Array.from(kinds).join(','))
    if (all) p.set('all', '1')
    try {
      const r = await gigaFetch<Resp>(`/api/giga-admin/users/${userId}/timeline?${p.toString()}`)
      if (my !== seq.current) return
      setAvailable(r.kinds)
      setCursor(r.nextCursor)
      setItems((prev) => {
        if (!from) return r.data
        const seen = new Set(prev.map((e) => `${e.kind}:${e.id}`))
        return [...prev, ...r.data.filter((e) => !seen.has(`${e.kind}:${e.id}`))]
      })
    } catch (e) {
      if (my === seq.current) setError(e instanceof GigaApiError ? e : new GigaApiError(String(e), 0))
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [userId, kinds, all])

  useEffect(() => { void load(null) }, [load])

  const toggle = (k: TimelineKind) => setKinds((prev) => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })

  return (
    <Panel
      title="Лента клиента"
      description="Все события по клиенту в одном списке, новые сверху."
      actions={
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-500">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="h-3.5 w-3.5 accent-blue-500" />
          с просмотрами страниц
        </label>
      }
    >
      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Фильтр по видам событий">
        <button
          type="button"
          onClick={() => setKinds(new Set())}
          aria-pressed={!kinds.size}
          className={cx('rounded-full border px-2.5 py-1 text-[11px]', !kinds.size ? 'border-blue-500/30 bg-blue-500/15 text-blue-200' : 'border-white/[0.08] text-slate-500 hover:text-slate-300')}
        >
          Все
        </button>
        {available.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => toggle(k)}
            aria-pressed={kinds.has(k)}
            className={cx('rounded-full border px-2.5 py-1 text-[11px]', kinds.has(k) ? 'border-blue-500/30 bg-blue-500/15 text-blue-200' : 'border-white/[0.08] text-slate-500 hover:text-slate-300')}
          >
            {TIMELINE_KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <ErrorState error={error} onRetry={() => void load(null)} />
      {loading && !items.length ? <Skeleton className="h-64" /> : (
        <Timeline
          emptyText="Событий по выбранным видам нет"
          items={items.map((e) => ({
            id: `${e.kind}:${e.id}`,
            at: e.at,
            tone: TONE[e.kind],
            title: e.link
              ? <Link href={e.link} className="hover:underline">{e.title}</Link>
              : e.title,
            subtitle: (e.body || e.actor)
              ? <span className="whitespace-pre-line">{[TIMELINE_KIND_LABELS[e.kind], e.actor, e.body].filter(Boolean).join(' · ')}</span>
              : TIMELINE_KIND_LABELS[e.kind],
          }))}
        />
      )}
      {cursor && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" loading={loading} onClick={() => void load(cursor)}>Показать ещё</Button>
        </div>
      )}
    </Panel>
  )
}
