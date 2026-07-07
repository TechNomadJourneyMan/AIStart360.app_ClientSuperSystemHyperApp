import type { NavItem, UserRole } from '@/types'

// Staff-only surfaces. These pages live in the (dashboard) group and middleware
// keeps them in ADMIN_PATHS — a CLIENT hitting them is silently redirected to
// /dashboard, so they must NOT appear in the client sidebar (dead links).
// (manager/analyst were legacy Prisma roles that never exist at runtime; expert
// and owner navigate in their own route groups with their own sidebars.)
const STAFF_ROLES: UserRole[] = ['super_admin', 'admin']
// What a CLIENT may actually open — mirrors middleware CLIENT_DASHBOARD_PATHS.
const CLIENT_OK: UserRole[] = ['super_admin', 'admin', 'client']

// PRIMARY navigation — shown directly in the sidebar
export const PRIMARY_NAV: NavItem[] = [
  { label: 'Дэшборд',   href: '/dashboard', icon: 'dashboard',   roles: CLIENT_OK },
  { label: 'GRI',       href: '/gri',        icon: 'radar',       roles: CLIENT_OK },
  // GRI Pulse is client-facing: /api/pulse scopes data by role (a client sees
  // only their own deals/metrics, staff see the portfolio). Restored to all
  // roles after being over-gated to staff-only. 2026-07-02.
  { label: 'GRI Pulse', href: '/pulse',      icon: 'cell_tower',  roles: CLIENT_OK },
  { label: 'Точка А',   href: '/point-a',    icon: 'my_location', roles: CLIENT_OK },
  { label: 'Точка Б',   href: '/point-b',    icon: 'flag',        roles: CLIENT_OK },
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
  { label: 'Клиенты',      href: '/clients',      icon: 'business_center',   roles: STAFF_ROLES },
  { label: 'Отчёты',       href: '/reports',      icon: 'description',       roles: STAFF_ROLES },
  { label: 'Аналитика',    href: '/analytics',    icon: 'bar_chart',         roles: STAFF_ROLES },
  { label: 'Команда',      href: '/team',         icon: 'group',             roles: STAFF_ROLES },
  { label: 'Уведомления',  href: '/notifications',icon: 'notifications',     roles: CLIENT_OK },
  { label: 'Пользователи', href: '/users',        icon: 'manage_accounts',   roles: STAFF_ROLES },
  { label: 'Админ',        href: '/admin',        icon: 'admin_panel_settings', roles: STAFF_ROLES },
]

// Legacy flat list (for backward compat)
export const NAV_ITEMS: NavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV]

export function getNavForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
}

export function getPrimaryNavForRole(role: UserRole): NavItem[] {
  return PRIMARY_NAV.filter((item) => item.roles.includes(role))
}

export function getSecondaryNavForRole(role: UserRole): NavItem[] {
  return SECONDARY_NAV.filter((item) => item.roles.includes(role))
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
