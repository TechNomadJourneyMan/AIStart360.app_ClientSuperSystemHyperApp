import type { NavItem, UserRole } from '@/types'
import { getVerticalUi, type VerticalId } from '@/lib/verticals'

// Staff-only surfaces. These pages live in the (dashboard) group and middleware
// keeps them in ADMIN_PATHS — a CLIENT hitting them is silently redirected to
// /dashboard, so they must NOT appear in the client sidebar (dead links).
// (manager/analyst were legacy Prisma roles that never exist at runtime; expert
// and owner navigate in their own route groups with their own sidebars.)
const STAFF_ROLES: UserRole[] = ['super_admin', 'admin']
// What a CLIENT may actually open — mirrors middleware CLIENT_DASHBOARD_PATHS.
const CLIENT_OK: UserRole[] = ['super_admin', 'admin', 'client']

// PRIMARY navigation shared by every product vertical. The specialized slot
// (Store / Clinic) is injected immediately after Dashboard by
// getPrimaryNavigation(), from the single vertical registry.
const PRIMARY_NAV_BASE: NavItem[] = [
  { label: 'Дэшборд',   href: '/dashboard', icon: 'dashboard',   roles: CLIENT_OK },
  { label: 'GRI',       href: '/gri',        icon: 'radar',       roles: CLIENT_OK },
  // /pulse is now the lightweight CRM (own client base «Кому звонить сегодня»)
  // with the weekly GRI Pulse survey collapsed at the bottom — so the menu item
  // reads «Клиенты». Client-facing: middleware keeps /pulse in the client paths.
  { label: 'Клиенты',   href: '/pulse',      icon: 'groups',      roles: CLIENT_OK },
  { label: 'Точка А',   href: '/point-a',    icon: 'my_location', roles: CLIENT_OK },
  { label: 'Точка Б',   href: '/point-b',    icon: 'flag',        roles: CLIENT_OK },
  { label: 'Симулятор', href: '/simulator',  icon: 'query_stats', roles: CLIENT_OK },
  { label: 'Метрики',   href: '/metrics',    icon: 'monitoring',  roles: CLIENT_OK },
  {
    label: 'Рынок',
    href: '/market',
    icon: 'public',
    roles: CLIENT_OK,
    subItems: [
      // Only /market itself is client-reachable; the rest are ADMIN_PATHS.
      { label: 'Рынок',      href: '/market',       icon: 'public',         roles: CLIENT_OK },
      { label: 'Конкуренты', href: '/competitors',  icon: 'compare_arrows', roles: STAFF_ROLES },
      { label: 'Инсайты',    href: '/insights',     icon: 'lightbulb',      roles: STAFF_ROLES },
      { label: 'Разведка',   href: '/intelligence', icon: 'hub',            roles: STAFF_ROLES },
    ],
  },
]

export function getVerticalNavItem(vertical: VerticalId): NavItem | null {
  const definition = getVerticalUi(vertical).verticalNav
  return definition ? { ...definition, roles: CLIENT_OK } : null
}

export function getPrimaryNavigation(vertical: VerticalId = 'generic'): NavItem[] {
  const verticalItem = getVerticalNavItem(vertical)
  if (!verticalItem) return PRIMARY_NAV_BASE

  const [dashboard, ...rest] = PRIMARY_NAV_BASE
  return [dashboard, verticalItem, ...rest]
}

// Backward-compatible static export uses the fail-closed generic catalog.
// Runtime Sidebar/MobileNav always call the vertical-aware selectors below.
export const PRIMARY_NAV: NavItem[] = getPrimaryNavigation('generic')

// SECONDARY navigation — hidden behind "Ещё"
export const SECONDARY_NAV: NavItem[] = [
  // Staff portfolio page — distinct from the client-facing CRM at /pulse; labelled
  // «Портфель» so staff don't see two «Клиенты» entries.
  { label: 'Портфель',     href: '/clients',      icon: 'business_center',   roles: STAFF_ROLES },
  { label: 'Отчёты',       href: '/reports',      icon: 'description',       roles: STAFF_ROLES },
  { label: 'Аналитика',    href: '/analytics',    icon: 'bar_chart',         roles: STAFF_ROLES },
  { label: 'Команда',      href: '/team',         icon: 'group',             roles: STAFF_ROLES },
  { label: 'Уведомления',  href: '/notifications',icon: 'notifications',     roles: CLIENT_OK },
  { label: 'Психопрофиль', href: '/profile/psych',icon: 'psychology',        roles: CLIENT_OK },
  { label: 'Пользователи', href: '/users',        icon: 'manage_accounts',   roles: STAFF_ROLES },
  { label: 'Админ',        href: '/admin',        icon: 'admin_panel_settings', roles: STAFF_ROLES },
]

// ACCOUNT navigation — the desktop sidebar renders these in its own footer, so
// they are deliberately kept out of PRIMARY/SECONDARY (no duplicates in «Ещё»).
// Mobile has no footer and needs them listed explicitly.
export const ACCOUNT_NAV: NavItem[] = [
  { label: 'Профиль',   href: '/profile',  icon: 'account_circle', roles: CLIENT_OK },
  { label: 'Настройки', href: '/settings', icon: 'settings',       roles: CLIENT_OK },
]

// Legacy flat list (for backward compat)
export const NAV_ITEMS: NavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV]

export function getNavForRole(role: UserRole, vertical: VerticalId = 'generic'): NavItem[] {
  return [...getPrimaryNavigation(vertical), ...SECONDARY_NAV]
    .filter((item) => item.roles.includes(role))
}

// Every href a role may actually open — parents, their subItems and the account
// pages. Filtering by the flat NAV_ITEMS alone silently drops nested entries
// (/competitors, /insights, /intelligence), which is what hid them on mobile.
export function getAllowedHrefsForRole(role: UserRole, vertical: VerticalId = 'generic'): string[] {
  const hrefs = new Set<string>()
  for (const item of [...getPrimaryNavigation(vertical), ...SECONDARY_NAV, ...ACCOUNT_NAV]) {
    if (item.roles.includes(role)) hrefs.add(item.href)
    for (const sub of item.subItems ?? []) {
      if (sub.roles.includes(role)) hrefs.add(sub.href)
    }
  }
  return [...hrefs]
}

// Whole-segment matching prevents a navigation item such as /store from being
// highlighted on an unrelated path such as /storefront.
export function isActiveNavPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function getPrimaryNavForRole(role: UserRole, vertical: VerticalId = 'generic'): NavItem[] {
  return getPrimaryNavigation(vertical).filter((item) => item.roles.includes(role))
}

export function getSecondaryNavForRole(role: UserRole): NavItem[] {
  return SECONDARY_NAV.filter((item) => item.roles.includes(role))
}

export interface MobileNavSection {
  title: string
  items: NavItem[]
}

const MOBILE_BOTTOM_HREFS = ['/dashboard', '/pulse', '/clients', '/metrics'] as const
const MOBILE_DRAWER_FIXED_SECTIONS = [
  {
    title: 'Анализ',
    hrefs: ['/market', '/point-a', '/point-b', '/simulator', '/competitors', '/intelligence'],
  },
  {
    title: 'Работа',
    hrefs: ['/clients', '/reports', '/analytics', '/team'],
  },
  {
    title: 'Система',
    hrefs: ['/notifications', '/users', '/profile', '/settings', '/admin'],
  },
] as const

function getNavigationCatalog(vertical: VerticalId): Map<string, NavItem> {
  const items = [...getPrimaryNavigation(vertical), ...SECONDARY_NAV, ...ACCOUNT_NAV]
  const catalog = new Map<string, NavItem>()

  for (const item of items) {
    if (!catalog.has(item.href)) catalog.set(item.href, item)
    for (const subItem of item.subItems ?? []) {
      if (!catalog.has(subItem.href)) catalog.set(subItem.href, subItem)
    }
  }
  return catalog
}

function selectMobileItems(
  catalog: Map<string, NavItem>,
  hrefs: readonly string[],
  role: UserRole,
): NavItem[] {
  return hrefs.flatMap((href) => {
    const item = catalog.get(href)
    return item?.roles.includes(role) ? [item] : []
  })
}

/** Mobile bottom tabs resolved from the same labels/icons as desktop. */
export function getMobileBottomTabsForRole(
  role: UserRole,
  vertical: VerticalId = 'generic',
): NavItem[] {
  return selectMobileItems(getNavigationCatalog(vertical), MOBILE_BOTTOM_HREFS, role)
}

/** Mobile drawer resolved from the same vertical-aware catalog as desktop. */
export function getMobileDrawerSectionsForRole(
  role: UserRole,
  vertical: VerticalId = 'generic',
): MobileNavSection[] {
  const catalog = getNavigationCatalog(vertical)
  const verticalItem = getVerticalNavItem(vertical)
  const mainHrefs = [
    '/dashboard',
    ...(verticalItem ? [verticalItem.href] : []),
    '/gri',
    '/pulse',
    '/metrics',
    '/insights',
  ]

  return [
    { title: 'Основное', items: selectMobileItems(catalog, mainHrefs, role) },
    ...MOBILE_DRAWER_FIXED_SECTIONS.map((section) => ({
      title: section.title,
      items: selectMobileItems(catalog, section.hrefs, role),
    })),
  ].filter((section) => section.items.length > 0)
}

/**
 * The mobile «Ещё» trigger represents drawer-only destinations. Items repeated
 * in the bottom bar must not make both controls look current at once.
 */
export function isMobileMoreRouteActive(
  pathname: string,
  bottomTabs: readonly NavItem[],
  drawerSections: readonly MobileNavSection[],
): boolean {
  if (bottomTabs.some((item) => isActiveNavPath(pathname, item.href))) return false
  return drawerSections
    .flatMap((section) => section.items)
    .some((item) => isActiveNavPath(pathname, item.href))
}

// Role display labels (Russian UI)
export const ROLE_LABELS: Record<UserRole, string> = {
  client:      'Клиент',
  expert:      'Эксперт',
  owner:       'Владелец',
  admin:       'Администратор',
  super_admin: 'Супер-админ',
}

// Role permissions map. owner is an elevated business role (≈ super_admin);
// expert validates AI output and reads assigned clients.
export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  super_admin: ['*'],
  owner:       ['*'],
  admin:       ['clients.*', 'reports.*', 'analytics.*', 'team.*', 'settings.*', 'billing.*'],
  expert:      ['clients.read', 'reports.read', 'analytics.read', 'intelligence.read'],
  client:      ['own.gri', 'own.reports', 'own.profile', 'support'],
}

export function hasPermission(role: UserRole, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? []
  return perms.includes('*') || perms.includes(permission) || perms.some((p) => {
    if (p.endsWith('.*')) {
      const base = p.slice(0, -2)
      return permission.startsWith(base + '.')
    }
    return false
  })
}
