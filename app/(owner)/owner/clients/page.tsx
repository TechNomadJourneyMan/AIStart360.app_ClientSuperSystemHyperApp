import type { Metadata } from 'next'
import { ClientsPanel } from '@/components/clients/ClientsPanel'

// Mirrors app/(dashboard)/clients/page.tsx. It can no longer be re-exported:
// the owner portal needs basePath='/owner' on the table links, otherwise they
// point at /clients/<id> — an ADMIN_PATH middleware bounces the owner off.
// No /admin link here: that route is middleware-gated to role 'admin'.
export const metadata: Metadata = { title: 'Клиенты' }

export default function OwnerClientsPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Клиенты</h1>
          <p className="text-on-surface-variant text-sm mt-1">Управление клиентским портфелем</p>
        </div>
      </div>

      <ClientsPanel basePath="/owner" />
    </div>
  )
}
