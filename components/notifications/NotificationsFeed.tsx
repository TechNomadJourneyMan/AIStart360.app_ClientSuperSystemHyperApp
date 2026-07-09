'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface Notif {
  id: string
  category: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  title: string
  body: string | null
  link: string | null
  is_read: boolean
  created_at: string
}

const CAT_ICON: Record<string, string> = {
  security: 'lock', profile: 'person', settings: 'settings', integration: 'hub',
  team: 'group', report: 'description', system: 'notifications', billing: 'credit_card',
}
const PRIO_DOT: Record<string, string> = {
  critical: 'bg-error', high: 'bg-tertiary-container', medium: 'bg-primary', low: 'bg-on-surface-variant/40',
}

function fmt(iso: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

export function NotificationsFeed() {
  const router = useRouter()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [items, setItems] = useState<Notif[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`/api/v1/notifications?filter=${filter}`, { credentials: 'include' })
      const json = await res.json()
      if (!json.ok || !Array.isArray(json.data)) throw new Error('bad')
      setItems(json.data)
      setUnread(json.unread ?? 0)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  const markAll = async () => {
    const prev = items
    setItems(items.map((n) => ({ ...n, is_read: true })))
    setUnread(0)
    try {
      const r = await fetch('/api/v1/notifications', { method: 'PATCH', credentials: 'include' })
      if (!r.ok) throw new Error()
    } catch {
      setItems(prev)
      toast.error('Не удалось отметить прочитанными')
      load()
    }
  }

  const markOne = (id: string) => {
    setItems((arr) => arr.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
    setUnread((u) => Math.max(0, u - 1))
    fetch(`/api/v1/notifications/${id}`, { method: 'PATCH', credentials: 'include' }).catch(() => {})
  }

  const openItem = (n: Notif) => {
    if (!n.is_read) markOne(n.id)
    if (n.link) router.push(n.link)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Уведомления</h1>
          <p className="text-on-surface-variant text-sm mt-1">{unread} непрочитанных</p>
        </div>
        <button type="button" data-tour="notif-markall" onClick={markAll} disabled={unread === 0}
          className="text-sm text-primary border border-primary/30 px-4 py-2 rounded-lg hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          Прочитать все
        </button>
      </div>

      <div data-tour="notif-filter" className="flex gap-2">
        {(['all', 'unread'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`text-xs font-mono px-3 py-1.5 rounded-lg border transition-colors ${
              filter === f ? 'bg-primary/10 border-primary/30 text-primary'
                           : 'border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline-variant/60'
            }`}>
            {f === 'all' ? 'Все' : 'Непрочитанные'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-surface-container rounded-xl animate-pulse" />)}</div>
      ) : error ? (
        <div className="bg-surface-container rounded-xl p-8 text-center">
          <p className="text-sm text-on-surface-variant mb-3">Не удалось загрузить уведомления.</p>
          <button type="button" onClick={load} className="text-xs font-mono text-primary hover:underline">Повторить</button>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-surface-container rounded-xl p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3 block">notifications_off</span>
          <p className="text-sm text-on-surface-variant">
            {filter === 'unread' ? 'Все уведомления прочитаны.' : 'Уведомлений пока нет.'}
          </p>
          <p className="text-xs text-on-surface-variant/60 mt-1">Здесь появятся события безопасности, отчёты, интеграции и изменения в аккаунте.</p>
          <a href="/settings" className="inline-block mt-3 text-xs font-mono text-primary hover:underline">Настроить уведомления</a>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <button key={n.id} type="button" onClick={() => openItem(n)}
              className={`w-full flex items-start gap-3 p-4 rounded-xl border text-left transition-colors ${
                n.is_read ? 'bg-surface-container-low border-white/[0.03] hover:bg-surface-container' : 'bg-surface-container border-primary/15 hover:bg-surface-container-high'
              }`}>
              <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${n.is_read ? 'bg-transparent' : PRIO_DOT[n.priority] ?? 'bg-primary'}`} />
              <span className="material-symbols-outlined text-xl text-on-surface-variant/60 flex-shrink-0">{CAT_ICON[n.category] ?? 'notifications'}</span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${n.is_read ? 'text-on-surface-variant' : 'text-on-surface font-medium'}`}>{n.title}</p>
                {n.body && <p className="text-xs text-on-surface-variant/80 mt-0.5">{n.body}</p>}
              </div>
              <span className="text-[11px] font-mono text-on-surface-variant/60 whitespace-nowrap flex-shrink-0">{fmt(n.created_at)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
