import ImpersonationBanner from '@/components/impersonation/ImpersonationBanner'
import { MascotLauncher } from '@/components/assistant/mascot/MascotLauncher'
import ActivityTracker from '@/components/analytics/ActivityTracker'
import AnnouncementBar from '@/components/platform/AnnouncementBar'
import { PlatformSectionsProvider } from '@/hooks/usePlatformSections'
import { createServerClient } from '@/lib/supabase-server'
import { visibleSectionsFor } from '@/lib/platform/sections'

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  // Sections switched off in GIGA-CRM are already filtered on the server, so
  // the cabinet never shows a block that the user cannot open.
  const { data: auth } = await createServerClient().auth.getUser()
  const { sections, hiddenPaths } = await visibleSectionsFor(auth?.user?.id ?? null)
  const initial = { sections: sections.map((s) => ({ key: s.key, title: s.title, description: s.description, icon: s.icon, href: s.nav_href })), hiddenPaths }

  return (
    <PlatformSectionsProvider initial={initial}>
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
    </PlatformSectionsProvider>
  )
}
