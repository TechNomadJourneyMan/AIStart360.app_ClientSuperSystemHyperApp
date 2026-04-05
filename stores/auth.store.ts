'use client'

import { create } from 'zustand'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseEmailNotConfirmedError } from '@/lib/supabase/auth-errors'

/**
 * auth.store.ts
 * Supabase Auth-backed store — replaces the old localStorage + btoa implementation.
 * Session is managed by @supabase/ssr cookies; this store provides reactive UI state.
 */

export type UserRole = 'admin' | 'expert' | 'owner' | 'client' | 'super_admin'
export type UserStatus = 'pending_approval' | 'approved' | 'rejected'

export interface PublicUser {
  id:            string
  name:          string
  email:         string
  role:          UserRole | null
  status?:       UserStatus
  organization?: string
  position?:     string
  avatar?:       string
  createdAt?:    string
  lastLogin?:    string
}

interface AuthState {
  user:          PublicUser | null
  role:          UserRole | null
  isLoading:     boolean
  isInitialized: boolean
  error:         string | null

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
    .select('full_name, role, organization, position, status')
    .eq('id', user.id)
    .maybeSingle()

  const fullName =
    typeof profileRes.data?.full_name === 'string'
      ? profileRes.data.full_name
      : typeof user.user_metadata?.full_name === 'string'
        ? user.user_metadata.full_name
        : (user.user_metadata?.name as string) ?? 'Пользователь'

  const role = normalizeRole(
    typeof profileRes.data?.role === 'string'
      ? profileRes.data.role
      : typeof user.user_metadata?.role === 'string'
        ? user.user_metadata.role
        : null,
  )

  const status = (profileRes.data?.status as UserStatus)
    || (user.user_metadata?.status as UserStatus)
    || 'approved'

  return {
    id: user.id,
    email: user.email ?? '',
    name: fullName,
    role,
    status,
    createdAt: user.created_at ?? new Date().toISOString(),
    organization: typeof profileRes.data?.organization === 'string' ? profileRes.data.organization : (user.user_metadata?.organization as string),
    position: typeof profileRes.data?.position === 'string' ? profileRes.data.position : (user.user_metadata?.position as string),
    avatar: (user.user_metadata?.avatar_url as string) ?? (user.user_metadata?.picture as string),
    lastLogin: (user as any).last_sign_in_at,
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
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        set({ user: null, role: null, isInitialized: true })
        return
      }

      const appUser = await buildUserFromSession(user)
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

      // Use server-side admin API to create user with email_confirm: true
      // This bypasses Supabase email verification entirely (no email sent)
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          name: input.name,
          role: input.role ?? 'client',
          organization: input.organization,
          position: input.position,
        }),
      })

      const json = await res.json()
      if (!res.ok) {
        if (json.error === 'EMAIL_TAKEN') throw new Error('EMAIL_TAKEN')
        throw new Error(json.error ?? 'UNKNOWN')
      }

      // Sign in immediately — email is already confirmed
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: input.email,
        password: input.password,
      })

      if (signInError) throw new Error(signInError.message)
      if (!signInData.user) throw new Error('UNKNOWN')

      const appUser = await buildUserFromSession(signInData.user)
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
    
    // Clear legacy cookies
    if (typeof document !== 'undefined') {
      document.cookie = 'aistart360_role=; path=/; max-age=0'
      document.cookie = 'aistart360_user_id=; path=/; max-age=0'
    }

    set({ user: null, role: null, error: null })
    if (typeof window !== 'undefined') {
      window.location.href = '/login'
    }
  },

  clearError: () => set({ error: null }),
}))
