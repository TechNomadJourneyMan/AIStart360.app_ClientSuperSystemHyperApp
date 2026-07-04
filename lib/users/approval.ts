import { createServiceClient } from '@/lib/supabase-service'
import { sendUserEmail } from '@/lib/email'

/**
 * SINGLE SOURCE OF TRUTH for user access status.
 *
 * `profiles.status` is the ONLY field the login flow and waiting-room read to
 * grant portal access (middleware gates on role; the status redirect lives in
 * the login page + `/api/client/status`). So EVERY approve / reject / clarify
 * path — giga panel, /api/v1/admin/*, and the Prisma /api/admin/* routes —
 * funnels the authoritative write through here, instead of each writing its own
 * field (the old bug: three backends wrote three different fields/tables and the
 * giga one wrote nothing that stuck).
 *
 * This helper:
 *   - writes via the SERVICE ROLE, so it works regardless of whether the caller
 *     has a Supabase session (the giga panel has none). Callers MUST perform
 *     their own authorization before calling.
 *   - VERIFIES the affected row: `affected === 0` means nothing changed, and the
 *     caller must treat that as a failure — never report silent success.
 *   - notifies the user by email and reports whether it was actually sent.
 */

export type ProfileStatus = 'pending_approval' | 'approved' | 'rejected' | 'requires_clarification'

export interface ApplyApprovalInput {
  /** Supabase profile id (== auth user id). Preferred. */
  userId?: string
  /** Fallback lookup key for callers whose ids live in another table (Prisma admin path). */
  email?: string
  status: ProfileStatus
  /** Real admin profile UUID for `approved_by` (must be a profiles.id). Omit for the giga shared-password path. */
  approvedBy?: string | null
  /** Optional reason/comment included in the rejection / clarification email. */
  reason?: string
  /** Set false to skip the notification email (e.g. reverting to pending). */
  sendEmail?: boolean
}

export interface ApplyApprovalResult {
  affected: number
  profile: { id: string; email: string | null; full_name: string | null } | null
  emailSent: boolean
}

export async function applyApprovalDecision(input: ApplyApprovalInput): Promise<ApplyApprovalResult> {
  if (!input.userId && !input.email) {
    throw new Error('applyApprovalDecision requires userId or email')
  }

  const sb = createServiceClient()

  const patch: Record<string, unknown> = { status: input.status }
  if (input.status === 'approved') {
    patch.approved_at = new Date().toISOString()
    if (input.approvedBy) patch.approved_by = input.approvedBy
  }

  const base = sb.from('profiles').update(patch)
  const filtered = input.userId ? base.eq('id', input.userId) : base.eq('email', input.email as string)
  const { data: updated, error } = await filtered.select('id, email, full_name')

  if (error) throw new Error(`profiles.status update failed: ${error.message}`)

  const first = updated?.[0] as { id: string; email: string | null; full_name: string | null } | undefined
  const profile = first
    ? { id: first.id, email: first.email ?? null, full_name: first.full_name ?? null }
    : null

  let emailSent = false
  const notify = input.sendEmail !== false && input.status !== 'pending_approval'
  if (profile?.email && notify) {
    emailSent = (await sendDecisionEmail(profile.email, profile.full_name, input.status, input.reason)).ok
  }

  return { affected: updated?.length ?? 0, profile, emailSent }
}

async function sendDecisionEmail(
  email: string,
  fullName: string | null,
  status: ProfileStatus,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const name = fullName ? `${fullName}, ` : ''

  if (status === 'approved') {
    return sendUserEmail({
      to: email,
      subject: 'Доступ к AIStart360 открыт',
      title: 'Заявка одобрена',
      body: `${name}ваш доступ к порталу AIStart360 подтверждён. Теперь вы можете войти.`,
      ctaLabel: 'Войти',
      ctaPath: '/login',
    })
  }

  if (status === 'requires_clarification') {
    return sendUserEmail({
      to: email,
      subject: 'Требуется уточнение по заявке',
      title: 'Требуется уточнение',
      body: `${name}по вашей заявке на доступ нужны уточнения.${reason ? ' Комментарий: ' + reason : ''}`,
    })
  }

  // rejected
  return sendUserEmail({
    to: email,
    subject: 'Заявка отклонена',
    title: 'Заявка отклонена',
    body: `${name}к сожалению, ваша заявка на доступ отклонена.${reason ? ' Причина: ' + reason : ''}`,
  })
}
