import ImpersonationBanner from '@/components/impersonation/ImpersonationBanner'
import { MascotLauncher } from '@/components/assistant/mascot/MascotLauncher'
import { ChatHost } from '@/components/ai-chat/ChatHost'
import { PopupLayer } from '@/components/popups/PopupLayer'
import ActivityTracker from '@/components/analytics/ActivityTracker'
import AnnouncementBar from '@/components/platform/AnnouncementBar'
import { ClientNav } from '@/components/client/ClientNav'
import { PlatformSectionsProvider } from '@/hooks/usePlatformSections'
import { getRequestUser } from '@/lib/request-user'
import { visibleSectionsFor } from '@/lib/platform/sections'
import { clientShellData, loadClientShellAccount } from '@/lib/client-shell/server'
import { PAID_NAV_KEYS, type ClientNavKey } from '@/lib/client-shell/nav'
import { getRequestAccess } from '@/lib/access/request-access'

/** Round 2 (R2-A): menu items of the paid sections closed for the user (one server decision per render). */
async function lockedNavKeys(userId: string | null): Promise<ClientNavKey[]> {
  if (!userId) return []
  try {
    const { sections } = await getRequestAccess(userId)
    return (Object.keys(PAID_NAV_KEYS) as Array<keyof typeof PAID_NAV_KEYS>).filter((f) => !sections[f]).map((f) => PAID_NAV_KEYS[f])
  } catch {
    return [] // the pages and the API still gate on their own
  }
}

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  // Sections switched off in GIGA-CRM are already filtered on the server, so
  // the cabinet never shows a block that the user cannot open.
  // getRequestUser / visibleSectionsFor are memoised per request: the page
  // below reuses these reads instead of repeating the Auth round trip.
  const user = await getRequestUser()
  const [{ sections, hiddenPaths }, account, lockedKeys] = await Promise.all([
    visibleSectionsFor(user?.id ?? null),
    // Menu state of the shell: approval, unread messages and — for staff only,
    // checked here on the server — the «Вернуться в панель» link.
    loadClientShellAccount(user),
    lockedNavKeys(user?.id ?? null),
  ])
  const initial = { sections: sections.map((s) => ({ key: s.key, title: s.title, description: s.description, icon: s.icon, href: s.nav_href })), hiddenPaths }
  const shell = clientShellData(account, hiddenPaths, lockedKeys)

  return (
    <PlatformSectionsProvider initial={initial}>
    <div className="min-h-screen bg-background">
      <ActivityTracker />
      <ImpersonationBanner />
      {/* One navigation for every cabinet page (Точка А / Б open inside it);
          hidden on the gate and full-screen flows — see clientShellMode. */}
      <ClientNav items={shell.items} panel={shell.panel} email={shell.email} />
      <div className="mx-auto max-w-5xl px-4 pt-3 empty:hidden">
        <AnnouncementBar />
      </div>
      {children}
      {/* Floating assistant — the mascot «Гри» on every client page (survey,
          Point A, etc.); static-launcher fallback via MascotLauncher */}
      <MascotLauncher />
      {/* Pop-ups on every cabinet page: expert messages (card; modal for «важное») */}
      <PopupLayer />
      <ChatHost />
    </div>
    </PlatformSectionsProvider>
  )
}
