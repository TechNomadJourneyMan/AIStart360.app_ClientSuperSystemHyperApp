'use client'

import { create } from 'zustand'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseEmailNotConfirmedError } from '@/lib/supabase/auth-errors'
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
  logout: () => Promise<void>
  init: () => Promise<void>
  clearError: () => void
}

const ERROR_MESSAGES: Record<string, string> = {
  USER_NOT_FOUND: 'Пользователь с таким email не найден',
  WRONG_PASSWORD: 'Неверный пароль',
  EMAIL_NOT_CONFIRMED: 'Email не подтверждён',
  EMAIL_TAKEN: 'Этот email уже зарегистрирован',
  INVALID_SESSION: 'Сессия недействительна',
  SESSION_EXPIRED: 'Сессия истекла, войдите снова',
}

async function confirmEmailForDev(email: string): Promise<void> {
  const response = await fetch('/api/dev/confirm-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? 'EMAIL_NOT_CONFIRMED')
  }
}

function normalizeRole(role: string | null | undefined): UserRole {
  if (role === 'super_admin' || role === 'admin' || role === 'expert' || role === 'owner' || role === 'client') {
    return role
  }
  if (role === 'manager' || role === 'analyst') {
    return 'expert'
  }
  return 'client'
}

async function buildUserFromSession(user: {
  id: string
  email?: string
  created_at?: string
  user_metadata?: Record<string, unknown>
}) {
  const supabase = createClient()
  const profileRes = await supabase
    .from('profiles')
    .select('full_name, role, organization, position')
    .eq('id', user.id)
    .maybeSingle()

  const fullName =
    typeof profileRes.data?.full_name === 'string'
      ? profileRes.data.full_name
      : typeof user.user_metadata?.full_name === 'string'
        ? user.user_metadata.full_name
        : 'Пользователь'

  const role = normalizeRole(
    typeof profileRes.data?.role === 'string'
      ? profileRes.data.role
      : typeof user.user_metadata?.role === 'string'
        ? user.user_metadata.role
        : null,
  )

  return {
    id: user.id,
    email: user.email ?? '',
    name: fullName,
    role,
    createdAt: user.created_at ?? new Date().toISOString(),
    organization: typeof profileRes.data?.organization === 'string' ? profileRes.data.organization : undefined,
    position: typeof profileRes.data?.position === 'string' ? profileRes.data.position : undefined,
  } satisfies PublicUser
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  role: null,
  isLoading: false,
  isInitialized: false,
  error: null,

  init: async () => {
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        set({ user: null, role: null, isInitialized: true })
        return
      }

      const appUser = await buildUserFromSession(session.user)
      set({ user: appUser, role: appUser.role, isInitialized: true })
    } catch {
      set({ user: null, role: null, isInitialized: true })
    }
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const supabase = createClient()
      const signIn = async () => supabase.auth.signInWithPassword({ email, password })
      let { data, error } = await signIn()

      if (error && isSupabaseEmailNotConfirmedError(error.message) && process.env.NODE_ENV !== 'production') {
        await confirmEmailForDev(email)
        const retry = await signIn()
        data = retry.data
        error = retry.error
      }

      if (error) {
        if (isSupabaseEmailNotConfirmedError(error.message)) {
          throw new Error('EMAIL_NOT_CONFIRMED')
        }
        if (error.message.toLowerCase().includes('invalid login credentials')) {
          throw new Error('WRONG_PASSWORD')
        }
        throw new Error(error.message)
      }
      if (!data.user) throw new Error('USER_NOT_FOUND')

      const appUser = await buildUserFromSession(data.user)
      set({ user: appUser, role: appUser.role, isLoading: false, error: null })
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : 'UNKNOWN'
      set({
        isLoading: false,
        error: ERROR_MESSAGES[code] ?? (code || 'Произошла ошибка при входе'),
      })
      throw err
    }
  },

  register: async (input) => {
    set({ isLoading: true, error: null })
    try {
      const supabase = createClient()
      const { data, error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            full_name: input.name,
            role: input.role ?? 'expert',
            organization: input.organization,
            position: input.position,
          },
        },
      })

      if (error) {
        if (error.message.toLowerCase().includes('already registered')) {
          throw new Error('EMAIL_TAKEN')
        }
        throw new Error(error.message)
      }
      if (!data.user) throw new Error('UNKNOWN')

      const appUser = await buildUserFromSession(data.user)
      set({ user: appUser, role: appUser.role, isLoading: false, error: null })
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : 'UNKNOWN'
      set({
        isLoading: false,
        error: ERROR_MESSAGES[code] ?? (code || 'Произошла ошибка при регистрации'),
      })
      throw err
    }
  },

  logout: async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    set({ user: null, role: null, error: null })
    if (typeof window !== 'undefined') {
      window.location.href = '/login'
    }
  },

  clearError: () => set({ error: null }),
}))
