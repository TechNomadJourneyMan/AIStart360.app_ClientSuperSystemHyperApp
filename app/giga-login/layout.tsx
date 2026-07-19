import type { ReactNode } from 'react'

// Authentication screens must always come from the network. Keeping this
// segment dynamic prevents an older PWA precache from pinning the previous
// shared-password-only screen after a deployment.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function GigaLoginLayout({ children }: { children: ReactNode }) {
  return children
}
