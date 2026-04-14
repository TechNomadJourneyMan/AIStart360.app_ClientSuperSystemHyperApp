import type { Metadata } from 'next'
import { ClientsTable } from '@/components/clients/ClientsTable'
import { ClientFilters } from '@/components/clients/ClientFilters'
import { createServerClient } from '@/lib/supabase-server'
import { getTranslations } from 'next-intl/server'

export const metadata: Metadata = { title: 'Clients' }

async function getClientStats() {
  try {
    const sb = createServerClient()
    const { data } = await sb
      .from('profiles')
      .select('id, status')
      .not('status', 'eq', 'rejected')

    if (!data) return null

    const total = data.length
    const active = data.filter((p) => p.status === 'approved').length
    const pending = data.filter((p) => p.status === 'pending_approval').length

    // Average Point A score from diagnostics
    const userIds = data.map((p) => p.id)
    if (userIds.length === 0) return { total, active, pending, avgScore: null }

    const { data: diags } = await sb
      .from('diagnostics')
      .select('overall_score')
      .in('user_id', userIds)
      .eq('is_current', true)
      .not('overall_score', 'is', null)

    const scores = (diags ?? []).map((d) => d.overall_score as number)
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10)
      : null

    return { total, active, pending, avgScore }
  } catch {
    return null
  }
}

export default async function ClientsPage() {
  const t = await getTranslations('clientsPage')
  const stats = await getClientStats()

  const statCards = stats
    ? [
        { label: t('totalClients'), value: String(stats.total), icon: 'business_center', color: 'text-primary' },
        { label: t('active'), value: String(stats.active), icon: 'check_circle', color: 'text-primary' },
        { label: t('pending'), value: String(stats.pending), icon: 'hourglass_top', color: 'text-tertiary-container' },
        { label: t('avgPointA'), value: stats.avgScore !== null ? String(stats.avgScore) : '—', icon: 'radar', color: 'text-secondary' },
      ]
    : [
        { label: t('totalClients'), value: '44', icon: 'business_center', color: 'text-primary' },
        { label: t('active'), value: '38', icon: 'check_circle', color: 'text-primary' },
        { label: 'Churn Risk', value: '6', icon: 'warning', color: 'text-tertiary-container' },
        { label: 'Avg GRI', value: '763', icon: 'radar', color: 'text-secondary' },
      ]

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Clients</h1>
          <p className="text-on-surface-variant text-sm mt-1">{t('managingPortfolio') as string}</p>
        </div>
        <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.98] active:scale-95 transition-all">
          <span className="material-symbols-outlined text-lg">add</span>
          {t('addClient')}
        </button>
      </div>

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
        <ClientFilters />
        <ClientsTable />
      </div>
    </div>
  )
}
