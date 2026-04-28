/**
 * Auth layout — bare passthrough.
 * Each auth page (login, register) manages its own full-screen layout.
 */
export const dynamic = 'force-dynamic'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
