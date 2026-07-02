import type { NavItem, UserRole } from '@/types'

const ALL_ROLES: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT']
// Staff-only surfaces. These pages live in the (dashboard) group and middleware
// keeps them in ADMIN_PATHS — a CLIENT hitting them is silently redirected to
// /dashboard, so they must NOT appear in the client sidebar (dead links).
const STAFF_ROLES: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST']
// What a CLIENT may actually open — mirrors middleware CLIENT_DASHBOARD_PATHS.
const CLIENT_OK: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT']

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
  { label: 'Клиенты',      href: '/clients',      icon: 'business_center',   roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
  { label: 'Отчёты',       href: '/reports',      icon: 'description',       roles: STAFF_ROLES },
  { label: 'Аналитика',    href: '/analytics',    icon: 'bar_chart',         roles: STAFF_ROLES },
  { label: 'Команда',      href: '/team',         icon: 'group',             roles: ['SUPER_ADMIN', 'ADMIN'] },
  { label: 'Уведомления',  href: '/notifications',icon: 'notifications',     roles: CLIENT_OK },
  { label: 'Пользователи', href: '/users',        icon: 'manage_accounts',   roles: ['SUPER_ADMIN', 'ADMIN'] },
  { label: 'Админ',        href: '/admin',        icon: 'admin_panel_settings', roles: ['SUPER_ADMIN', 'ADMIN'] },
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

// Role display labels
export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN:       'Administrator',
  MANAGER:     'Manager',
  ANALYST:     'Analyst',
  CLIENT:      'Client',
}

// Role permissions map
export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  SUPER_ADMIN: ['*'],
  ADMIN:       ['clients.*', 'reports.*', 'analytics.*', 'team.*', 'settings.*', 'billing.*'],
  MANAGER:     ['clients.read', 'clients.write', 'reports.*', 'analytics.read', 'intelligence.read'],
  ANALYST:     ['clients.read', 'reports.read', 'analytics.read'],
  CLIENT:      ['own.gri', 'own.reports', 'own.profile', 'support'],
}

export function hasPermission(role: UserRole, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role]
  return perms.includes('*') || perms.includes(permission) || perms.some((p) => {
    if (p.endsWith('.*')) {
      const base = p.slice(0, -2)
      return permission.startsWith(base + '.')
    }
    return false
  })
}
