import { ClientPortalShell } from '@/components/client/ClientPortalShell'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <ClientPortalShell>{children}</ClientPortalShell>
}
