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
export type ClientNavKey = 'home' | 'dashboard' | 'point_a' | 'point_b' | 'survey' | 'gri' | 'market' | 'messages' | 'documents'

export interface ClientNavItem {
  key: ClientNavKey
  label: string
  href: string
  /** Material Symbols name. */
  icon: string
  /** Unread counter (Сообщения). */
  badge?: number
  /**
   * Round 2 (R2-A): a paid section closed for this account — the item stays (it
   * opens the section's paywall with «Оставить заявку на доступ»), marked with a lock.
   */
  locked?: boolean
}

interface ItemDef extends Omit<ClientNavItem, 'badge' | 'locked'> {
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
  // R2-C (Q5): Рынок — a paid section; closed → a lock, the page shows the paywall.
  { key: 'market', label: 'Рынок', href: '/market', icon: 'public', openBeforeApproval: false },
  { key: 'messages', label: 'Сообщения', href: '/client/messages', icon: 'forum', openBeforeApproval: true },
  { key: 'documents', label: 'Документы', href: '/client/onboarding/documents', icon: 'cloud_upload', openBeforeApproval: true },
]

/** R-096: the notification feed — the bell of the cabinet bar («Доступ открыт», replies, reminders). */
export const NOTIFICATIONS_HREF = '/notifications'

/**
 * Pages an expert account cannot open (middleware ADMIN_PATHS send an expert
 * to /expert/dashboard); a path blocks everything under it. Kept in sync by
 * tests/unit/client-shell.
 */
export const EXPERT_BLOCKED_HREFS: readonly string[] = ['/dashboard', '/gri', '/market', NOTIFICATIONS_HREF, '/simulator', '/metrics', '/profile']

export type ClientMoreKey = 'pulse' | 'simulator' | 'metrics' | 'psych'

/** An item of «Ещё» in the cabinet bar. */
export interface ClientMoreItem {
  key: ClientMoreKey
  label: string
  href: string
  /** Material Symbols name. */
  icon: string
}

/**
 * WA-1: the sections of the old menus (lib/navigation.ts, MobileNav) that the
 * cabinet bar had no item for — under «Ещё», so a client in the old shell
 * (R-028) does not lose them. Клиенты (CRM), Симулятор and Метрики are
 * platform sections: shown only when GIGA-CRM makes them visible to the
 * client (platform_sections → hiddenPaths; on prod they are staff_only, so a
 * client sees none of them — as intended). Психопрофиль is not a platform
 * section and is a client page (/profile is in middleware CLIENT_DASHBOARD_PATHS).
 * None of them is a paid section (lib/access/entitlements PAID_SECTIONS), so
 * the access decision puts no lock on them. Before approval «Ещё» is empty:
 * middleware closes the first three (R-052), and Психопрофиль (an AI feature)
 * is not offered before approval, like the paid sections of the main menu.
 */
export const CLIENT_MORE_DEFS: readonly ClientMoreItem[] = [
  { key: 'pulse', label: 'Клиенты (CRM)', href: '/pulse', icon: 'groups' },
  { key: 'simulator', label: 'Симулятор', href: '/simulator', icon: 'query_stats' },
  { key: 'metrics', label: 'Метрики', href: '/metrics', icon: 'monitoring' },
  { key: 'psych', label: 'Психопрофиль', href: '/profile/psych', icon: 'psychology' },
]

/** WA-1: «Ещё» for the account — visible sections only, nothing middleware would bounce. */
export function buildClientMoreNav(input: Pick<BuildClientNavInput, 'approved' | 'hiddenPaths' | 'profileRole'>): ClientMoreItem[] {
  if (!input.approved) return []
  const expert = isExpertProfile(input.profileRole)
  return CLIENT_MORE_DEFS
    .filter((d) => !hiddenByPlatform(d.href, input.hiddenPaths))
    .filter((d) => !(expert && EXPERT_BLOCKED_HREFS.some((b) => under(d.href, b))))
    .map((d) => ({ ...d }))
}

/** The «Ещё» item of `pathname`, or null. */
export function activeClientMoreKey(pathname: string, items: readonly Pick<ClientMoreItem, 'key' | 'href'>[]): ClientMoreKey | null {
  const path = (pathname || '').split(/[?#]/, 1)[0]
  return items.find((i) => under(path, i.href))?.key ?? null
}

const isExpertProfile = (role: string | null | undefined) => role === 'expert' || role === 'manager' || role === 'analyst'

/** The bell: where the feed is and how many entries are unread (server count). */
export interface ClientNotificationsLink {
  href: string
  unread: number
}

/**
 * R-096: the bell of the cabinet bar, or null when the account cannot open the
 * feed — an expert profile (middleware sends it to /expert/dashboard) or the
 * feed switched off in GIGA-CRM. Open before approval (middleware
 * OPEN_BEFORE_APPROVAL): a pending client learns the decision there too.
 */
export function clientNotificationsLink(input: { profileRole?: string | null; hiddenPaths: readonly string[]; unread?: number }): ClientNotificationsLink | null {
  if (isExpertProfile(input.profileRole)) return null
  if (hiddenByPlatform(NOTIFICATIONS_HREF, input.hiddenPaths)) return null
  return { href: NOTIFICATIONS_HREF, unread: Math.max(0, Math.floor(Number(input.unread) || 0)) }
}

/**
 * R-096 / WA-4: the number on the bell. On the feed page itself — none (the
 * page shows it). Before the first sync — the server's count; after it — the
 * shared store, which the poll AND the feed page («Прочитать все», opening an
 * entry) write, so the number changes at once.
 */
export function bellUnreadCount(input: { onFeed: boolean; synced: boolean; live: number; server: number }): number {
  if (input.onFeed) return 0
  return Math.max(0, Math.floor(Number(input.synced ? input.live : input.server) || 0))
}

/**
 * `href` with the query of the page being left (Next.js `searchParams`), so a
 * redirect from an old address keeps e.g. `?tab=` (R-094: /point-a → /client/point-a).
 */
export function hrefWithQuery(href: string, searchParams?: Readonly<Record<string, string | string[] | undefined>>): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) qs.append(key, v)
  }
  const query = qs.toString()
  return query ? `${href}?${query}` : href
}

/**
 * R-028: who gets the cabinet bar on the pages of the old (dashboard) shell
 * (/dashboard, /gri, /settings…) instead of the staff sidebar: a client —
 * profiles.role 'client' (or the legacy 'owner') that is not staff
 * (user_segment_facts.is_staff: a staff_roles row or an admin / super_admin
 * profile). Unknown facts → false: the old shell, as before.
 */
export function usesClientShell(facts: { role?: string | null; is_staff?: boolean } | null | undefined): boolean {
  if (!facts || facts.is_staff) return false
  return facts.role === 'client' || facts.role === 'owner'
}

export interface BuildClientNavInput {
  /** profiles.status === 'approved'. */
  approved: boolean
  /** Paths of platform sections hidden for this user (visibleSectionsFor). */
  hiddenPaths: readonly string[]
  /** profiles.role of the signed-in account (null when unknown). */
  profileRole?: string | null
  /** Unread messages from AIStart360 (comm_threads.unread_user). */
  unreadMessages?: number
  /** Paid sections closed for the account (server decision, lib/access/decision.ts). */
  lockedKeys?: readonly ClientNavKey[]
}

/** Menu item of each paid section (lib/access/entitlements.ts PAID_SECTIONS). */
export const PAID_NAV_KEYS: Readonly<Record<'point_a' | 'point_b' | 'market' | 'gri_full', ClientNavKey>> = { point_a: 'point_a', point_b: 'point_b', market: 'market', gri_full: 'gri' }

/** Menu items to lock from the server decision (lib/access/decision.ts sections: not true = closed). */
export function lockedNavKeysFor(sections: Readonly<Partial<Record<keyof typeof PAID_NAV_KEYS, boolean>>>): ClientNavKey[] {
  return (Object.keys(PAID_NAV_KEYS) as Array<keyof typeof PAID_NAV_KEYS>).filter((f) => !sections[f]).map((f) => PAID_NAV_KEYS[f])
}

function under(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Same rule as lib/platform/sections.ts pathIsHidden (kept pure here). */
function hiddenByPlatform(href: string, hiddenPaths: readonly string[]): boolean {
  return hiddenPaths.some((p) => under(href, p))
}

export function buildClientNav(input: BuildClientNavInput): ClientNavItem[] {
  const expert = isExpertProfile(input.profileRole)
  const unread = Math.max(0, Math.floor(Number(input.unreadMessages) || 0))
  return CLIENT_NAV_DEFS
    .filter((d) => input.approved || d.openBeforeApproval)
    .filter((d) => !hiddenByPlatform(d.href, input.hiddenPaths))
    .filter((d) => !(expert && EXPERT_BLOCKED_HREFS.some((b) => under(d.href, b))))
    .map(({ openBeforeApproval: _open, ...item }) => (item.key === 'messages' && unread > 0 ? { ...item, badge: unread } : item))
    .map((item) => (input.lockedKeys?.includes(item.key) ? { ...item, locked: true } : item))
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
