'use client'

// Admin/manager view of incoming requests (registration · access · support).
// Reads the existing GET /api/admin/requests contract (data + meta) and renders
// a filterable list. Lives under (dashboard) so it inherits sidebar/header chrome
// and the existing middleware /admin protection.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

// ─── Shape (subset of INCLUDE_FULL the API returns) ─────────────────────────

interface AdminRequestRow {
  id: string
  type: string
  status: string
  priority: string
  createdAt: string
  slaDeadline: string | null
  user: { id: string; name: string | null; email: string | null } | null
  company: { id: string; name: string | null } | null
  _count?: { comments: number }
}

interface RequestsResponse {
  data: AdminRequestRow[]
  meta: { total: number; page: number; limit: number; totalPages: number }
}

// ─── Labels & styles (mirror CrmActivity for consistency) ───────────────────

const STATUS_COLORS: Record<string, string> = {
  new:              'text-amber-400 bg-amber-400/10 border-amber-400/20',
  in_review:        'text-blue-400 bg-blue-400/10 border-blue-400/20',
  waiting_for_info: 'text-orange-400 bg-orange-400/10 border-orange-400/20',
  approved:         'text-primary bg-primary/10 border-primary/20',
  rejected:         'text-error bg-error/10 border-error/20',
  escalated:        'text-purple-400 bg-purple-400/10 border-purple-400/20',
}

const STATUS_LABELS: Record<string, string> = {
  new:              'Новая',
  in_review:        'На проверке',
  waiting_for_info: 'Ждёт инфо',
  approved:         'Одобрено',
  rejected:         'Отклонено',
  escalated:        'Эскалировано',
}

const TYPE_LABELS: Record<string, string> = {
  registration: 'Регистрация',
  access:       'Доступ',
  support:      'Поддержка',
}

const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-error animate-pulse',
  high:     'bg-amber-400',
  medium:   'bg-primary/60',
  low:      'bg-on-surface-variant/40',
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all',              label: 'Все' },
  { value: 'new',              label: 'Новые' },
  { value: 'in_review',        label: 'На проверке' },
  { value: 'waiting_for_info', label: 'Ждут инфо' },
  { value: 'approved',         label: 'Одобрены' },
  { value: 'rejected',         label: 'Отклонены' },
  { value: 'escalated',        label: 'Эскалированы' },
]

export default function AdminRequestsPage() {
  const searchParams = useSearchParams()
  const initialStatus = searchParams.get('status') ?? 'all'

  const [statusFilter, setStatusFilter] = useState(initialStatus)
  const [requests, setRequests] = useState<AdminRequestRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRequests = useCallback(async (status: string) => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ limit: '50', sortBy: 'createdAt', sortDir: 'desc' })
      if (status !== 'all') qs.set('status', status)
      const res = await fetch(`/api/admin/requests?${qs.toString()}`, { cache: 'no-store' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Ошибка ${res.status}`)
      }
      const json = (await res.json()) as RequestsResponse
      setRequests(json.data ?? [])
      setTotal(json.meta?.total ?? json.data?.length ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      setRequests([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRequests(statusFilter)
  }, [statusFilter, fetchRequests])

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1">CRM · Заявки</p>
          <h1 className="font-headline text-2xl font-extrabold text-on-surface">Заявки клиентов</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Регистрации, доступы и обращения в поддержку
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-lg px-2 py-1 self-start md:self-auto"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          К панели
        </Link>
      </header>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.value
          return (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-4 py-2 rounded-xl text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                active
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'bg-surface-container border border-white/[0.04] text-on-surface-variant hover:text-on-surface hover:border-white/10'
              }`}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {/* List */}
      <div className="bg-surface-container-low rounded-2xl border border-white/[0.06] shadow-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.04]">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
            {STATUS_FILTERS.find((f) => f.value === statusFilter)?.label ?? 'Все'}
          </p>
          {!loading && !error && (
            <span className="text-[10px] font-mono text-on-surface-variant">{total} всего</span>
          )}
        </div>

        {loading ? (
          <div className="divide-y divide-white/[0.03]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse bg-surface-container/40" />
            ))}
          </div>
        ) : error ? (
          <div className="px-5 py-12 text-center">
            <span className="material-symbols-outlined text-3xl text-error/60 mb-2">error</span>
            <p className="text-sm text-error">{error}</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <span className="material-symbols-outlined text-5xl text-on-surface-variant/20 mb-3">inbox</span>
            <p className="text-sm font-medium text-on-surface">Заявок нет</p>
            <p className="text-xs text-on-surface-variant mt-1">
              В этом статусе пока нет заявок
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {requests.map((req) => {
              const statusStyle = STATUS_COLORS[req.status] ?? 'text-on-surface-variant bg-surface-container border-white/10'
              const priorityDot = PRIORITY_DOT[req.priority] ?? 'bg-on-surface-variant/40'
              const title = req.company?.name ?? req.user?.name ?? req.user?.email ?? TYPE_LABELS[req.type] ?? req.type
              const overdue = req.slaDeadline ? new Date(req.slaDeadline).getTime() < Date.now() : false
              return (
                <div key={req.id} className="flex items-center gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityDot}`} aria-hidden />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-on-surface font-medium truncate">{title}</p>
                    <p className="text-[11px] text-on-surface-variant mt-0.5">
                      {TYPE_LABELS[req.type] ?? req.type}
                      {req.user?.email && <span> · {req.user.email}</span>}
                      <span> · {new Date(req.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </p>
                  </div>
                  {overdue && req.status !== 'approved' && req.status !== 'rejected' && (
                    <span className="text-[9px] font-mono px-2 py-0.5 rounded-full border text-error bg-error/10 border-error/20 flex-shrink-0">
                      SLA
                    </span>
                  )}
                  <span className={`text-[10px] font-mono px-2.5 py-1 rounded-full border ${statusStyle} flex-shrink-0`}>
                    {STATUS_LABELS[req.status] ?? req.status}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
