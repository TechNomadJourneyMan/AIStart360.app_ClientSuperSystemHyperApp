/**
 * lib/admin/rbac.ts — roles and permissions of GIGA-CRM staff.
 *
 * Staff roles live in `staff_roles` (migration 073), separate from
 * `profiles.role`, which keeps routing people to their cabinets. The matrix is
 * code, not data: a permission change is reviewed like any other change, and
 * the server checks it on every request (the UI only hides what is not allowed).
 */

export const STAFF_ROLES = ['super_admin', 'admin', 'super_expert', 'crm_manager', 'content_manager', 'analyst', 'support'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Администратор',
  super_expert: 'SuperExpert',
  crm_manager: 'CRM-менеджер',
  content_manager: 'Контент-менеджер',
  analyst: 'Аналитик',
  support: 'Поддержка',
}

export const PERMISSIONS = {
  'dashboard.view': 'Главный экран CRM',
  'users.view': 'Список пользователей и User 360',
  'users.sensitive': 'Контакты, документы, ответы анкеты',
  'users.manage': 'Блокировка, тариф, 2FA, виджеты, системные настройки (чтение)',
  'users.invite': 'Приглашения на платформу',
  'users.approve': 'Решение по заявке на доступ (одобрить / отклонить)',
  'users.archive': 'Архивация (удаление) пользователей',
  'users.delete': 'Полное удаление пользователя из платформы и БД (необратимо)',
  'company.edit': 'Данные компании клиента',
  'survey.view': 'Просмотр анкет',
  'survey.edit': 'Изменение анкет',
  'survey.delete': 'Полное удаление анкеты',
  'gri.view': 'Просмотр GRI',
  'gri.edit': 'Изменение GRI',
  'gri.delete': 'Удаление результатов GRI',
  'clients.review': 'Экспертный разбор клиента: комментарии, Точка Б, шаблоны',
  'activity.view': 'Активность пользователей',
  'cjm.view': 'Путь клиента (CJM)',
  'analytics.view': 'Аналитика платформы',
  'audit.view': 'Журнал действий персонала',
  'content.view': 'Просмотр контента',
  'content.edit': 'Создание и правка контента',
  'content.publish': 'Публикация и удаление контента',
  'platform.sections': 'Разделы платформы и видимость',
  'settings.manage': 'Системные настройки',
  'roles.manage': 'Управление ролями персонала',
  'impersonate.view': 'Кабинет от имени пользователя (просмотр)',
  'impersonate.edit': 'Кабинет от имени пользователя (правка)',
  'inbox.view': 'Inbox: просмотр',
  'inbox.manage': 'Inbox: ответы и настройки',
  'leads.view': 'Лиды: просмотр',
  'leads.manage': 'Лиды: изменение',
  'market.manage': 'Инсайты рынка',
  'insights.moderate': 'Модерация ИИ-инсайтов',
  'clients.review': 'Экспертная работа с клиентом: корректировка Точки Б, комментарии клиенту, кейсы',
} as const

export type Permission = keyof typeof PERMISSIONS
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

const CRM_MANAGER: Permission[] = [
  'dashboard.view', 'users.view', 'users.sensitive', 'users.manage', 'users.invite', 'users.approve',
  'company.edit', 'survey.view', 'survey.edit', 'gri.view', 'gri.edit',
  'activity.view', 'cjm.view', 'analytics.view',
  'impersonate.view', 'impersonate.edit',
  'inbox.view', 'inbox.manage', 'leads.view', 'leads.manage', 'market.manage', 'insights.moderate',
]

export const ROLE_PERMISSIONS: Record<StaffRole, ReadonlySet<Permission>> = {
  super_admin: new Set(ALL_PERMISSIONS),
  // Everything except managing staff roles, global system settings and the
  // irreversible purge of a user — those stay with Super Admin.
  admin: new Set(ALL_PERMISSIONS.filter((p) => p !== 'roles.manage' && p !== 'settings.manage' && p !== 'users.delete')),
  /**
   * SuperExpert — работа С ЛЮДЬМИ, но не с системой.
   *
   * Видит пользователей целиком (профиль, контакты, анкета, GRI, активность,
   * CJM), дополняет их данные (компания, анкета) и может открыть кабинет
   * клиента, чтобы разобраться на месте. Каждый такой вход ограничен по
   * времени и пишется в журнал (см. lib/impersonation), а тумблер
   * `super_expert_impersonation` в настройках платформы выключает его целиком.
   *
   * НЕ получает: системные настройки, роли, тарифы, блокировки, 2FA,
   * архивацию, удаление данных, правку GRI и журнал аудита — это остаётся
   * у Admin / Super Admin.
   */
  super_expert: new Set<Permission>([
    'dashboard.view', 'users.view', 'users.sensitive', 'users.invite', 'users.approve',
    'company.edit', 'survey.view', 'survey.edit', 'gri.view',
    'activity.view', 'cjm.view', 'analytics.view',
    'impersonate.view', 'impersonate.edit',
    'inbox.view', 'leads.view',
    'clients.review',
  ]),
  crm_manager: new Set(CRM_MANAGER),
  content_manager: new Set<Permission>([
    'dashboard.view', 'content.view', 'content.edit', 'content.publish', 'platform.sections', 'insights.moderate',
  ]),
  // Aggregates and journeys, but no personal contacts, answers or documents.
  analyst: new Set<Permission>([
    'dashboard.view', 'users.view', 'survey.view', 'gri.view', 'activity.view', 'cjm.view', 'analytics.view',
  ]),
  support: new Set<Permission>([
    'dashboard.view', 'users.view', 'users.sensitive', 'survey.view', 'gri.view', 'activity.view', 'cjm.view',
    'impersonate.view', 'inbox.view', 'leads.view',
  ]),
}

/**
 * Какие клиенты видны сотруднику.
 *
 * 'all'      — все клиенты платформы (по умолчанию);
 * 'assigned' — только те, где он ответственный (`user_assignments.assignee_id`).
 *
 * Хранится в `staff_roles.client_scope` (миграция 086) и переключается
 * администратором для конкретного эксперта. Руководящие роли и CRM-менеджер
 * всегда видят всех: им нужно распределять клиентов, а не только вести своих.
 */
export const CLIENT_SCOPES = ['all', 'assigned'] as const
export type ClientScope = (typeof CLIENT_SCOPES)[number]
const ALWAYS_ALL_SCOPE: ReadonlySet<StaffRole> = new Set<StaffRole>(['super_admin', 'admin', 'crm_manager'])

/** Итоговая область видимости для роли и значения из `staff_roles.client_scope`. */
export function effectiveClientScope(role: StaffRole, raw: unknown): ClientScope {
  if (ALWAYS_ALL_SCOPE.has(role)) return 'all'
  return raw === 'assigned' ? 'assigned' : 'all'
}

export function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v)
}

export function hasPermission(role: StaffRole | null | undefined, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].has(permission)
}

export function permissionsFor(role: StaffRole): Permission[] {
  return ALL_PERMISSIONS.filter((p) => ROLE_PERMISSIONS[role].has(p))
}

/** Higher number = more power. Used to stop staff acting on peers above them. */
const RANK: Record<StaffRole, number> = {
  super_admin: 100, admin: 80, super_expert: 60, crm_manager: 50, content_manager: 40, analyst: 30, support: 20,
}

/**
 * May `actor` manage (block, edit, impersonate, change role of) a user whose
 * staff role is `target`? Non-staff targets are always manageable. Staff can only
 * manage staff strictly below them; super_admins are managed by super_admins only
 * (and never impersonated — see canImpersonate).
 */
export function canManageTarget(actor: StaffRole, target: StaffRole | null | undefined): boolean {
  if (!target) return true
  if (actor === 'super_admin') return true
  return RANK[actor] > RANK[target]
}

/** Staff accounts are never impersonated: their cabinet is the admin panel. */
export function canImpersonate(actor: StaffRole, target: { staffRole: StaffRole | null; profileRole: string | null }): boolean {
  if (!hasPermission(actor, 'impersonate.view')) return false
  if (target.staffRole) return false
  if (target.profileRole === 'super_admin' || target.profileRole === 'admin') return false
  return true
}

/** Which roles may `actor` grant? Only roles strictly below its own (super_admin: any). */
export function grantableRoles(actor: StaffRole): StaffRole[] {
  if (!hasPermission(actor, 'roles.manage')) return []
  return STAFF_ROLES.filter((r) => actor === 'super_admin' || RANK[r] < RANK[actor])
}
