'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { Permission, StaffRole } from '@/lib/admin/rbac'
import { useGigaQuery } from './kit'

export interface StaffMe {
  id: string
  kind: 'session' | 'staff_cookie' | 'break_glass'
  email: string | null
  role: StaffRole
  roleLabel: string
  permissions: Permission[]
}

interface Ctx { me: StaffMe | null; loading: boolean; error: string | null; can: (p: Permission) => boolean }

const StaffCtx = createContext<Ctx>({ me: null, loading: true, error: null, can: () => false })

export function StaffProvider({ children }: { children: ReactNode }) {
  const { data, loading, error } = useGigaQuery<{ data: StaffMe }>('/api/giga-admin/me')
  const me = data?.data ?? null
  const perms = new Set(me?.permissions ?? [])
  return (
    <StaffCtx.Provider value={{ me, loading, error: error?.message ?? null, can: (p) => perms.has(p) }}>
      {children}
    </StaffCtx.Provider>
  )
}

export function useStaff(): Ctx {
  return useContext(StaffCtx)
}

/** Renders children only when the actor holds `permission`; shows a notice otherwise. */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can, loading } = useStaff()
  if (loading) return null
  if (!can(permission)) {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-5 py-8 text-center">
        <p className="text-sm font-semibold text-amber-200">Раздел недоступен для вашей роли</p>
        <p className="mt-1 text-xs text-slate-500">Обратитесь к Super Admin, если доступ нужен для работы.</p>
      </div>
    )
  }
  return <>{children}</>
}
