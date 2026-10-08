'use client'

/**
 * «Разбор эксперта» в кабинете клиента (F-043, минимум).
 *
 * Показывает ОПУБЛИКОВАННЫЕ разборы и комментарии эксперта по блокам с датами.
 * Черновики эксперта сюда не попадают — это гарантирует API
 * (/api/v1/expert-review) и RLS. Якорь #expert — на него ведёт письмо
 * «Эксперт подготовил разбор» и уведомление.
 */

import { useCallback, useEffect, useState } from 'react'

interface ExpertCommentView {
  id: string
  text: string
  author_name: string | null
  author_title: string | null
  review_id: string | null
  date: string
}

interface ExpertReviewData {
  reviews: Array<{ id: string; title: string | null; summary: string | null; published_at: string | null; author_name: string | null; comments_count: number }>
  blocks: Array<{ key: string; label: string; comments: ExpertCommentView[] }>
  total: number
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

export default function ExpertMessages({ className }: { className?: string }) {
  const [data, setData] = useState<ExpertReviewData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/expert-review', { credentials: 'include', cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const body = await res.json()
      setData((body?.data as ExpertReviewData) ?? null)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Пришли по ссылке из письма (#expert) — докручиваем, когда блок отрисован.
  useEffect(() => {
    if (state !== 'ready' || typeof window === 'undefined' || window.location.hash !== '#expert') return
    document.getElementById('expert')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [state])

  const latest = data?.reviews[0] ?? null

  return (
    <section id="expert" aria-labelledby="expert-title" className={`scroll-mt-20 ${className ?? ''}`}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="expert-title" className="text-sm font-semibold text-on-surface">Разбор эксперта</h2>
        {data && data.total > 0 && <span className="text-xs text-on-surface-variant">{data.total} комм.</span>}
      </div>

      {state === 'loading' && <div className="h-24 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />}

      {state === 'error' && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-on-surface-variant">
          Не удалось загрузить разбор.{' '}
          <button type="button" onClick={() => { setState('loading'); void load() }} className="text-primary hover:underline">Повторить</button>
        </div>
      )}

      {state === 'ready' && (!data || data.total === 0) && (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] p-6 text-center">
          <span className="material-symbols-outlined text-2xl text-on-surface-variant/60" aria-hidden>rate_review</span>
          <p className="mt-2 text-sm text-on-surface-variant">Разбор эксперта появится здесь</p>
        </div>
      )}

      {state === 'ready' && data && data.total > 0 && (
        <div className="space-y-3">
          {latest && (latest.title || latest.summary) && (
            <div className="rounded-2xl border border-primary/20 bg-primary/[0.05] p-4">
              <p className="text-sm font-semibold text-on-surface">{latest.title || 'Разбор эксперта'}</p>
              {latest.summary && <p className="mt-1 whitespace-pre-wrap text-sm text-on-surface-variant">{latest.summary}</p>}
              <p className="mt-2 text-[11px] text-on-surface-variant/70">
                {[latest.author_name, fmtDate(latest.published_at)].filter(Boolean).join(' · ')}
              </p>
            </div>
          )}

          {data.blocks.map((b) => (
            <div key={b.key} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-primary">{b.label}</h3>
              <ul className="mt-2 space-y-3">
                {b.comments.map((c) => (
                  <li key={c.id}>
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-on-surface">{c.text}</p>
                    <p className="mt-1 text-[11px] text-on-surface-variant/70">
                      {[c.author_name, c.author_title, fmtDate(c.date)].filter(Boolean).join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
