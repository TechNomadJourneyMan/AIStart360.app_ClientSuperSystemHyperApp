'use client'

/**
 * auth.store.ts
 * Supabase Auth-backed store — replaces the old localStorage + btoa implementation.
 * Session is managed by @supabase/ssr cookies; this store provides reactive UI state.
 */

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
    }
  },

  logout: async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    // Clear legacy cookies
    document.cookie = 'aistart360_role=; path=/; max-age=0'
    document.cookie = 'aistart360_user_id=; path=/; max-age=0'
    set({ user: null, role: null, error: null })
  },

  clearError: () => set({ error: null }),
}))
