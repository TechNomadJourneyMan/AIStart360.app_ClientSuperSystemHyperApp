/**
 * auth.service.ts
 * Frontend-only authentication layer backed by localStorage.
 * Designed as a drop-in replacement for a real REST API client.
 * When a real backend is connected, replace method bodies with fetch() calls.
 */

export type UserRole = 'admin' | 'expert' | 'owner'

export interface User {
  id: string
  name: string
  email: string
  password: string   // stored hashed (btoa) — NOT real security, demo only
  role: UserRole
  createdAt: string
  lastLogin?: string
  avatar?: string
  organization?: string
  position?: string
}

export interface Session {
  userId: string
  role: UserRole
  token: string       // pseudo-JWT: base64(userId + role + exp)
  expiresAt: number   // Unix ms
}

export interface AuthResult {
  user: Omit<User, 'password'>
  session: Session
}

export type AuthError =
  | 'USER_NOT_FOUND'
  | 'WRONG_PASSWORD'
  | 'EMAIL_TAKEN'
  | 'INVALID_SESSION'
  | 'SESSION_EXPIRED'

const USERS_KEY    = 'aistart360_users'
const SESSION_KEY  = 'aistart360_session'
const SESSION_TTL  = 7 * 24 * 60 * 60 * 1000 // 7 days

// ─── seed data ────────────────────────────────────────────────────────────────
const SEED_USERS: User[] = [
  {
    id: 'usr_admin_001',
    name: 'Адиль Ансари',
    email: 'admin@aistart360.kz',
    password: btoa('admin123'),
    role: 'admin',
    organization: 'AIStart360 Ltd.',
    position: 'CEO / Platform Admin',
    createdAt: '2025-01-01T00:00:00Z',
    lastLogin: '2026-03-25T08:00:00Z',
  },
  {
    id: 'usr_admin_002',
    name: 'Алекс Ким',
    email: 'alex@aistart360.kz',
    password: btoa('manager123'),
    role: 'admin',
    organization: 'AIStart360 Ltd.',
    position: 'Senior Manager',
    createdAt: '2025-02-10T00:00:00Z',
    lastLogin: '2026-03-24T14:30:00Z',
  },
  {
    id: 'usr_expert_001',
    name: 'Сара Чен',
    email: 'expert@aistart360.kz',
    password: btoa('expert123'),
    role: 'expert',
    organization: 'Vortex Labs',
    position: 'Growth Expert',
    createdAt: '2025-03-01T00:00:00Z',
    lastLogin: '2026-03-25T09:00:00Z',
  },
  {
    id: 'usr_expert_002',
    name: 'Мария Лопес',
    email: 'maria@aistart360.kz',
    password: btoa('maria123'),
    role: 'expert',
    organization: 'Nexum Systems',
    position: 'Business Analyst',
    createdAt: '2025-04-15T00:00:00Z',
    lastLogin: '2026-03-23T11:00:00Z',
  },
  {
    id: 'usr_expert_003',
    name: 'Джеймс Парк',
    email: 'james@aistart360.kz',
    password: btoa('james123'),
    role: 'expert',
    organization: 'Calyx Digital',
    position: 'Senior Analyst',
    createdAt: '2025-05-20T00:00:00Z',
    lastLogin: '2026-03-22T16:45:00Z',
  },
  {
    id: 'usr_owner_001',
    name: 'Марина Рахимжанова',
    email: 'owner@aistart360.kz',
    password: btoa('owner123'),
    role: 'owner',
    organization: 'TechStart KZ',
    position: 'Собственник',
    createdAt: '2025-09-01T00:00:00Z',
    lastLogin: '2026-03-25T10:00:00Z',
  },
]

// ─── helpers ──────────────────────────────────────────────────────────────────

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function getUsers(): User[] {
  if (!isBrowser()) return []
  try {
    const raw = localStorage.getItem(USERS_KEY)
    return raw ? (JSON.parse(raw) as User[]) : []
  } catch {
    return []
  }
}

function saveUsers(users: User[]): void {
  if (!isBrowser()) return
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

function generateToken(userId: string, role: UserRole): string {
  return btoa(`${userId}:${role}:${Date.now()}`)
}

function stripPassword(user: User): Omit<User, 'password'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password: _, ...safe } = user
  return safe
}

function simulateLatency(ms = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── public API ───────────────────────────────────────────────────────────────

export const authService = {
  /**
   * Initialize seed data if localStorage is empty.
   * Call once on app mount.
   */
  init(): void {
    if (!isBrowser()) return
    const existing = getUsers()
    if (existing.length === 0) {
      saveUsers(SEED_USERS)
      return
    }
    // Merge any seed users not yet in localStorage (handles new accounts added after first init)
    const existingIds = new Set(existing.map((u) => u.id))
    const missing = SEED_USERS.filter((u) => !existingIds.has(u.id))
    if (missing.length > 0) {
      saveUsers([...existing, ...missing])
    }
  },

  /**
   * Register a new user.
   */
  async register(input: {
    name: string
    email: string
    password: string
    role?: UserRole
    organization?: string
    position?: string
  }): Promise<AuthResult> {
    await simulateLatency(400)

    const users = getUsers()
    const emailLower = input.email.toLowerCase().trim()

    if (users.some((u) => u.email.toLowerCase() === emailLower)) {
      throw new Error('EMAIL_TAKEN' satisfies AuthError)
    }

    const newUser: User = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: input.name.trim(),
      email: emailLower,
      password: btoa(input.password),
      role: input.role ?? 'expert',
      organization: input.organization,
      position: input.position,
      createdAt: new Date().toISOString(),
    }

    saveUsers([...users, newUser])

    const session = authService._createSession(newUser)
    return { user: stripPassword(newUser), session }
  },

  /**
   * Log in with email + password.
   */
  async login(email: string, password: string): Promise<AuthResult> {
    await simulateLatency(500)

    const users = getUsers()
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase().trim())

    if (!user) throw new Error('USER_NOT_FOUND' satisfies AuthError)
    if (user.password !== btoa(password)) throw new Error('WRONG_PASSWORD' satisfies AuthError)

    // Update lastLogin
    const updated = users.map((u) =>
      u.id === user.id ? { ...u, lastLogin: new Date().toISOString() } : u
    )
    saveUsers(updated)

    const session = authService._createSession(user)
    return { user: stripPassword(user), session }
  },

  /**
   * Log out current session.
   */
  logout(): void {
    if (!isBrowser()) return
    localStorage.removeItem(SESSION_KEY)
  },

  /**
   * Get current session data (without network call).
   */
  getSession(): Session | null {
    if (!isBrowser()) return null
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (!raw) return null
      const session = JSON.parse(raw) as Session
      if (Date.now() > session.expiresAt) {
        localStorage.removeItem(SESSION_KEY)
        return null
      }
      return session
    } catch {
      return null
    }
  },

  /**
   * Get the current logged-in user (stripped of password).
   */
  async getCurrentUser(): Promise<Omit<User, 'password'> | null> {
    await simulateLatency(200)
    const session = authService.getSession()
    if (!session) return null

    const users = getUsers()
    const user = users.find((u) => u.id === session.userId)
    return user ? stripPassword(user) : null
  },

  /**
   * Check if user is authenticated (sync, no latency).
   */
  isAuthenticated(): boolean {
    return authService.getSession() !== null
  },

  /**
   * Internal: create and persist session.
   */
  _createSession(user: User): Session {
    const session: Session = {
      userId: user.id,
      role: user.role,
      token: generateToken(user.id, user.role),
      expiresAt: Date.now() + SESSION_TTL,
    }
    if (isBrowser()) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    }
    return session
  },
}
