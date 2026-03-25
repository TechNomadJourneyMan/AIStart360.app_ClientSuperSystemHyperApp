import type { Metadata } from 'next'
import { ClientsTable } from '@/components/clients/ClientsTable'
import { ClientFilters } from '@/components/clients/ClientFilters'

export const metadata: Metadata = { title: 'Clients' }

export default function ClientsPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Clients</h1>
          <p className="text-on-surface-variant text-sm mt-1">Управление клиентским портфелем</p>
        </div>
        <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.98] active:scale-95 transition-all">
          <span className="material-symbols-outlined text-lg">add</span>
          Добавить клиента
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Clients', value: '44', icon: 'business_center', color: 'text-primary' },
          { label: 'Active', value: '38', icon: 'check_circle', color: 'text-primary' },
          { label: 'Churn Risk', value: '6', icon: 'warning', color: 'text-tertiary-container' },
          { label: 'Avg GRI', value: '763', icon: 'radar', color: 'text-secondary' },
        ].map((stat) => (
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
