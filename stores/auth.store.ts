'use client'

import { create } from 'zustand'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseEmailNotConfirmedError } from '@/lib/supabase/auth-errors'
import { safeInternalPath } from '@/lib/safe-redirect'
import type { UserRole } from '@/types'

/**
 * auth.store.ts
 * Supabase Auth-backed store — replaces the old localStorage + btoa implementation.
 * Session is managed by @supabase/ssr cookies; this store provides reactive UI state.
 */

// FE-01: single canonical UserRole lives in @/types; re-export for existing
// consumers that import it from this store.
export type { UserRole }
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
  loginWithGoogle: (redirectPath?: string) => Promise<void>
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

export const useAuthStore = create<AuthState>()((set, get) => ({
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

  loginWithGoogle: async (redirectPath) => {
    set({ isLoading: true, error: null })
    try {
      const supabase = createClient()
      const next = safeInternalPath(redirectPath, '/dashboard')
      const callbackUrl = new URL('/auth/callback', window.location.origin)
      callbackUrl.searchParams.set('next', next)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl.toString(),
        },
      })
      if (error) throw new Error(error.message)
      // Redirect happens automatically — Supabase opens Google consent screen
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка входа через Google'
      set({ isLoading: false, error: msg })
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

      // Sign in immediately — email is already confirmed via admin API
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

    // ── Demo-session cleanup ────────────────────────────────────────────
    // If the current session was created via /api/auth/demo-access we mark
    // the user with user_metadata.demo === true. On logout we ask the
    // server to delete that auth.users row so the account doesn't outlive
    // its single session. Best-effort: never block logout on failure.
    if (typeof window !== 'undefined') {
      const demoUserId = sessionStorage.getItem('aistart360_demo_user_id')
      if (demoUserId) {
        try {
          await fetch('/api/auth/demo-access/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: demoUserId }),
            keepalive: true,
          })
        } catch {
          // ignore — daily cron sweep would still catch stale demo users
        }
        sessionStorage.removeItem('aistart360_demo_user_id')
        sessionStorage.removeItem('aistart360_demo_pending')
      }
    }

    await supabase.auth.signOut()

    // Clear legacy cookies
    if (typeof document !== 'undefined') {
      document.cookie = 'aistart360_role=; path=/; max-age=0'
      document.cookie = 'aistart360_user_id=; path=/; max-age=0'
    }

    // Wipe local caches so the next user on a shared device can't see the
    // previous user's data: react-query persist blob + the service-worker
    // 'apis'/'images' caches. Audit 2026-07-02.
    if (typeof window !== 'undefined') {
      try { window.localStorage.removeItem('aistart360_rq_cache') } catch {}
      if ('caches' in window) {
        try {
          const keys = await caches.keys()
          await Promise.all(keys.map((k) => caches.delete(k)))
        } catch {}
      }
    }

    set({ user: null, role: null, error: null })
    if (typeof window !== 'undefined') {
      window.location.href = '/login'
    }
  },

  clearError: () => set({ error: null }),
}))
