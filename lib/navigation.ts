import type { NavItem, UserRole } from '@/types'

// Staff-only surfaces. These pages live in the (dashboard) group and middleware
// keeps them in ADMIN_PATHS — a CLIENT hitting them is silently redirected to
// /dashboard, so they must NOT appear in the client sidebar (dead links).
// (manager/analyst were legacy Prisma roles that never exist at runtime; expert
// navigates in its own route group with its own sidebar. 'owner' was removed
// from the product on 2026-09-24 — legacy owner rows are treated as clients.)
const STAFF_ROLES: UserRole[] = ['super_admin', 'admin']
// What a CLIENT may actually open — mirrors middleware CLIENT_DASHBOARD_PATHS.
const CLIENT_OK: UserRole[] = ['super_admin', 'admin', 'client']

// PRIMARY navigation — shown directly in the sidebar
export const PRIMARY_NAV: NavItem[] = [
  // The client's landing page (survey profile + GRI status). Lives outside the
  // (dashboard) group, so this entry is the way back to it from the portal.
  { label: 'Мой профиль', href: '/client/home', icon: 'badge', roles: ['client'] },
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
  // User management and registration requests live in the GIGA panel (the old
  // /users and /admin screens were removed).
  // Shown only with panel access (super_admin or a staff_roles row): a legacy
  // profiles.role 'admin' without one would bounce off the panel gate.
  { label: 'Пользователи', href: '/admin-giga-panel/users',    icon: 'manage_accounts',      roles: STAFF_ROLES, panel: true },
  { label: 'Заявки',       href: '/admin-giga-panel/requests', icon: 'admin_panel_settings', roles: STAFF_ROLES, panel: true },
]

// Legacy flat list (for backward compat)
export const NAV_ITEMS: NavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV]

export interface NavAccess {
  /** super_admin or a staff_roles member — may open the GIGA panel. */
  panelAccess?: boolean
}

function visible(item: NavItem, role: UserRole, access: NavAccess): boolean {
  if (!item.roles.includes(role)) return false
  return !item.panel || (access.panelAccess ?? role === 'super_admin')
}

export function getNavForRole(role: UserRole, access: NavAccess = {}): NavItem[] {
  return NAV_ITEMS.filter((item) => visible(item, role, access))
}

export function getPrimaryNavForRole(role: UserRole, access: NavAccess = {}): NavItem[] {
  return PRIMARY_NAV.filter((item) => visible(item, role, access))
}

export function getSecondaryNavForRole(role: UserRole, access: NavAccess = {}): NavItem[] {
  return SECONDARY_NAV.filter((item) => visible(item, role, access))
}

// Role display labels (Russian UI)
export const ROLE_LABELS: Record<UserRole, string> = {
  client:      'Клиент',
  expert:      'Эксперт',
  admin:       'Администратор',
  super_admin: 'Супер-админ',
}

// Role permissions map. expert validates AI output and reads assigned clients.
// ('owner' was removed from the product on 2026-09-24.)
const CLIENT_PERMISSIONS = ['own.gri', 'own.reports', 'own.profile', 'support']
export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  super_admin: ['*'],
  admin:       ['clients.*', 'reports.*', 'analytics.*', 'team.*', 'settings.*', 'billing.*'],
  expert:      ['clients.read', 'reports.read', 'analytics.read', 'intelligence.read'],
  client:      CLIENT_PERMISSIONS,
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
