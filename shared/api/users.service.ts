/**
 * users.service.ts
 * Frontend-only users data layer.
 * Mirrors a REST API — replace method bodies with fetch() calls when backend is ready.
 */

import type { User } from './auth.service'

const USERS_KEY = 'aistart360_users'

function isBrowser() { return typeof window !== 'undefined' }

function getUsers(): User[] {
  if (!isBrowser()) return []
  try {
    const raw = localStorage.getItem(USERS_KEY)
    return raw ? (JSON.parse(raw) as User[]) : []
  } catch { return [] }
}

function saveUsers(users: User[]): void {
  if (!isBrowser()) return
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

function stripPassword(user: User): Omit<User, 'password'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password: _, ...safe } = user
  return safe
}

function simulateLatency(ms = 300) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

export type PublicUser = Omit<User, 'password'>

export const usersService = {
  /** GET /users */
  async getAll(): Promise<PublicUser[]> {
    await simulateLatency(350)
    return getUsers().map(stripPassword)
  },

  /** GET /users?role=admin|expert */
  async getByRole(role: 'admin' | 'expert'): Promise<PublicUser[]> {
    await simulateLatency(300)
    return getUsers().filter((u) => u.role === role).map(stripPassword)
  },

  /** GET /users/:id */
  async getById(id: string): Promise<PublicUser | null> {
    await simulateLatency(200)
    const user = getUsers().find((u) => u.id === id)
    return user ? stripPassword(user) : null
  },

  /** PATCH /users/:id */
  async update(id: string, patch: Partial<Omit<User, 'id' | 'password'>>): Promise<PublicUser> {
    await simulateLatency(400)
    const users = getUsers()
    const idx = users.findIndex((u) => u.id === id)
    if (idx === -1) throw new Error('USER_NOT_FOUND')
    users[idx] = { ...users[idx], ...patch }
    saveUsers(users)
    return stripPassword(users[idx])
  },

  /** DELETE /users/:id */
  async delete(id: string): Promise<void> {
    await simulateLatency(300)
    saveUsers(getUsers().filter((u) => u.id !== id))
  },

  /** Stats for admin dashboard */
  async getStats(): Promise<{
    total: number
    admins: number
    experts: number
    activeToday: number
  }> {
    await simulateLatency(250)
    const users = getUsers()
    const today = new Date().toDateString()
    return {
      total: users.length,
      admins: users.filter((u) => u.role === 'admin').length,
      experts: users.filter((u) => u.role === 'expert').length,
      activeToday: users.filter((u) => u.lastLogin && new Date(u.lastLogin).toDateString() === today).length,
    }
  },
}
