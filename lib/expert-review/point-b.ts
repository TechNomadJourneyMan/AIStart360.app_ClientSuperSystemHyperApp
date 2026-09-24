/**
 * lib/expert-review/point-b.ts — ревью экспертной Точки Б (аудит 03, К-6 / E11).
 *
 * Экспертная версия Точки Б сохраняется неодобренной; одобряет её сотрудник
 * рангом выше SuperExpert — Admin или Super Admin. Пока версия не одобрена,
 * клиентский API (/api/v1/diagnostics/point-b) и RLS её не показывают.
 */

import type { StaffRole } from '@/lib/admin/rbac'

export const POINT_B_APPROVER_ROLES: readonly StaffRole[] = ['super_admin', 'admin']

export function canApprovePointB(role: StaffRole | null | undefined): boolean {
  return !!role && POINT_B_APPROVER_ROLES.includes(role)
}

export const POINT_B_VERSION_COLUMNS =
  'id, diagnostic_id, authored_by, author_name, expert_notes, roadmap, is_approved, approved_by, approved_at, created_at'
