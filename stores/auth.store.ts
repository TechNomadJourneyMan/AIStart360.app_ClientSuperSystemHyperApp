'use client'

<<<<<<< HEAD
import { create } from 'zustand'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseEmailNotConfirmedError } from '@/lib/supabase/auth-errors'
import type { User, UserRole } from '@/shared/api/auth.service'
=======
/**
 * auth.store.ts
 * Supabase Auth-backed store — replaces the old localStorage + btoa implementation.
 * Session is managed by @supabase/ssr cookies; this store provides reactive UI state.
 */
>>>>>>> d630dab4408e61c7af1f66c27efffece5e21a813

import { create } from 'zustand'
import { createClient } from '@/lib/supabase/client'

export type UserRole = 'admin' | 'expert' | 'owner' | 'client' | 'super_admin'

export interface PublicUser {
  id:            string
  name:          string
  email:         string
  role:          UserRole | null
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

<<<<<<< HEAD
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
=======
  init:       () => Promise<void>
  logout:     () => Promise<void>
  clearError: () => void
}

const AUTH_ERRORS: Record<string, string> = {
  'Invalid login credentials': 'Неверный email или пароль',
  'Email not confirmed':       'Email не подтверждён. Проверьте почту',
  'Too many requests':         'Слишком много попыток. Подождите немного',
}

function supabaseUserToPublic(user: import('@supabase/supabase-js').User): PublicUser {
  const meta = user.user_metadata ?? {}
  return {
    id:           user.id.toString(),
    name:         meta.full_name ?? meta.name ?? user.email ?? '',
    email:        user.email ?? '',
    role:         (meta.role as UserRole) ?? null,
    organization: meta.organization,
    position:     meta.position,
    avatar:       meta.avatar_url ?? meta.picture,
    createdAt:    user.created_at,
    lastLogin:    user.last_sign_in_at,
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  user:          null,
  role:          null,
  isLoading:     false,
  isInitialized: false,
  error:         null,

  init: async () => {
    set({ isLoading: true })
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const publicUser = supabaseUserToPublic(user)
        set({ user: publicUser, role: publicUser.role, isInitialized: true, isLoading: false })
      } else {
        set({ user: null, role: null, isInitialized: true, isLoading: false })
      }
    } catch {
      set({ user: null, role: null, isInitialized: true, isLoading: false })
>>>>>>> d630dab4408e61c7af1f66c27efffece5e21a813
    }
  },

  logout: async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
<<<<<<< HEAD
    set({ user: null, role: null, error: null })
    if (typeof window !== 'undefined') {
      window.location.href = '/login'
    }
=======
    // Clear legacy cookies
    document.cookie = 'aistart360_role=; path=/; max-age=0'
    document.cookie = 'aistart360_user_id=; path=/; max-age=0'
    set({ user: null, role: null, error: null })
>>>>>>> d630dab4408e61c7af1f66c27efffece5e21a813
  },

  clearError: () => set({ error: null }),
}))
