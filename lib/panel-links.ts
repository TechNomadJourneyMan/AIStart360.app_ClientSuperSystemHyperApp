import { isStaffRole } from '@/lib/admin/rbac'

/**
 * Кнопки перехода между рабочими кабинетами: «Админ-панель», «Панель эксперта»
 * и обратно «Мой кабинет».
 *
 * Правила повторяют проверки middleware.ts — кнопка появляется только там, куда
 * middleware человека действительно пустит, иначе это была бы мёртвая ссылка:
 *   • ГИГА-Панель (/admin-giga-panel): super_admin по profiles.role (одобренный)
 *     или любая роль из staff_roles, кроме super_expert — его рабочее место
 *     кабинет SuperExpert;
 *   • кабинет SuperExpert (/super-expert): одобренный super_admin или роль из
 *     staff_roles из SUPER_EXPERT_PANEL_ROLES;
 *   • эксперт по profiles.role ('expert') без доступа к /super-expert — свой
 *     кабинет эксперта /expert/dashboard.
 * Обычный клиент не получает ни одной ссылки.
 *
 * Сервер всё равно проверяет доступ на каждом маршруте; здесь — только видимость.
 */

/** Роли staff_roles, которым открыт кабинет SuperExpert (общие с middleware). */
export const SUPER_EXPERT_PANEL_ROLES: readonly string[] = ['super_admin', 'admin', 'super_expert', 'crm_manager']

export const GIGA_PANEL_HREF = '/admin-giga-panel'
export const SUPER_EXPERT_PANEL_HREF = '/super-expert'
export const EXPERT_CABINET_HREF = '/expert/dashboard'
/** Личный кабинет пользователя (анкета, GRI) — общий для всех ролей. */
export const MY_CABINET_HREF = '/client/home'

export type PanelLinkKey = 'giga' | 'super_expert' | 'expert'

export interface PanelLink {
  key: PanelLinkKey
  href: string
  label: string
  /** Имя иконки Material Symbols (клиентский кабинет). */
  icon: string
}

export interface PanelLinksInput {
  /** profiles.role */
  role?: string | null
  /** staff_roles.role, если есть. */
  staffRole?: string | null
  /** profiles.status; не передан — считается одобренным. */
  status?: string | null
}

export function panelLinksFor({ role, staffRole, status }: PanelLinksInput): PanelLink[] {
  const approved = status == null || status === 'approved'
  const staff = isStaffRole(staffRole) ? staffRole : null
  const superAdmin = role === 'super_admin' && approved

  const giga = superAdmin || (staff !== null && staff !== 'super_expert')
  const superExpert = superAdmin || (staff !== null && approved && SUPER_EXPERT_PANEL_ROLES.includes(staff))

  const links: PanelLink[] = []
  if (giga) links.push({ key: 'giga', href: GIGA_PANEL_HREF, label: 'Админ-панель', icon: 'admin_panel_settings' })
  if (superExpert) {
    links.push({ key: 'super_expert', href: SUPER_EXPERT_PANEL_HREF, label: 'Панель эксперта', icon: 'support_agent' })
  } else if (role === 'expert') {
    links.push({ key: 'expert', href: EXPERT_CABINET_HREF, label: 'Панель эксперта', icon: 'support_agent' })
  }
  return links
}

/** Может ли человек открыть ГИГА-Панель (ссылки «Пользователи», «Заявки» и т. п.). */
export function hasGigaPanelAccess(input: PanelLinksInput): boolean {
  return panelLinksFor(input).some((l) => l.key === 'giga')
}
