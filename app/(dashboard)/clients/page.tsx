import type { Metadata } from 'next'
import Link from 'next/link'
import { ClientsPanel } from '@/components/clients/ClientsPanel'

export const metadata: Metadata = { title: 'Клиенты' }

// The stats row used to fall back to «Total Clients 44 / Active 38 / Churn
// Risk 6 / Avg GRI 763» whenever the query failed — invented numbers shown as
// real ones. Both the fallback and the duplicate server query are gone:
// ClientsPanel counts the rows it actually loaded.
export default function ClientsPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Клиенты</h1>
          <p className="text-on-surface-variant text-sm mt-1">Управление клиентским портфелем</p>
        </div>
        {/* Clients are created by approving a registration request — the old
            «Добавить клиента» button had no handler at all. */}
        <Link
          href="/admin"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.98] active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-lg">how_to_reg</span>
          Заявки на подтверждение
        </Link>
      </div>

      <ClientsPanel pendingHref="/admin" />
    </div>
  )
}
