/**
 * Auth layout — bare passthrough.
 * Each auth page (login, register) manages its own full-screen layout.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
