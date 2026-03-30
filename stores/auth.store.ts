'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authService } from '@/shared/api/auth.service'
import { registerAction, loginAction } from '@/app/actions/auth'
import type { User, UserRole } from '@/shared/api/auth.service'

type PublicUser = Omit<User, 'password'>

interface AuthState {
  user: PublicUser | null
  role: UserRole | null
  isLoading: boolean
  isInitialized: boolean
  error: string | null

  // Actions
  login: (email: string, password: string) => Promise<void>
  register: (input: {
    name: string
    email: string
    password: string
    role?: UserRole
    organization?: string
    position?: string
  }) => Promise<void>
  logout: () => void
  init: () => Promise<void>
  clearError: () => void
}

const ERROR_MESSAGES: Record<string, string> = {
  USER_NOT_FOUND: 'Пользователь с таким email не найден',
  WRONG_PASSWORD: 'Неверный пароль',
  EMAIL_TAKEN: 'Этот email уже зарегистрирован',
  INVALID_SESSION: 'Сессия недействительна',
  SESSION_EXPIRED: 'Сессия истекла, войдите снова',
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      role: null,
      isLoading: false,
      isInitialized: false,
      error: null,

      init: async () => {
        authService.init() // seed demo users
        const session = authService.getSession()
        if (!session) {
          set({ isInitialized: true, user: null, role: null })
          return
        }
        try {
          const user = await authService.getCurrentUser()
          set({ user, role: user?.role ?? null, isInitialized: true })
        } catch {
          set({ user: null, role: null, isInitialized: true })
        }
      },

      login: async (email, password) => {
        set({ isLoading: true, error: null })
        try {
          const res = await loginAction(email, password)
          if (res.error) throw new Error(res.error)
          if (!res.user) throw new Error('UNKNOWN')

          set({ user: res.user as any, role: res.user.role as any, isLoading: false, error: null })
        } catch (err: unknown) {
          const code = err instanceof Error ? err.message : 'UNKNOWN'
          set({
            isLoading: false,
            error: ERROR_MESSAGES[code] ?? 'Произошла ошибка при входе',
          })
          throw err
        }
      },

      register: async (input) => {
        set({ isLoading: true, error: null })
        try {
          const res = await registerAction(input)
          if (res.error) throw new Error(res.error)
          if (!res.user) throw new Error('UNKNOWN')

          set({ user: res.user as any, role: res.user.role as any, isLoading: false, error: null })
        } catch (err: unknown) {
          const code = err instanceof Error ? err.message : 'UNKNOWN'
          set({
            isLoading: false,
            error: ERROR_MESSAGES[code] ?? 'Произошла ошибка при регистрации',
          })
          throw err
        }
      },

      logout: () => {
        authService.logout()
        set({ user: null, role: null, error: null })
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'aistart360_auth',
      // Only persist non-sensitive fields
      partialize: (state) => ({
        user: state.user,
        role: state.role,
      }),
    }
  )
)
