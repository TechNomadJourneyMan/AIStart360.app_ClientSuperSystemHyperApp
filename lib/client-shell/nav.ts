/**
 * lib/client-shell/nav.ts — the navigation model of the client cabinet shell.
 *
 * One menu for every /client/* page (PO 2026-10-22, п. 2: Точка А and Точка Б
 * open inside the cabinet, not in an isolated screen). Pure: the server layout
 * builds the items, the client component only highlights the active one.
 *
 * Which items a user sees:
 *  - sections switched off in GIGA-CRM (platform_sections → hiddenPaths) are
 *    dropped — the same rule middleware uses to block the routes;
 *  - until access is approved, only the sections the cabinet already treats as
 *    open (UserHome: survey, documents, messages, GRI) are listed — Точка А/Б and
 *    the dashboard stay closed, as on the home page cards;
 *  - an expert account (profiles.role 'expert', opening the cabinet to check it)
 *    does not get links that middleware would bounce back to /expert.
 */
export type ClientNavKey = 'home' | 'dashboard' | 'point_a' | 'point_b' | 'survey' | 'gri' | 'messages' | 'documents'

export interface ClientNavItem {
  key: ClientNavKey
  label: string
  href: string
  /** Material Symbols name. */
  icon: string
  /** Unread counter (Сообщения). */
  badge?: number
}

interface ItemDef extends Omit<ClientNavItem, 'badge'> {
  /** Shown before access is approved (mirrors UserHome «open» cards). */
  openBeforeApproval: boolean
}

/** Display order. Paths are the existing routes — nothing new is mounted. */
export const CLIENT_NAV_DEFS: readonly ItemDef[] = [
  { key: 'home', label: 'Главная', href: '/client/home', icon: 'home', openBeforeApproval: true },
  { key: 'dashboard', label: 'Дашборд', href: '/dashboard', icon: 'dashboard', openBeforeApproval: false },
  { key: 'point_a', label: 'Точка А', href: '/client/point-a', icon: 'my_location', openBeforeApproval: false },
  { key: 'point_b', label: 'Точка Б', href: '/client/point-b', icon: 'flag_circle', openBeforeApproval: false },
  { key: 'survey', label: 'Анкета', href: '/client/onboarding', icon: 'edit_note', openBeforeApproval: true },
  { key: 'gri', label: 'GRI', href: '/gri', icon: 'radar', openBeforeApproval: true },
  { key: 'messages', label: 'Сообщения', href: '/client/messages', icon: 'forum', openBeforeApproval: true },
  { key: 'documents', label: 'Документы', href: '/client/onboarding/documents', icon: 'cloud_upload', openBeforeApproval: true },
]

/**
 * Pages an expert account cannot open (middleware ADMIN_PATHS send an expert
 * to /expert/dashboard). Kept in sync by tests/unit/client-shell.
 */
export const EXPERT_BLOCKED_HREFS: readonly string[] = ['/dashboard', '/gri']

export interface BuildClientNavInput {
  /** profiles.status === 'approved'. */
  approved: boolean
  /** Paths of platform sections hidden for this user (visibleSectionsFor). */
  hiddenPaths: readonly string[]
  /** profiles.role of the signed-in account (null when unknown). */
  profileRole?: string | null
  /** Unread messages from AIStart360 (comm_threads.unread_user). */
  unreadMessages?: number
}

function under(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Same rule as lib/platform/sections.ts pathIsHidden (kept pure here). */
function hiddenByPlatform(href: string, hiddenPaths: readonly string[]): boolean {
  return hiddenPaths.some((p) => under(href, p))
}

export function buildClientNav(input: BuildClientNavInput): ClientNavItem[] {
  const expert = input.profileRole === 'expert' || input.profileRole === 'manager' || input.profileRole === 'analyst'
  const unread = Math.max(0, Math.floor(Number(input.unreadMessages) || 0))
  return CLIENT_NAV_DEFS
    .filter((d) => input.approved || d.openBeforeApproval)
    .filter((d) => !hiddenByPlatform(d.href, input.hiddenPaths))
    .filter((d) => !(expert && EXPERT_BLOCKED_HREFS.includes(d.href)))
    .map(({ openBeforeApproval: _open, ...item }) => (item.key === 'messages' && unread > 0 ? { ...item, badge: unread } : item))
}


/**
 * The item to highlight for `pathname`: the longest matching href wins, so
 * /client/onboarding/documents is «Документы», not «Анкета».
 */
export function activeClientNavKey(pathname: string, items: readonly Pick<ClientNavItem, 'key' | 'href'>[]): ClientNavKey | null {
  const path = (pathname || '').split(/[?#]/, 1)[0]
  let best: { key: ClientNavKey; len: number } | null = null
  for (const item of items) {
    if (under(path, item.href) && (!best || item.href.length > best.len)) best = { key: item.key, len: item.href.length }
  }
  // The medical intake is the survey of the clinic vertical.
  if (!best && under(path, '/client/onboarding-medical')) return items.some((i) => i.key === 'survey') ? 'survey' : null
  return best?.key ?? null
}

/**
 * How the shell draws its bar on a page:
 *  - 'sticky' — the usual case, the bar stays on top while scrolling;
 *  - 'static' — the bar scrolls away: the survey wizard has its own sticky
 *    progress header and step tabs, two sticky bars would cover each other;
 *  - 'none'   — gate and full-screen flows keep their own chrome: the waiting
 *    room (access not granted yet), the first-run vertical choice, and the
 *    full-screen AI Journey workspace.
 */
export type ClientShellMode = 'sticky' | 'static' | 'none'

const NO_SHELL = ['/client/waiting-room', '/client/welcome', '/client/journey']
const STATIC_SHELL = ['/client/onboarding']

export function clientShellMode(pathname: string): ClientShellMode {
  const path = (pathname || '').split(/[?#]/, 1)[0]
  if (NO_SHELL.some((p) => under(path, p))) return 'none'
  // Only the wizard itself: /client/onboarding/documents is an ordinary page.
  if (STATIC_SHELL.includes(path)) return 'static'
  return 'sticky'
}
