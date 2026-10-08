// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for all /api/expert/* routes:
// - service-role REST fetch (bypasses profiles RLS infinite-recursion)
// - expert gate: role + approved status via service role, then the staff
//   second-factor gate (staffMfaGate), like requireGiga
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'
import { staffMfaGate } from '@/lib/admin/giga-actor'
import { MFA_COOKIE_NAME } from '@/lib/mfa/step-up'

export const EXPERT_ROLES = new Set(['expert', 'admin', 'super_admin'])

/**
 * Who the expert Telegram bot admits: a profile role in EXPERT_ROLES (expert
 * portal) or the SuperExpert staff role (their profile role is usually
 * 'client'; the role lives in staff_roles).
 */
export function isExpertBotMember(profileRole: string | null | undefined, staffRole: string | null | undefined): boolean {
  return EXPERT_ROLES.has(profileRole ?? '') || staffRole === 'super_expert'
}

/** Role label for an expert-bot member: the profile role, or 'super_expert'. */
export function expertBotRole(profileRole: string | null | undefined, staffRole: string | null | undefined): string {
  return EXPERT_ROLES.has(profileRole ?? '') ? (profileRole as string) : staffRole === 'super_expert' ? 'super_expert' : (profileRole ?? '')
}

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  }
}

export async function srGet<T = unknown>(path: string): Promise<T | null> {
  const { url, key } = srBase()
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[expert-auth] srGet', res.status, path)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.error('[expert-auth] srGet error:', err)
    return null
  }
}

export interface ExpertViewer {
  id: string
  role: string | null
  email: string | null
}

/** Why a session was not admitted to the expert portal API. */
export type ExpertBlock = 'unauthenticated' | 'forbidden' | 'step_up' | 'enroll' | 'unavailable'

export type ExpertAuth = { ok: true; viewer: ExpertViewer } | { ok: false; block: ExpertBlock }

/**
 * Authorise the request as coming from an expert/admin/super_admin.
 *
 * Experts are platform staff (D1), so the same rules as GIGA staff apply:
 *  - the profile must be APPROVED (pending / rejected / blocked / archived
 *    accounts get nothing, whatever their role says);
 *  - the second factor: when the person enrolled (or the platform requires
 *    2FA for staff) the signed step-up cookie of THIS user must be present
 *    (staffMfaGate). Middleware does not gate /api/*, so this is the gate.
 * Fails closed when the profile or the MFA state cannot be read.
 */
export async function resolveExpert(): Promise<ExpertAuth> {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return { ok: false, block: 'unauthenticated' }

  const rows = await srGet<Array<{ id: string; role: string | null; status: string | null }>>(
    `profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,status&limit=1`,
  )
  if (rows === null) return { ok: false, block: 'unavailable' }
  const viewer = rows[0] ?? null
  if (!viewer || !EXPERT_ROLES.has(viewer.role ?? '') || viewer.status !== 'approved') {
    return { ok: false, block: 'forbidden' }
  }

  let gate: Awaited<ReturnType<typeof staffMfaGate>>
  try {
    gate = await staffMfaGate(cookies().get(MFA_COOKIE_NAME)?.value, user)
  } catch {
    return { ok: false, block: 'unavailable' }
  }
  if (gate !== 'ok') return { ok: false, block: gate }

  return { ok: true, viewer: { id: viewer.id, role: viewer.role, email: user.email ?? null } }
}

/**
 * Gate of the expert-bot link API (/api/expert/telegram-link): the expert
 * portal gate, widened to SuperExpert staff (approved, same second-factor
 * rule). Does NOT open the rest of /api/expert/* to SuperExperts.
 */
export async function resolveExpertBotUser(): Promise<ExpertAuth> {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return { ok: false, block: 'unauthenticated' }

  const [profiles, staff] = await Promise.all([
    srGet<Array<{ id: string; role: string | null; status: string | null }>>(
      `profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,status&limit=1`,
    ),
    srGet<Array<{ role: string | null }>>(`staff_roles?user_id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`),
  ])
  if (profiles === null || staff === null) return { ok: false, block: 'unavailable' }
  const viewer = profiles[0] ?? null
  const staffRole = staff[0]?.role ?? null
  if (!viewer || viewer.status !== 'approved' || !isExpertBotMember(viewer.role, staffRole)) {
    return { ok: false, block: 'forbidden' }
  }

  let gate: Awaited<ReturnType<typeof staffMfaGate>>
  try {
    gate = await staffMfaGate(cookies().get(MFA_COOKIE_NAME)?.value, user)
  } catch {
    return { ok: false, block: 'unavailable' }
  }
  if (gate !== 'ok') return { ok: false, block: gate }

  return { ok: true, viewer: { id: viewer.id, role: expertBotRole(viewer.role, staffRole), email: user.email ?? null } }
}

/**
 * The viewer, or null when the caller may not use the expert portal API
 * (see resolveExpert; routes answer their usual 401/403). Routes that want to
 * tell the UI WHY (second factor) use resolveExpert + expertBlockResponse.
 */
export async function requireExpert(): Promise<ExpertViewer | null> {
  const r = await resolveExpert()
  return r.ok ? r.viewer : null
}

/** JSON answer for a refused expert request; MFA blocks carry the same codes as GIGA. */
export function expertBlockResponse(block: ExpertBlock): NextResponse {
  switch (block) {
    case 'unauthenticated':
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    case 'forbidden':
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    case 'step_up':
      return NextResponse.json({
        ok: false,
        error: 'Подтвердите вход вторым фактором (страница /2fa), затем повторите действие',
        code: 'MFA_STEP_UP_REQUIRED',
      }, { status: 403 })
    case 'enroll':
      return NextResponse.json({
        ok: false,
        error: 'Включите двухфакторную аутентификацию (Настройки → Безопасность)',
        code: 'MFA_ENROLLMENT_REQUIRED',
      }, { status: 403 })
    case 'unavailable':
      return NextResponse.json({ ok: false, error: 'Не удалось проверить права' }, { status: 503 })
  }
}
