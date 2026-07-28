import type { Metadata } from 'next'
import { ClientsTable } from '@/components/clients/ClientsTable'
import { createServerClient } from '@/lib/supabase-server'

export const metadata: Metadata = { title: 'Clients' }

type ClientStats = {
  total: number
  active: number
  pending: number
  avgScore: number | null
}

type ClientStatsResult =
  | { ok: true; data: ClientStats }
  | { ok: false }

async function getClientStats(): Promise<ClientStatsResult> {
  try {
    const sb = createServerClient()
    const { data, error } = await sb
      .from('profiles')
      .select('id, status')
      .not('status', 'eq', 'rejected')

    if (error) throw error
    if (!data) throw new Error('CLIENT_STATS_UNAVAILABLE')

    const total = data.length
    const active = data.filter((p) => p.status === 'approved').length
    const pending = data.filter((p) => p.status === 'pending_approval').length

    const userIds = data.map((p) => p.id)
    if (userIds.length === 0) {
      return { ok: true, data: { total, active, pending, avgScore: null } }
    }

    const { data: diags, error: diagnosticsError } = await sb
      .from('diagnostics')
      .select('overall_score')
      .in('user_id', userIds)
      .eq('is_current', true)
      .not('overall_score', 'is', null)

    if (diagnosticsError) throw diagnosticsError

    const scores = (diags ?? [])
      .map((diagnostic) => Number(diagnostic.overall_score))
      .filter((score) => Number.isFinite(score))
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) / 10
      : null

    return { ok: true, data: { total, active, pending, avgScore } }
  } catch (error) {
    console.error('[clients] stats unavailable', error)
    return { ok: false }
  }
}

export default async function ClientsPage() {
  const statsResult = await getClientStats()

  const statCards = [
    {
      label: 'Всего клиентов',
      value: statsResult.ok ? String(statsResult.data.total) : '—',
      icon: 'business_center',
      color: 'text-primary',
    },
    {
      label: 'Активных',
      value: statsResult.ok ? String(statsResult.data.active) : '—',
      icon: 'check_circle',
      color: 'text-primary',
    },
    {
      label: 'Ожидают',
      value: statsResult.ok ? String(statsResult.data.pending) : '—',
      icon: 'hourglass_top',
      color: 'text-tertiary-container',
    },
    {
      label: 'Avg Point A',
      value: statsResult.ok && statsResult.data.avgScore !== null
        ? statsResult.data.avgScore.toFixed(1)
        : '—',
      icon: 'radar',
      color: 'text-secondary',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Clients</h1>
          <p className="text-on-surface-variant text-sm mt-1">Управление клиентским портфелем</p>
        </div>
        <div className="sm:text-right">
          <button
            type="button"
            disabled
            aria-describedby="client-create-unavailable"
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-high px-5 py-2.5 text-sm font-semibold text-on-surface-variant opacity-60"
          >
            <span className="material-symbols-outlined text-lg">add</span>
            Добавить клиента
          </button>
          <p id="client-create-unavailable" className="mt-1.5 text-[10px] text-on-surface-variant">
            Создание клиента пока не подключено
          </p>
        </div>
      </div>

      {!statsResult.ok && (
        <div role="alert" className="flex flex-wrap items-start gap-3 rounded-xl border border-tertiary-container/25 bg-tertiary-container/5 px-4 py-3">
          <span className="material-symbols-outlined mt-0.5 text-lg text-tertiary-container">cloud_off</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-on-surface">Сводка клиентов временно недоступна</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              Список ниже загрузится независимо. Обновите сводку, чтобы повторить запрос.
            </p>
          </div>
          <a
            href="?retry=client-stats"
            className="inline-flex items-center gap-1.5 rounded-lg border border-tertiary-container/25 px-3 py-1.5 text-xs font-semibold text-tertiary-container transition-colors hover:bg-tertiary-container/10"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
            Повторить
          </a>
        </div>
      )}

      {/* Stats Row */}
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
        <ClientsTable />
      </div>
    </div>
  )
}
