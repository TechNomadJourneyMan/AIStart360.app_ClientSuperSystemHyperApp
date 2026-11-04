'use client'

import { WorkspaceShell } from '@/components/giga-panel/WorkspaceShell'
import { ViewAsBanner } from '@/components/giga-panel/dev-tools/ViewAsBanner'
import { SUPER_EXPERT_WORKSPACE } from '@/components/giga-panel/WorkspaceContext'

/**
 * Кабинет SuperExpert.
 *
 * Отдельный вход (/super-expert/login) и отдельное рабочее пространство, но
 * та же инфраструктура авторизации: сессия Supabase + роль из `staff_roles`.
 * Разделы платформы, роли, настройки и вход от имени сюда не попадают — их
 * нет ни в меню, ни в правах роли, и каждый API-маршрут проверяет право сам.
 */
export default function SuperExpertLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceShell workspace={SUPER_EXPERT_WORKSPACE}>
      {/* Режим «посмотреть как роль» (Dev-tools Super Admin): полоса с выходом. */}
      <ViewAsBanner />
      {children}
    </WorkspaceShell>
  )
}
