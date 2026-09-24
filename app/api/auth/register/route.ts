import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimited } from '@/lib/rate-limit'
import { getRegistrationMode, getAutoApproveClients } from '@/lib/settings/system-settings'
import { applyApprovalDecision } from '@/lib/users/approval'
import { computeRiskFlags } from '@/lib/registration/risk'

// Public self-registration creates ONLY clients. The legacy 'owner' role was
// removed from the product (2026-09-24); admin/expert/super_admin can NEVER be
// self-assigned — staff are invited by an admin. See audit A3 / F-001.
// `role` is still accepted for old clients of this API but must be 'client'.
const schema = z.object({
  email:        z.string().email(),
  password:     z.string().min(6),
  name:         z.string().min(2),
  role:         z.literal('client').optional().default('client'),
  organization: z.string().optional(),
  position:     z.string().optional(),
})

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

    const { email, password, name, organization, position } = parsed.data
    const admin = createServiceClient()

    // Admin-controlled registration mode (fail-safe 'approval').
    const mode = await getRegistrationMode()
    if (mode === 'invite') {
      return NextResponse.json(
        { error: 'Регистрация доступна только по приглашению. Обратитесь к администратору.' },
        { status: 403 },
      )
    }

    // F-001 (migration 084): handle_new_user IGNORES metadata role/status and
    // always creates client + pending_approval. Role and status are therefore
    // NOT sent as metadata (user_metadata is user-editable and must never be
    // trusted). OPEN mode / auto-approve is applied as an explicit, service-role
    // approve AFTER creation. Never auto-approve by requested role. A3.
    // Create user via admin API — email_confirm: true skips verification entirely
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, organization, position },
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
    // Фаза 6B (№15): в режиме 'approval' self-serve клиенты (других ролей
    // эта форма не создаёт; staff создаются админом, аудит A3) авто-одобряются,
    // пока включён системный тумблер auto_approve_clients (default ON, решение ПО
    // 2026-07-09 — ручная модерация была главным трением активации).
    // D3: тумблерное авто-одобрение дополнительно защищено risk-скорингом —
    // флагованные кандидаты (одноразовый email, спам-термины и т.п.) остаются
    // pending_approval на ручную модерацию. 'open' по-прежнему безусловен.
    let effectiveStatus: 'pending_approval' | 'approved' = 'pending_approval'
    let riskFlags: string[] = []

    let autoApprove = mode === 'open'
    if (!autoApprove && mode === 'approval' && (await getAutoApproveClients())) {
      const risk = computeRiskFlags({ email, name, organization, emailConfirmed: true })
      riskFlags = risk.flags
      if (risk.recommend === 'auto_approve') {
        autoApprove = true
      } else {
        console.warn('[auth/register] auto-approve → manual review', { userId: data.user.id, score: risk.score, flags: risk.flags })
      }
    }

    if (autoApprove) {
      try {
        const { affected } = await applyApprovalDecision({
          userId: data.user.id,
          status: 'approved',
          sendEmail: false,
        })
        if (affected > 0) effectiveStatus = 'approved'
      } catch (e) {
        console.error(`[auth/register] ${mode}-mode auto-approve failed:`, e)
      }
    }

    return NextResponse.json({ ok: true, userId: data.user.id, status: effectiveStatus, riskFlags }, { status: 201 })
  } catch (err) {
    console.error('[auth/register] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
