import type { Metadata } from 'next'
import { ClientsTable } from '@/components/clients/ClientsTable'
import { ClientFilters } from '@/components/clients/ClientFilters'
import { createServerClient } from '@/lib/supabase-server'
import { CLIENT_PROFILE_ROLES } from '@/lib/profiles/client-roles'

export const metadata: Metadata = { title: 'Клиенты' }

interface ClientStats {
  total: number
  active: number
  pending: number
  /** Mean current Point A score, 0–100; null without diagnostics. */
  avgPointA: number | null
}

const PAGE = 1000

/**
 * Counts of client profiles (staff, experts and partners are profiles too)
 * and the mean current Point A score. Read through the viewer's session, so
 * RLS decides what is visible. Throws on a failed read: the page shows an
 * error, never sample numbers.
 */
async function getClientStats(): Promise<ClientStats> {
  const sb = createServerClient()
  const clients = () =>
    sb.from('profiles').select('id', { count: 'exact', head: true }).in('role', [...CLIENT_PROFILE_ROLES])

  const [all, active, pending] = await Promise.all([
    clients().not('status', 'eq', 'rejected'),
    clients().eq('status', 'approved'),
    clients().eq('status', 'pending_approval'),
  ])
  for (const r of [all, active, pending]) if (r.error) throw r.error

  // Client ids in pages (PostgREST caps a response at 1000 rows), then their
  // current diagnostics in chunks that keep the request URL short.
  const ids: string[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('profiles')
      .select('id')
      .in('role', [...CLIENT_PROFILE_ROLES])
      .not('status', 'eq', 'rejected')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    ids.push(...(data ?? []).map((p) => p.id as string))
    if (!data || data.length < PAGE) break
  }

  let sum = 0
  let n = 0
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb
      .from('diagnostics')
      .select('overall_score')
      .in('user_id', ids.slice(i, i + 200))
      .eq('is_current', true)
      .not('overall_score', 'is', null)
    if (error) throw error
    for (const d of data ?? []) {
      const v = Number(d.overall_score)
      if (Number.isFinite(v)) { sum += v; n++ }
    }
  }

  return {
    total: all.count ?? 0,
    active: active.count ?? 0,
    pending: pending.count ?? 0,
    avgPointA: n > 0 ? Math.round(sum / n) : null,
  }
}

export default async function ClientsPage() {
  let stats: ClientStats | null = null
  try {
    stats = await getClientStats()
  } catch (err) {
    console.error('[clients] stats', err instanceof Error ? err.message : err)
  }

  const statCards = [
    { label: 'Всего клиентов', value: stats ? String(stats.total) : '—', icon: 'business_center', color: 'text-primary' },
    { label: 'Активных', value: stats ? String(stats.active) : '—', icon: 'check_circle', color: 'text-primary' },
    { label: 'Ожидают', value: stats ? String(stats.pending) : '—', icon: 'hourglass_top', color: 'text-tertiary-container' },
    {
      label: 'Средний балл Точки А',
      value: stats?.avgPointA != null ? `${stats.avgPointA}/100` : '—',
      icon: 'radar',
      color: 'text-secondary',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Клиенты</h1>
          <p className="text-on-surface-variant text-sm mt-1">Управление клиентским портфелем</p>
        </div>
        <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.98] active:scale-95 transition-all">
          <span className="material-symbols-outlined text-lg">add</span>
          Добавить клиента
        </button>
      </div>

      {/* Stats Row */}
      {!stats && (
        <p role="alert" className="text-xs text-error">
          Статистику клиентов не удалось загрузить — показатели не подменяются примерными.
        </p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map((stat) => (
          <div key={stat.label} className="bg-surface-container-low rounded-xl p-4 flex items-center gap-3">
            <span className={`material-symbols-outlined text-2xl ${stat.color}`}>{stat.icon}</span>
            <div>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{stat.label}</p>
              <p className={`text-xl font-mono font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters + Table */}
      <div className="bg-surface-container rounded-xl overflow-hidden">
        <ClientFilters />
        <ClientsTable />
      </div>
    </div>
  )
}
