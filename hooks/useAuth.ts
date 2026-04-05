'use client'

import { useAuthStore } from '@/stores/auth.store'
import type { UserRole } from '@/types'

export function useAuth() {
  const { user, role, isLoading, isInitialized } = useAuthStore()

  return {
    user,
    role: (role?.toUpperCase() ?? null) as UserRole | null,
    isLoading,
    isAuthenticated: Boolean(user),
    isInitialized,
  }
}

export function useIsRole(...roles: UserRole[]): boolean {
  const { role } = useAuth()
  return role ? roles.includes(role) : false
}
