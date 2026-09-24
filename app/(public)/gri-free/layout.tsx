import SessionActivityTracker from '@/components/analytics/SessionActivityTracker'

// Mini-GRI is public; only signed-in visitors are tracked.
export default function GriFreeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SessionActivityTracker />
    </>
  )
}
