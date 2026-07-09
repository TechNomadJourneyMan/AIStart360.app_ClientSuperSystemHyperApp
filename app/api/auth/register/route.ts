import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { isRateLimited } from '@/lib/rate-limit'
import { getRegistrationMode, getAutoApproveClients } from '@/lib/settings/system-settings'
import { applyApprovalDecision } from '@/lib/users/approval'

// Public self-registration. Only the two roles offered in the UI are allowed
// ('client' = бизнес, 'owner' = команда AIStart360). admin/expert/super_admin
// can NEVER be self-assigned — staff are created by an admin. See audit A3.
const schema = z.object({
  email:        z.string().email(),
  password:     z.string().min(6),
  name:         z.string().min(2),
  role:         z.enum(['client', 'owner']).optional().default('client'),
  organization: z.string().optional(),
  position:     z.string().optional(),
})

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  try {
    // Throttle public self-registration to curb mass account creation / abuse.
    if (await isRateLimited(request, 'auth-register')) {
      return NextResponse.json(
        { error: 'Слишком много попыток. Попробуйте позже.' },
        { status: 429 },
      )
    }

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
    }

    const { email, password, name, role, organization, position } = parsed.data
    const admin = getAdminClient()

    // Admin-controlled registration mode (fail-safe 'approval').
    const mode = await getRegistrationMode()
    if (mode === 'invite') {
      return NextResponse.json(
        { error: 'Регистрация доступна только по приглашению. Обратитесь к администратору.' },
        { status: 403 },
      )
    }

    // Metadata status is always 'pending_approval'; the handle_new_user trigger
    // forces clients to pending regardless. OPEN mode is applied as an explicit
    // approve AFTER creation (below). Never auto-approve by requested role. A3.
    const status = 'pending_approval'

    // Create user via admin API — email_confirm: true skips verification entirely
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, role, organization, position, status },
    })

    if (error) {
      if (error.message.toLowerCase().includes('already registered') || error.message.toLowerCase().includes('already been registered')) {
        return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (!data.user) {
      return NextResponse.json({ error: 'UNKNOWN' }, { status: 500 })
    }

    // OPEN mode: grant access immediately (the trigger created the client as
    // pending_approval). Best-effort — never fail the registration on this.
    // Фаза 6B (№15): в режиме 'approval' self-serve роли (client/owner — других
    // эта форма не предлагает; staff создаются админом, аудит A3) авто-одобряются,
    // пока включён системный тумблер auto_approve_clients (default ON, решение ПО
    // 2026-07-09 — ручная модерация была главным трением активации).
    let effectiveStatus: 'pending_approval' | 'approved' = 'pending_approval'
    const autoApprove =
      mode === 'open' || (mode === 'approval' && (await getAutoApproveClients()))
    if (autoApprove) {
      try {
        const { affected } = await applyApprovalDecision({
          userId: data.user.id,
          status: 'approved',
          sendEmail: false,
        })
        if (affected > 0) effectiveStatus = 'approved'
      } catch (e) {
        console.error('[auth/register] open-mode auto-approve failed:', e)
      }
    }

    return NextResponse.json({ ok: true, userId: data.user.id, status: effectiveStatus }, { status: 201 })
  } catch (err) {
    console.error('[auth/register] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
