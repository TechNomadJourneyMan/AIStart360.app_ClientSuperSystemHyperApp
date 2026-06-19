'use client'

import { useEffect, useState, useCallback } from 'react'

// Executable Action Plan (Карта роста). Fetches /api/v1/action-plan, groups by
// 90-day period, lets the owner (or staff via userId) move task status. §16.8.

interface ActionItem {
  id: string
  period: string | null
  title: string
  description: string | null
  status: 'open' | 'in_progress' | 'done'
  owner: string | null
  due_date: string | null
  expected_effect: string | null
  linked_block: string | null
  priority: number | null
}

const PERIODS: { key: string; label: string }[] = [
  { key: '1-30', label: '1–30 дней' },
  { key: '31-60', label: '31–60 дней' },
  { key: '61-90', label: '61–90 дней' },
]

const STATUS_NEXT: Record<ActionItem['status'], ActionItem['status']> = {
  open: 'in_progress',
  in_progress: 'done',
  done: 'open',
}
const STATUS_META: Record<ActionItem['status'], { label: string; cls: string; icon: string }> = {
  open: { label: 'Открыта', cls: 'text-on-surface-variant bg-surface-container border-white/[0.08]', icon: 'radio_button_unchecked' },
  in_progress: { label: 'В работе', cls: 'text-amber-300 bg-amber-400/10 border-amber-400/30', icon: 'pending' },
  done: { label: 'Готово', cls: 'text-primary bg-primary/10 border-primary/30', icon: 'check_circle' },
}

export function ActionPlanBoard({ userId }: { userId?: string }) {
  const [items, setItems] = useState<ActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = '/api/v1/action-plan' + (userId ? `?userId=${userId}` : '')
      const res = await fetch(url, { cache: 'no-store' })
      const json = (await res.json()) as { ok: boolean; data?: ActionItem[]; error?: string }
      if (!res.ok || !json.ok) setError(json.error || `Ошибка ${res.status}`)
      else setItems(json.data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  const cycleStatus = async (item: ActionItem) => {
    const next = STATUS_NEXT[item.status]
    setBusyId(item.id)
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, status: next } : x)))
    try {
      const res = await fetch(`/api/v1/action-plan/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) { await load() } // revert via reload on failure
    } catch {
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const total = items.length
  const done = items.filter((i) => i.status === 'done').length
  const pct = total ? Math.round((done / total) * 100) : 0

  if (loading) {
    return <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-6 animate-pulse h-40" />
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-error/20 bg-error/[0.04] p-5 text-sm text-error">
        Не удалось загрузить план: {error}
        <button onClick={load} className="ml-3 text-primary hover:underline">Повторить</button>
      </div>
    )
  }
  if (total === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-8 text-center">
        <span className="material-symbols-outlined text-3xl text-primary/50 block mb-2" aria-hidden>checklist</span>
        <p className="text-sm text-on-surface font-medium">План действий появится после GRI-диагностики</p>
        <p className="text-xs text-on-surface-variant mt-1">90-дневный план формируется из TOP-5 ограничений роста.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-on-surface-variant">Выполнено <span className="font-mono text-primary font-bold">{done}/{total}</span></p>
        <div className="flex items-center gap-2 flex-1 max-w-xs">
          <div className="h-1.5 flex-1 bg-surface-container rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-mono text-on-surface-variant">{pct}%</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {PERIODS.map((p) => {
          const group = items.filter((i) => i.period === p.key)
          return (
            <div key={p.key} className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4">
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-3">{p.label}</p>
              <div className="space-y-2.5">
                {group.length === 0 && <p className="text-xs text-on-surface-variant/60">Нет задач</p>}
                {group.map((item) => {
                  const meta = STATUS_META[item.status]
                  return (
                    <div key={item.id} className={`rounded-xl border bg-surface-container p-3 transition-all ${item.status === 'done' ? 'opacity-60' : ''}`}>
                      <div className="flex items-start gap-2.5">
                        <button
                          onClick={() => cycleStatus(item)}
                          disabled={busyId === item.id}
                          aria-label="Сменить статус"
                          className={`mt-0.5 flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full border transition-all ${meta.cls}`}
                        >
                          <span className="material-symbols-outlined text-sm" aria-hidden>{meta.icon}</span>
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs text-on-surface leading-snug ${item.status === 'done' ? 'line-through' : ''}`}>{item.title}</p>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${meta.cls}`}>{meta.label}</span>
                            {item.owner && <span className="text-[9px] text-on-surface-variant">· {item.owner}</span>}
                            {item.due_date && <span className="text-[9px] text-on-surface-variant">· до {item.due_date}</span>}
                            {item.linked_block && <span className="text-[9px] text-on-surface-variant/60">· {item.linked_block}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
