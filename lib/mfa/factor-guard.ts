import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase-service'
import { getSetting } from '@/lib/settings/store'
import { logActivity } from '@/lib/activity/log'
import { devModeOnForServerRequest } from '@/lib/dev/dev-request'
import { countCredentials } from '@/lib/webauthn/store'
import { getUserSecurity } from './store'
import { MFA_COOKIE_NAME, currentStepUpSessionKey, verifyStepUp } from './step-up'

/**
 * R-003 — who may change the second factors of an account.
 *
 * Rule: once an account HAS a factor (TOTP or a passkey), every operation on
 * factors — add a passkey, set up / re-bind TOTP, delete a passkey, re-issue
 * backup codes, switch 2FA off — needs the step-up proof of THIS session
 * (lib/mfa/step-up.ts, bound to the Supabase session since R-132). A password
 * alone (a stolen password, an admin driving the cabinet «от имени») is not
 * enough to plant an attacker's factor or to remove the owner's.
 *
 * The first factor of an account (no TOTP, no passkey yet) is the 2FA
 * onboarding — staff are sent there by «2FA обязательна» — and needs only the
 * signed-in session; only then does the registration mint the step-up proof
 * for this session (the user has just proven the new factor). Leftover backup
 * codes without any factor do not count as a factor (2FA is off then).
 *
 * Staff must keep a factor while the platform setting `staff_require_mfa` is
 * on: removing the last one is refused (lastFactorRefusal()).
 */

export interface FactorState {
  totp: boolean
  passkeys: number
  backupCodes: number
}

export function hasAnyFactor(s: FactorState): boolean {
  return s.totp || s.passkeys > 0
}

/** Current factors of the user. Throws when they cannot be read (callers fail closed). */
export async function readFactorState(userId: string): Promise<FactorState> {
  const [row, passkeys] = await Promise.all([getUserSecurity(userId), countCredentials(userId)])
  return {
    totp: !!row?.totp_enabled && !!row?.totp_secret_enc,
    passkeys,
    backupCodes: row?.backup_codes?.length ?? 0,
  }
}

/**
 * The step-up proof of THIS session for `userId` is present. The localhost
 * developer login counts as the second factor, as everywhere else
 * (`false` in a production build).
 */
export function sessionHasStepUp(userId: string): boolean {
  if (devModeOnForServerRequest()) return true
  let token: string | undefined
  try {
    token = cookies().get(MFA_COOKIE_NAME)?.value
  } catch {
    return false
  }
  return verifyStepUp(token, userId, currentStepUpSessionKey())
}

export type FactorGuard =
  | { ok: true; state: FactorState; firstFactor: boolean }
  | { ok: false; response: NextResponse }

/**
 * Gate of a factor operation `action` (an activity name, e.g.
 * 'webauthn.register'). Refusals are written to the security journal.
 */
export async function guardFactorChange(
  request: Request | null,
  user: { id: string },
  action: string,
): Promise<FactorGuard> {
  let state: FactorState
  try {
    state = await readFactorState(user.id)
  } catch (err) {
    console.error('[mfa/factor-guard] factor state unavailable', err instanceof Error ? err.message : err)
    return { ok: false, response: NextResponse.json({ ok: false, error: 'Не удалось проверить настройки 2FA. Попробуйте позже.' }, { status: 503 }) }
  }
  if (!hasAnyFactor(state)) return { ok: true, state, firstFactor: true }
  if (sessionHasStepUp(user.id)) return { ok: true, state, firstFactor: false }

  await logActivity({
    userId: user.id,
    action: 'security.factor_change_blocked',
    category: 'security',
    severity: 'critical',
    status: 'failure',
    description: 'Попытка изменить факторы 2FA без подтверждения вторым фактором',
    metadata: { operation: action },
    req: request ?? undefined,
  })
  return {
    ok: false,
    response: NextResponse.json({
      ok: false,
      error: 'Подтвердите вход вторым фактором (страница /2fa), затем повторите действие',
      code: 'MFA_STEP_UP_REQUIRED',
    }, { status: 403 }),
  }
}

// Profile roles that make a person staff for the 2FA rule (lib/api-identity.ts
// STAFF_ROLES), plus any `staff_roles` row (SuperExpert, support, … whose
// profile role is often 'client').
const STAFF_PROFILE_ROLES = new Set(['expert', 'admin', 'super_admin', 'manager', 'analyst'])

/**
 * The platform requires a second factor from this person: `staff_require_mfa`
 * is on AND they are staff. Throws when it cannot be decided (fail closed).
 */
export async function secondFactorMandatory(userId: string): Promise<boolean> {
  if (!(await getSetting('staff_require_mfa'))) return false
  const sb = createServiceClient()
  const [profile, staff] = await Promise.all([
    sb.from('profiles').select('role').eq('id', userId).maybeSingle(),
    sb.from('staff_roles').select('user_id').eq('user_id', userId).maybeSingle(),
  ])
  if (profile.error || staff.error) throw new Error('staff state unavailable')
  const role = (profile.data as { role?: string | null } | null)?.role ?? null
  return (!!role && STAFF_PROFILE_ROLES.has(role)) || !!staff.data
}

/**
 * Removing a factor would leave `after` — refuse when that is no factor at all
 * and the person must keep 2FA. null = may proceed.
 */
export async function lastFactorRefusal(
  request: Request | null,
  user: { id: string },
  after: FactorState,
  action: string,
): Promise<NextResponse | null> {
  if (hasAnyFactor(after)) return null
  let mandatory: boolean
  try {
    mandatory = await secondFactorMandatory(user.id)
  } catch {
    return NextResponse.json({ ok: false, error: 'Не удалось проверить настройки 2FA. Попробуйте позже.' }, { status: 503 })
  }
  if (!mandatory) return null
  await logActivity({
    userId: user.id,
    action: 'security.factor_change_blocked',
    category: 'security',
    severity: 'critical',
    status: 'failure',
    description: 'Попытка снять последний фактор 2FA у сотрудника (2FA обязательна)',
    metadata: { operation: action, reason: 'last_factor_staff' },
    req: request ?? undefined,
  })
  return NextResponse.json({
    ok: false,
    error: 'Для сотрудников двухфакторная аутентификация обязательна: сначала добавьте другой фактор (ключ доступа или приложение-аутентификатор).',
    code: 'MFA_REQUIRED_FOR_STAFF',
  }, { status: 409 })
}
