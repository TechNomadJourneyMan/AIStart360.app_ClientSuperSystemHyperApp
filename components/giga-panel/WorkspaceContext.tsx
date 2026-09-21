'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { GIGA_BASE, GIGA_NAV, SUPER_EXPERT_BASE, SUPER_EXPERT_NAV, type GigaNavGroup } from '@/lib/admin/nav'

/**
 * Рабочее пространство, в котором отрисован экран панели.
 *
 * Экраны (пользователи, анкеты, GRI, активность…) одни и те же для GIGA-CRM и
 * для кабинета SuperExpert — отличаются только базовый путь, навигация и
 * подпись. Поэтому страницы берут `base` отсюда, а не зашивают
 * '/admin-giga-panel' в ссылки: иначе кабинет SuperExpert уводил бы человека
 * в админскую панель, куда у него нет доступа.
 */
export interface Workspace {
  /** Базовый путь кабинета: '/admin-giga-panel' или '/super-expert'. */
  base: string
  /** Подпись в хлебных крошках и в шапке боковой панели. */
  label: string
  sublabel: string
  nav: GigaNavGroup[]
  /** Куда уходит человек после выхода из кабинета. */
  loginPath: string
}

export const GIGA_WORKSPACE: Workspace = {
  base: GIGA_BASE,
  label: 'GIGA-CRM',
  sublabel: 'Platform Control Center',
  nav: GIGA_NAV,
  loginPath: '/giga-login',
}

export const SUPER_EXPERT_WORKSPACE: Workspace = {
  base: SUPER_EXPERT_BASE,
  label: 'SuperExpert',
  sublabel: 'Работа с пользователями',
  nav: SUPER_EXPERT_NAV,
  loginPath: '/super-expert/login',
}

const WorkspaceCtx = createContext<Workspace>(GIGA_WORKSPACE)

export function WorkspaceProvider({ workspace, children }: { workspace: Workspace; children: ReactNode }) {
  return <WorkspaceCtx.Provider value={workspace}>{children}</WorkspaceCtx.Provider>
}

export function useWorkspace(): Workspace {
  return useContext(WorkspaceCtx)
}
