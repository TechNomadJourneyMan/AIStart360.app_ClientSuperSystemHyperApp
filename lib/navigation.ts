import type { NavItem, UserRole } from '@/types'

// PRIMARY navigation — shown directly in the sidebar
export const PRIMARY_NAV: NavItem[] = [
  { label: 'Дэшборд',    href: '/dashboard',  icon: 'dashboard',     roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT'] },
  { label: 'GRI',        href: '/gri',         icon: 'radar',         roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT'] },
  { label: 'Рынок',      href: '/market',      icon: 'public',        roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT'] },
  { label: 'Точка А',    href: '/point-a',     icon: 'my_location',   roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT'] },
  { label: 'Точка Б',    href: '/point-b',     icon: 'flag',          roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT'] },
  { label: 'Инсайты',    href: '/insights',    icon: 'lightbulb',     roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT'] },
  { label: 'Конкуренты', href: '/competitors', icon: 'compare_arrows',roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CLIENT'] },
  { label: 'Метрики',    href: '/metrics',     icon: 'monitoring',    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT'] },
  { label: 'AI Scanner', href: '/ai-scanner', icon: 'biotech',       roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CLIENT'] },
  { label: 'GRI Pulse',  href: '/pulse',       icon: 'cell_tower',    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CLIENT'] },
]

// SECONDARY navigation — hidden behind "Ещё"
export const SECONDARY_NAV: NavItem[] = [
  { label: 'Клиенты',      href: '/clients',      icon: 'business_center', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] }, // Скрываем от Клиента (этот раздел нужен тебе)
  { label: 'Отчёты',       href: '/reports',      icon: 'description',     roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT'] },
  { label: 'Аналитика',    href: '/analytics',    icon: 'bar_chart',       roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT'] },
  { label: 'Разведка',     href: '/intelligence', icon: 'hub',             roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CLIENT'] },
  { label: 'Команда',      href: '/team',         icon: 'group',           roles: ['SUPER_ADMIN', 'ADMIN'] }, // Управление сервисной командой скрыто
  { label: 'Уведомления',  href: '/notifications',icon: 'notifications',   roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT'] },
  { label: 'Пользователи', href: '/users',        icon: 'manage_accounts', roles: ['SUPER_ADMIN', 'ADMIN'] }, // Скрыто (внутрянка)
  { label: 'Админ',        href: '/admin',        icon: 'admin_panel_settings', roles: ['SUPER_ADMIN', 'ADMIN'] }, // Скрыто (внутрянка)
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
