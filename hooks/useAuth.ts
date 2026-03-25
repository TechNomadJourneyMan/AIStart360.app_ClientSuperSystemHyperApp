'use client'

// Placeholder auth hook — заменить на реальный NextAuth useSession()
// import { useSession } from 'next-auth/react'

import type { User, UserRole } from '@/types'

// Mock current user
const MOCK_USER: User = {
  id: 'u1',
  email: 'adil@aistart360.com',
  name: 'Adil Ansari',
  role: 'MANAGER',
  orgId: 'org1',
  createdAt: '2024-01-01',
}

export function useAuth() {
  // TODO: replace with:
  // const { data: session, status } = useSession()
  // return {
  //   user: session?.user as User | null,
  //   role: session?.user?.role as UserRole,
  //   isLoading: status === 'loading',
  //   isAuthenticated: status === 'authenticated',
  // }

  return {
    user: MOCK_USER,
    role: MOCK_USER.role as UserRole,
    isLoading: false,
    isAuthenticated: true,
  }
}

export function useIsRole(...roles: UserRole[]): boolean {
  const { role } = useAuth()
  return roles.includes(role)
}
