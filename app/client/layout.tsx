import ImpersonationBanner from '@/components/impersonation/ImpersonationBanner'
import { MascotLauncher } from '@/components/assistant/mascot/MascotLauncher'
import ActivityTracker from '@/components/analytics/ActivityTracker'
import AnnouncementBar from '@/components/platform/AnnouncementBar'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0A0B0F]">
      <ActivityTracker />
      <ImpersonationBanner />
      <div className="mx-auto max-w-5xl px-4 pt-3 empty:hidden">
        <AnnouncementBar />
      </div>
      {children}
      {/* Floating assistant — the mascot «Гри» on every client page (survey,
          Point A, etc.); static-launcher fallback via MascotLauncher */}
      <MascotLauncher />
    </div>
  )
}
