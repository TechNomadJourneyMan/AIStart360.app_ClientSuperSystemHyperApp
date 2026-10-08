import SessionActivityTracker from '@/components/analytics/SessionActivityTracker'

// Shared report viewer: tracked only for signed-in viewers, and never under the
// real path — the token in /r/<token> is a secret and must not reach user_events.
export default function SharedReportLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SessionActivityTracker pageAlias="/r/:token" />
    </>
  )
}
