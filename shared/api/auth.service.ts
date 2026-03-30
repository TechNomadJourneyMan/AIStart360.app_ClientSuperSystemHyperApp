/**
 * auth.service.ts
 * LEGACY: This file previously contained a localStorage-based auth layer
 * with btoa/atob password encoding. All auth now goes through Server Actions
 * (app/actions/auth.ts) + Prisma + bcrypt + httpOnly cookies.
 *
 * This file is kept as a type-only export for backward compatibility.
 * Full removal is planned for Sprint 2.
 */

export type UserRole = 'admin' | 'expert' | 'owner' | 'client' | 'super_admin'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  createdAt: string
  lastLogin?: string
  avatar?: string
  organization?: string
  position?: string
}

export type AuthError =
  | 'USER_NOT_FOUND'
  | 'WRONG_PASSWORD'
  | 'EMAIL_TAKEN'
  | 'INVALID_SESSION'
  | 'SESSION_EXPIRED'
