'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth.store'
import type { UserRole } from '@/shared/api/auth.service'

/**
 * Core auth hook. Initializes auth state on first mount.
 */
export function useAuth() {
  const store = useAuthStore()

  useEffect(() => {
    if (!store.isInitialized) {
      store.init()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return store
}

/**
 * Guards a page — redirects to login if not authenticated.
 * Optionally enforces a specific role.
 */
export function useRequireAuth(requiredRole?: UserRole) {
  const { user, role, isInitialized } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isInitialized) return

    if (!user) {
      router.replace('/login')
      return
    }

    if (requiredRole && role !== requiredRole) {
      // Redirect to correct panel
      router.replace(role === 'admin' ? '/dashboard' : '/expert/dashboard')
    }
  }, [user, role, isInitialized, requiredRole, router])

  return { user, role, isInitialized }
}

/**
 * Redirect away from auth pages if already logged in.
 */
export function useRedirectIfAuthed() {
  const { user, role, isInitialized } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isInitialized) return
    if (user) {
      router.replace(role === 'admin' ? '/dashboard' : '/expert/dashboard')
    }
  }, [user, role, isInitialized, router])

  return { isInitialized, isAuthed: !!user }
}
