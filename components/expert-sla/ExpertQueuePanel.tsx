'use client'

/**
 * Панель «Очередь» кабинета эксперта (R2-B): задачи с часами SLA из
 * /api/expert/sla-tasks. Таймер пересчитывается раз в минуту, данные — раз в
 * 5 минут (как проход SLA). Ошибка загрузки — честное сообщение, не «пусто».
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ExpertSlaQueueList, type ExpertQueueTask } from './ExpertSlaQueueList'

interface Summary { open: number; dueSoon: number; escalated: number; breached: number }

export function ExpertQueuePanel({ limit, showAllLink = false }: { limit?: number; showAllLink?: boolean }) {
  const [tasks, setTasks] = useState<ExpertQueueTask[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/expert/sla-tasks', { cache: 'no-store' })
        const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: ExpertQueueTask[]; summary?: Summary; error?: string } | null
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
        if (!cancelled) {
          setTasks(json.data ?? [])
          setSummary(json.summary ?? null)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка')
      }
    }
    void load()
    const data = setInterval(load, 5 * 60_000)
    const tick = setInterval(() => setNow(new Date()), 60_000)
    return () => { cancelled = true; clearInterval(data); clearInterval(tick) }
  }, [])

  const shown = tasks && limit ? tasks.slice(0, limit) : tasks

  return (
    <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-headline text-lg font-bold text-on-surface">Очередь задач</h2>
          <p className="text-xs text-on-surface-variant">Реакция — за 24 ч, ответ клиенту — за 48 ч</p>
        </div>
        {summary && (
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-on-surface-variant">Открыто: {summary.open}</span>
            {summary.dueSoon > 0 && <span className="rounded-full border border-amber-400/30 px-2 py-0.5 text-amber-400">Скоро срок: {summary.dueSoon}</span>}
            {summary.escalated + summary.breached > 0 && (
              <span className="rounded-full border border-error/30 px-2 py-0.5 text-error">Просрочено: {summary.escalated + summary.breached}</span>
            )}
          </div>
        )}
      </div>
      {error ? (
        <div className="rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error">Не удалось загрузить очередь: {error}</div>
      ) : shown === null ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-container" />)}</div>
      ) : (
        <ExpertSlaQueueList tasks={shown} now={now} />
      )}
      {showAllLink && tasks && limit && tasks.length > limit && (
        <Link href="/expert/queue" className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline">
          Вся очередь ({tasks.length})
          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
        </Link>
      )}
    </div>
  )
}
