import SessionActivityTracker from '@/components/analytics/SessionActivityTracker'

export default function JourneyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SessionActivityTracker />
    </>
  )
}
