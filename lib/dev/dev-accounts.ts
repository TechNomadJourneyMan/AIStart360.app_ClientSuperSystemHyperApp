/**
 * lib/dev/dev-accounts.ts — one developer account per role, created on first
 * use by the localhost developer login (app/api/dev/login). Node only.
 *
 * Local development talks to a real Supabase project, so these are real
 * accounts in whatever database `.env.local` points at. Their addresses use
 * the reserved `.test` domain: no letter can ever reach them.
 *
 * Callers must have passed the guard in lib/dev/dev-access.ts — nothing here
 * checks it again.
 */
import { randomBytes } from 'node:crypto'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { StaffRole } from '@/lib/admin/rbac'

export const DEV_ROLES = ['client', 'expert', 'super_expert', 'admin', 'super_admin', 'crm_manager', 'content_manager', 'analyst', 'support'] as const
export type DevRole = (typeof DEV_ROLES)[number]

export const DEV_ROLE_LABELS: Record<DevRole, string> = {
  client: 'Клиент',
  expert: 'Эксперт',
  super_expert: 'Супер-эксперт',
  admin: 'Админ',
  super_admin: 'Супер-админ',
  crm_manager: 'CRM-менеджер',
  content_manager: 'Контент-менеджер',
  analyst: 'Аналитик',
  support: 'Поддержка',
}

export function devEmail(role: DevRole): string {
  return `dev-${role.replace(/_/g, '-')}@dev.aistart360.test`
}

type ProfileRole = 'client' | 'expert' | 'admin' | 'super_admin'

/**
 * How a role is stored: `profiles.role` routes a person to a cabinet,
 * `staff_roles.role` grants the GIGA-CRM permissions (lib/admin/rbac.ts).
 * Staff other than admin / super_admin keep the profile role 'client'.
 */
export function devAccountShape(role: DevRole): { profileRole: ProfileRole; staffRole: StaffRole | null } {
  switch (role) {
    case 'client':
    case 'expert':
      return { profileRole: role, staffRole: null }
    case 'admin':
    case 'super_admin':
      return { profileRole: role, staffRole: role }
    default:
      return { profileRole: 'client', staffRole: role }
  }
}

export type DevAccountErrorCode =
  | 'DEV_ACCOUNT_CONFLICT'
  | 'DEV_ACCOUNT_CREATE_FAILED'
  | 'DEV_ACCOUNT_WRITE_FAILED'
  | 'DEV_LOOKUP_FAILED'

/** A failure with a stable code for the panel; the detail is for the server log. */
export class DevAccountError extends Error {
  readonly code: DevAccountErrorCode

  constructor(code: DevAccountErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'DevAccountError'
    this.code = code
  }
}

/**
 * Marks an account the developer login created. It lives in app_metadata,
 * which only the service role can write: `user_metadata.dev_account` is for
 * people reading the user list, and a user can set it on their own account.
 */
const DEV_ACCOUNT_MARKER = 'dev_account'

/** LIKE treats `%` and `_` as wildcards and `\` as the escape character. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/**
 * The auth user registered under `email`, or null.
 *
 * The installed Auth admin API can only page through all users, so the
 * candidate comes from `profiles` (every account has a row with its address)
 * and is then confirmed against Auth itself: a profile that kept an old
 * address must not pass for the account that now owns another one.
 */
export async function findAuthUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const wanted = email.trim().toLowerCase()
  if (!wanted) return null
  const { data, error } = await admin.from('profiles').select('id, email').ilike('email', escapeLike(wanted)).limit(5)
  if (error) throw new DevAccountError('DEV_LOOKUP_FAILED', error.message)

  for (const row of (data ?? []) as Array<{ id: string; email: string | null }>) {
    if (row.email?.toLowerCase() !== wanted) continue
    const found = await admin.auth.admin.getUserById(row.id)
    if (found.error) {
      if (found.error.status === 404) continue
      throw new DevAccountError('DEV_LOOKUP_FAILED', found.error.message)
    }
    if (found.data.user?.email?.toLowerCase() === wanted) return found.data.user
  }
  return null
}

/**
 * 32 random bytes that nobody keeps: the account is entered through a
 * one-time link, never with a password. The tail only satisfies a password
 * policy that wants every character class.
 */
function randomPassword(): string {
  return `${randomBytes(32).toString('base64url')}aA1!`
}

/**
 * The developer account of `role`: found by its address or created, with
 * `profiles` (role, approved) and `staff_roles` matching devAccountShape.
 * Idempotent — an account already in shape is not written to.
 *
 * An account under a developer address that this function did not create is
 * never adopted: the addresses are public (this repository is), and raising a
 * stranger's sign-up to super_admin would hand them the real panel.
 */
export async function ensureDevAccount(role: DevRole, admin: SupabaseClient): Promise<{ userId: string; email: string }> {
  const email = devEmail(role)
  const shape = devAccountShape(role)
  const fullName = `DEV · ${DEV_ROLE_LABELS[role]}`

  let user = await findAuthUserByEmail(admin, email)
  if (!user) {
    const created = await admin.auth.admin.createUser({
      email,
      password: randomPassword(),
      email_confirm: true,
      user_metadata: { full_name: fullName, dev_account: true },
      app_metadata: { [DEV_ACCOUNT_MARKER]: true },
    })
    // A parallel request may have created the account a moment earlier.
    user = created.data.user ?? (await findAuthUserByEmail(admin, email))
    if (!user) throw new DevAccountError('DEV_ACCOUNT_CREATE_FAILED', created.error?.message)
  }
  if (user.app_metadata?.[DEV_ACCOUNT_MARKER] !== true) throw new DevAccountError('DEV_ACCOUNT_CONFLICT', email)

  const profile = await admin.from('profiles').select('role, status').eq('id', user.id).maybeSingle()
  if (profile.error) throw new DevAccountError('DEV_LOOKUP_FAILED', profile.error.message)
  const currentProfile = profile.data as { role?: string | null; status?: string | null } | null
  if (currentProfile?.role !== shape.profileRole || currentProfile?.status !== 'approved') {
    const written = await admin.from('profiles').upsert(
      {
        id: user.id,
        email,
        full_name: fullName,
        role: shape.profileRole,
        status: 'approved',
        approved_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    if (written.error) throw new DevAccountError('DEV_ACCOUNT_WRITE_FAILED', written.error.message)
  }

  const staff = await admin.from('staff_roles').select('role').eq('user_id', user.id).maybeSingle()
  if (staff.error) throw new DevAccountError('DEV_LOOKUP_FAILED', staff.error.message)
  const currentStaff = staff.data as { role?: string | null } | null
  if (shape.staffRole) {
    if (currentStaff?.role !== shape.staffRole) {
      const written = await admin.from('staff_roles').upsert(
        { user_id: user.id, role: shape.staffRole, granted_by: 'dev-login', updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
      if (written.error) throw new DevAccountError('DEV_ACCOUNT_WRITE_FAILED', written.error.message)
    }
  } else if (currentStaff) {
    const removed = await admin.from('staff_roles').delete().eq('user_id', user.id)
    if (removed.error) throw new DevAccountError('DEV_ACCOUNT_WRITE_FAILED', removed.error.message)
  }

  return { userId: user.id, email }
}
