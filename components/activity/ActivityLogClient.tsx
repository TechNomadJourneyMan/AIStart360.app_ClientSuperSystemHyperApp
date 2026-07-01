'use client'

import { useCallback, useEffect, useState } from 'react'

interface ActivityRow {
  id: string
  action: string
  category: string
  description: string | null
  severity: 'info' | 'warning' | 'critical'
  status: 'success' | 'failure'
  metadata: Record<string, unknown>
  ip_address: string | null
  created_at: string
}

const CATEGORIES = [
  { id: 'all',         label: 'Все' },
  { id: 'security',    label: 'Безопасность' },
  { id: 'profile',     label: 'Профиль' },
  { id: 'settings',    label: 'Настройки' },
  { id: 'integration', label: 'Интеграции' },
  { id: 'team',        label: 'Команда' },
  { id: 'report',      label: 'Отчёты' },
  { id: 'system',      label: 'Системные' },
]

const CATEGORY_ICON: Record<string, string> = {
  security: 'lock', profile: 'person', settings: 'settings',
  integration: 'hub', team: 'group', report: 'description', system: 'terminal', billing: 'credit_card',
}

const SEVERITY_DOT: Record<string, string> = {
  info: 'bg-primary', warning: 'bg-tertiary-container', critical: 'bg-error',
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

export function ActivityLogClient() {
  const [category, setCategory] = useState('all')
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`/api/v1/activity?category=${category}&limit=200`, { credentials: 'include' })
      const json = await res.json()
      if (!json.ok || !Array.isArray(json.data)) throw new Error('bad_response')
      setRows(json.data)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [category])

  useEffect(() => { load() }, [load])

  const exportCsv = () => {
    if (!rows.length) return
    const head = ['Дата', 'Действие', 'Категория', 'Описание', 'Уровень', 'Статус', 'IP']
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const body = rows.map((r) =>
      [fmtDate(r.created_at), r.action, r.category, r.description, r.severity, r.status, r.ip_address].map(esc).join(','),
    )
    const csv = [head.join(','), ...body].join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `activity-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Личный кабинет</p>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface">Журнал действий</h1>
          <p className="text-on-surface-variant text-sm mt-1">{rows.length} событий</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load}
            className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant border border-outline-variant/30 px-3 py-2 rounded-lg hover:bg-surface-container transition-colors">
            <span className="material-symbols-outlined text-base">refresh</span> Обновить
          </button>
          <button type="button" onClick={exportCsv} disabled={!rows.length}
            className="inline-flex items-center gap-1.5 text-sm text-on-surface border border-outline-variant/30 px-3 py-2 rounded-lg hover:bg-surface-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <span className="material-symbols-outlined text-base">download</span> Экспорт CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button key={c.id} type="button" onClick={() => setCategory(c.id)}
            className={`text-xs font-mono px-3 py-1.5 rounded-lg border transition-colors ${
              category === c.id
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline-variant/60'
            }`}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Body */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 bg-surface-container-low rounded-xl animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="bg-surface-container rounded-xl p-8 text-center">
          <p className="text-sm text-on-surface-variant mb-3">Не удалось загрузить журнал.</p>
          <button type="button" onClick={load} className="text-xs font-mono text-primary hover:underline">Повторить</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-surface-container rounded-xl p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3 block">history</span>
          <p className="text-sm text-on-surface-variant">Пока нет действий в этой категории.</p>
          <p className="text-xs text-on-surface-variant/60 mt-1">Здесь появятся входы, изменения профиля, настроек, безопасности и интеграций.</p>
        </div>
      ) : (
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] divide-y divide-outline-variant/10 overflow-hidden">
          {rows.map((r) => {
            const open = openId === r.id
            return (
              <div key={r.id}>
                <button type="button" onClick={() => setOpenId(open ? null : r.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${SEVERITY_DOT[r.severity] ?? 'bg-primary'}`} />
                  <span className="material-symbols-outlined text-lg text-on-surface-variant/60 flex-shrink-0">
                    {CATEGORY_ICON[r.category] ?? 'bolt'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-on-surface truncate">{r.description ?? r.action}</p>
                    <p className="text-[11px] font-mono text-on-surface-variant/60">{r.action}</p>
                  </div>
                  {r.status === 'failure' && (
                    <span className="text-[10px] font-mono text-error bg-error/10 px-2 py-0.5 rounded-full">ошибка</span>
                  )}
                  <span className="text-[11px] font-mono text-on-surface-variant whitespace-nowrap flex-shrink-0">{fmtDate(r.created_at)}</span>
                  <span className="material-symbols-outlined text-base text-on-surface-variant/40 flex-shrink-0">
                    {open ? 'expand_less' : 'expand_more'}
                  </span>
                </button>
                {open && (
                  <div className="px-4 pb-4 pt-1 bg-surface-container-lowest/40">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                      <dt className="text-on-surface-variant/60">Категория</dt><dd className="text-on-surface-variant font-mono">{r.category}</dd>
                      <dt className="text-on-surface-variant/60">Уровень</dt><dd className="text-on-surface-variant font-mono">{r.severity}</dd>
                      <dt className="text-on-surface-variant/60">IP</dt><dd className="text-on-surface-variant font-mono">{r.ip_address ?? '—'}</dd>
                      {r.metadata && Object.keys(r.metadata).length > 0 && (
                        <>
                          <dt className="text-on-surface-variant/60">Данные</dt>
                          <dd className="text-on-surface-variant font-mono break-all">{JSON.stringify(r.metadata)}</dd>
                        </>
                      )}
                    </dl>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
