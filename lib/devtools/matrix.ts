/**
 * lib/devtools/matrix.ts — матрица «роль × право» и меню каждой роли для
 * вкладки «Права» Dev-tools. Строится из кода (lib/admin/rbac.ts,
 * lib/admin/nav.ts) — то же, что проверяет сервер.
 */
import { ALL_PERMISSIONS, PERMISSIONS, STAFF_ROLES, hasPermission, type Permission, type StaffRole } from '@/lib/admin/rbac'
import { GIGA_NAV, SUPER_EXPERT_NAV, visibleNav, type GigaNavGroup } from '@/lib/admin/nav'

export interface MatrixRow {
  permission: Permission
  description: string
  roles: Record<StaffRole, boolean>
}

export function permissionMatrix(): MatrixRow[] {
  return ALL_PERMISSIONS.map((permission) => ({
    permission,
    description: PERMISSIONS[permission],
    roles: Object.fromEntries(STAFF_ROLES.map((r) => [r, hasPermission(r, permission)])) as Record<StaffRole, boolean>,
  }))
}

/** Сколько прав у роли. */
export function permissionCount(role: StaffRole): number {
  return ALL_PERMISSIONS.filter((p) => hasPermission(role, p)).length
}

export interface RoleNav {
  /** Меню панели GIGA-CRM. */
  giga: GigaNavGroup[]
  /** Меню кабинета SuperExpert (только у ролей, которых туда пускает middleware). */
  superExpert: GigaNavGroup[] | null
}

/** Роли, которых middleware пускает в /super-expert (см. middleware.ts SUPER_EXPERT_ROLES). */
const SUPER_EXPERT_WORKSPACE_ROLES: ReadonlySet<StaffRole> = new Set<StaffRole>(['super_admin', 'admin', 'super_expert', 'crm_manager'])

export function navForRole(role: StaffRole): RoleNav {
  const can = (p: Permission) => hasPermission(role, p)
  return {
    giga: visibleNav(GIGA_NAV, can),
    superExpert: SUPER_EXPERT_WORKSPACE_ROLES.has(role) ? visibleNav(SUPER_EXPERT_NAV, can) : null,
  }
}
