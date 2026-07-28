import ClientsPage from '@/app/(dashboard)/clients/page'
import { ClientRouteScope } from '@/components/clients/ClientsTable'

export default function OwnerClientsPage() {
  return (
    <ClientRouteScope basePath="/owner/clients">
      <ClientsPage />
    </ClientRouteScope>
  )
}
