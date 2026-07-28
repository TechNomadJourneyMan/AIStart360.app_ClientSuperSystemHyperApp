import type { NavItem, UserRole } from '@/types'

const ALL_ROLES: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT']

// PRIMARY navigation — shown directly in the sidebar
export const PRIMARY_NAV: NavItem[] = [
  { label: 'Дэшборд',   href: '/dashboard', icon: 'dashboard',   roles: ALL_ROLES },
  { label: 'Продажи',   href: '/sales-monitoring', icon: 'point_of_sale', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST'] },
  { label: 'GRI',       href: '/gri',        icon: 'radar',       roles: ALL_ROLES },
  { label: 'GRI Pulse', href: '/pulse',      icon: 'cell_tower',  roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CLIENT'] },
  { label: 'Точка А',   href: '/point-a',    icon: 'my_location', roles: ALL_ROLES },
  { label: 'Точка Б',   href: '/point-b',    icon: 'flag',        roles: ALL_ROLES },
  { label: 'Метрики',   href: '/metrics',    icon: 'monitoring',  roles: ALL_ROLES },
  {
    label: 'Рынок',
    href: '/market',
    icon: 'public',
    roles: ALL_ROLES,
    subItems: [
      { label: 'Рынок',            href: '/market',             icon: 'public',         roles: ALL_ROLES },
      { label: 'Конкуренты',       href: '/competitors',        icon: 'compare_arrows', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CLIENT'] },
      { label: 'Инсайты',          href: '/insights',           icon: 'lightbulb',      roles: ALL_ROLES },
      { label: 'Разведка',         href: '/intelligence',       icon: 'hub',            roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CLIENT'] },
    ],
  },
]

// SECONDARY navigation — hidden behind "Ещё"
export const SECONDARY_NAV: NavItem[] = [
  { label: 'Клиенты',      href: '/clients',      icon: 'business_center',   roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
  { label: 'Отчёты',       href: '/reports',      icon: 'description',       roles: ALL_ROLES },
  { label: 'Аналитика',    href: '/analytics',    icon: 'bar_chart',         roles: ALL_ROLES },
  { label: 'Команда',      href: '/team',         icon: 'group',             roles: ['SUPER_ADMIN', 'ADMIN'] },
  { label: 'Уведомления',  href: '/notifications',icon: 'notifications',     roles: ALL_ROLES },
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
