/**
 * lib/devtools/view-as.ts — «Посмотреть панель как роль» (Dev-tools Super Admin).
 *
 * Super Admin выбирает роль персонала → сервер ставит подписанный httpOnly
 * cookie, привязанный к его user id. Пока cookie действует, requireGiga() и
 * /api/giga-admin/me отдают права ВЫБРАННОЙ роли: меню, страницы и API ведут
 * себя ровно так, как у сотрудника с этой ролью. Аккаунт не переключается.
 *
 * Правила безопасности (проверяются чистой функцией resolveViewAs):
 *  - только ПОНИЖЕНИЕ: учитывается, лишь когда настоящая роль — super_admin,
 *    а выбранная — любая другая роль персонала;
 *  - cookie другого пользователя (sub ≠ id актора) игнорируется;
 *  - cookie у кого-то кроме super_admin (подделан / остался после снятия роли)
 *    игнорируется;
 *  - запросы, которым нужно 'devtools.use' (сами Dev-tools, выход из режима),
 *    всегда идут с НАСТОЯЩЕЙ ролью — из режима можно выйти в любой момент.
 *
 * Модуль без серверных зависимостей, кроме подписи токенов (Web Crypto).
 */
import { signToken, verifyToken, type SignedTokenType } from '@/lib/security/signed-token'
import { STAFF_ROLES, STAFF_ROLE_LABELS, isStaffRole, type Permission, type StaffRole } from '@/lib/admin/rbac'

export const VIEW_AS_COOKIE_NAME = 'aistart360_view_as'
export const VIEW_AS_TTL_SECONDS = 2 * 60 * 60

/**
 * Отдельный тип токена: cookie «как роль» никогда не проверится как staff- или
 * imp-токен (и наоборот): verify сверяет `typ`.
 */
const VIEW_AS_TOKEN_TYPE: SignedTokenType = 'va'

/** Роли, которыми можно «посмотреть» панель: все роли персонала, кроме самой высшей. */
export const VIEWABLE_ROLES: readonly StaffRole[] = STAFF_ROLES.filter((r) => r !== 'super_admin')

/** Права, которые всегда проверяются по НАСТОЯЩЕЙ роли (иначе из режима не выйти). */
export const REAL_ROLE_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>(['devtools.use'])

export interface ViewAsClaims extends Record<string, unknown> {
  /** profiles UUID настоящего Super Admin. */
  sub: string
  /** Роль, которой смотрим. */
  role: string
}

export function isViewableRole(v: unknown): v is StaffRole {
  return isStaffRole(v) && v !== 'super_admin'
}

/** Нужны ли запросу права настоящей роли (режим «как роль» не применяется). */
export function needsRealRole(permissions: readonly Permission[]): boolean {
  return permissions.some((p) => REAL_ROLE_PERMISSIONS.has(p))
}

/**
 * Какая роль действует в этом запросе вместо настоящей, или null — режим не
 * применяется. Чистая функция: вся логика понижения прав — здесь.
 */
export function resolveViewAs(input: {
  /** Настоящая роль актора (из БД). */
  realRole: StaffRole
  actorId: string
  /** Проверенные (подпись + срок) claims cookie или null. */
  claims: { sub?: unknown; role?: unknown } | null | undefined
  /** Права, которые требует запрос. */
  needed?: readonly Permission[]
}): StaffRole | null {
  if (input.realRole !== 'super_admin') return null
  if (input.needed && needsRealRole(input.needed)) return null
  const c = input.claims
  if (!c || typeof c.sub !== 'string' || c.sub !== input.actorId) return null
  return isViewableRole(c.role) ? c.role : null
}

/** Выйти из режима можно всегда — сервер просто стирает cookie, ничего не проверяя. */
export function canExitViewAs(): true {
  return true
}

export async function signViewAs(actorId: string, role: StaffRole): Promise<string> {
  if (!isViewableRole(role)) throw new Error('role is not viewable')
  return signToken<ViewAsClaims>(VIEW_AS_TOKEN_TYPE, { sub: actorId, role }, VIEW_AS_TTL_SECONDS)
}

/** Проверенные claims cookie или null (нет / подделан / истёк). */
export async function readViewAs(token: string | null | undefined): Promise<(ViewAsClaims & { exp: number }) | null> {
  if (!token) return null
  const v = await verifyToken<ViewAsClaims>(VIEW_AS_TOKEN_TYPE, token)
  return v.ok ? v.claims : null
}

export const VIEW_AS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: VIEW_AS_TTL_SECONDS,
}

export function viewAsLabel(role: StaffRole): string {
  return STAFF_ROLE_LABELS[role]
}
