/**
 * lib/client-shell/staff-links.ts — the «cabinet ↔ panel» buttons for staff
 * (PO 2026-10-22, п. 8).
 *
 *  - In the client cabinet a staff member sees «Вернуться в панель»: GIGA-CRM
 *    for GIGA staff, the SuperExpert cabinet for a SuperExpert, the expert
 *    portal for an expert.
 *  - In GIGA / SuperExpert / the expert portal they see «Открыть кабинет
 *    клиента (проверка)» → their OWN client cabinet (/client/home). It never
 *    opens another user's data: that stays the impersonation flow («от имени»).
 *
 * Pure: the role comes from the server (profiles.role + staff_roles, read for
 * the session user — lib/admin/giga-actor staffRoleOfUser / /api/giga-admin/me),
 * never from a client-side flag. A regular client gets null everywhere.
 */
import { isStaffRole } from '@/lib/admin/rbac'

export const CLIENT_CABINET_HREF = '/client/home'
export const CABINET_CHECK_LABEL = 'Открыть кабинет клиента (проверка)'
export const BACK_TO_PANEL_LABEL = 'Вернуться в панель'

export type StaffPanel = 'giga' | 'super_expert' | 'expert'

export interface PanelLink {
  panel: StaffPanel
  href: string
  label: string
  /** Which panel, for the tooltip / screen readers. */
  panelName: string
}

const PANELS: Record<StaffPanel, Omit<PanelLink, 'label'>> = {
  giga: { panel: 'giga', href: '/admin-giga-panel', panelName: 'GIGA-CRM' },
  super_expert: { panel: 'super_expert', href: '/super-expert', panelName: 'кабинет SuperExpert' },
  expert: { panel: 'expert', href: '/expert/dashboard', panelName: 'панель эксперта' },
}

/** profiles.role values that open the expert portal (middleware normalises manager/analyst to expert). */
const EXPERT_PROFILE_ROLES = new Set(['expert', 'admin', 'manager', 'analyst'])

export interface ViewerRoles {
  /** profiles.role */
  profileRole: string | null | undefined
  /** staff_roles.role (null when the user has no staff row). */
  staffRole: string | null | undefined
  /** profiles.status — only an approved account gets a panel link. */
  status: string | null | undefined
}

/**
 * The panel a staff member returns to from the client cabinet, or null for a
 * regular client (and for any account that is not approved).
 * Same landing rules as lib/role-landing.ts: a SuperExpert → /super-expert,
 * every other staff role (and a super_admin profile) → GIGA-CRM, an expert
 * (or a legacy admin profile without a staff row) → the expert portal.
 */
export function staffPanelLink(v: ViewerRoles): PanelLink | null {
  if (v.status !== 'approved') return null
  const staffRole = isStaffRole(v.staffRole) ? v.staffRole : null
  let panel: StaffPanel | null = null
  if (staffRole === 'super_expert') panel = 'super_expert'
  else if (staffRole || v.profileRole === 'super_admin') panel = 'giga'
  else if (v.profileRole && EXPERT_PROFILE_ROLES.has(v.profileRole)) panel = 'expert'
  return panel ? { ...PANELS[panel], label: BACK_TO_PANEL_LABEL } : null
}

export interface CabinetLink {
  href: string
  label: string
}

/**
 * The «check the client cabinet» button of GIGA / SuperExpert, from the
 * server-verified staff identity (/api/giga-admin/me). Only for a personal
 * session: a 'staff_cookie' actor is driving someone's cabinet right now
 * (impersonation), and /client/home would be that user's cabinet.
 */
export function gigaCabinetLink(me: { kind: 'session' | 'staff_cookie' } | null | undefined): CabinetLink | null {
  if (!me || me.kind !== 'session') return null
  return { href: CLIENT_CABINET_HREF, label: CABINET_CHECK_LABEL }
}

/** The same button in the expert portal: the viewer must hold an expert-portal role. */
export function expertCabinetLink(v: ViewerRoles): CabinetLink | null {
  return staffPanelLink(v) ? { href: CLIENT_CABINET_HREF, label: CABINET_CHECK_LABEL } : null
}
