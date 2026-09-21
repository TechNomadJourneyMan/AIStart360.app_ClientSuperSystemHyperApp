import { createServiceClient } from '@/lib/supabase-service'
import { sendPortalInvitationEmail } from '@/lib/email'
import { getSiteUrl } from '@/lib/site-url'
import { STAFF_ROLE_LABELS, type StaffRole } from '@/lib/admin/rbac'
import { normalizeEmail, type InviteResult } from './invite-shared'

export type { InviteOutcome, InviteResult } from './invite-shared'
export { normalizeEmail, parseEmailList } from './invite-shared'

/**
 * lib/admin/invites.ts — приглашение на платформу письмом с нашего домена.
 *
 * Почему не штатный invite Supabase: он шлёт письмо по своему шаблону и ведёт
 * на Site URL проекта, который сейчас указывает на посторонний домен (проверено
 * пробой generate_link: любой запрошенный адрес подменяется). Поэтому здесь
 * берём только одноразовый токен, а ссылку и письмо формируем сами — так
 * приглашение всегда приземляется в нашем кабинете.
 *
 * Сам токен НИГДЕ не сохраняется: он живёт только в письме. В
 * `platform_invitations` пишется запись о приглашении — кому, кем, с какой
 * ролью, до какого времени действует и чем закончилось.
 */

/** Одноразовая ссылка Supabase живёт час — столько же живёт приглашение. */
export const INVITE_TTL_MS = 60 * 60 * 1000

export interface InviteInput {
  email: string
  /** Куда отправить после установки пароля или входа. */
  next?: string
  /** Личная строка от пригласившего — попадёт в письмо. */
  note?: string | null
  /** Подпись отправителя в письме (email сотрудника). */
  invitedByLabel?: string | null
  /** id сотрудника, отправившего приглашение (для записи и аудита). */
  invitedById?: string | null
  /** Имя приглашённого, если известно. */
  name?: string | null
  /** Компания — попадёт в письмо и в запись приглашения. */
  company?: string | null
  /**
   * Роль персонала, которую человек получит, приняв приглашение.
   * Выдавать её вправе только тот, у кого есть 'roles.manage' — проверка в
   * маршруте, сюда приходит уже разрешённое значение.
   */
  staffRole?: StaffRole | null
}

/** Уже заходил ли человек на платформу (тогда шлём ссылку для входа, а не приглашение). */
async function findProfile(email: string): Promise<{ id: string; full_name: string | null } | null> {
  try {
    const { data } = await createServiceClient()
      .from('profiles')
      .select('id, full_name')
      .ilike('email', email)
      .maybeSingle()
    return (data as { id: string; full_name: string | null } | null) ?? null
  } catch {
    return null
  }
}

/** Запись о приглашении. Ошибка журнала не должна мешать самому приглашению. */
async function recordInvitation(row: Record<string, unknown>): Promise<string | null> {
  try {
    const { data, error } = await createServiceClient()
      .from('platform_invitations')
      .insert(row)
      .select('id')
      .single()
    if (error) {
      console.warn('[invites] запись приглашения не сохранена:', error.message)
      return null
    }
    return (data as { id: string }).id
  } catch (e) {
    console.warn('[invites] запись приглашения недоступна:', e instanceof Error ? e.message : e)
    return null
  }
}

async function markInvitation(id: string | null, patch: Record<string, unknown>): Promise<void> {
  if (!id) return
  try {
    await createServiceClient()
      .from('platform_invitations')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
  } catch {
    /* журнал — не критичный путь */
  }
}

export async function sendPlatformInvite(input: InviteInput): Promise<InviteResult> {
  const email = normalizeEmail(input.email)
  if (!email) return { email: input.email, outcome: 'failed', message: 'Некорректный адрес' }

  const profile = await findProfile(email)
  const existing = !!profile
  const type = existing ? 'magiclink' : 'invite'
  const sentAt = new Date()
  const expiresAt = new Date(sentAt.getTime() + INVITE_TTL_MS)

  const invitationId = await recordInvitation({
    email,
    staff_role: input.staffRole ?? null,
    status: 'sent',
    link_type: type,
    note: input.note ?? null,
    next_path: input.next ?? null,
    company_name: input.company ?? null,
    invited_by: input.invitedById ?? null,
    invited_by_email: input.invitedByLabel ?? null,
    user_id: profile?.id ?? null,
    sent_at: sentAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  })

  let tokenHash: string | undefined
  try {
    const { data, error } = await createServiceClient().auth.admin.generateLink({ type, email })
    if (error) throw new Error(error.message)
    tokenHash = data?.properties?.hashed_token
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось создать приглашение'
    await markInvitation(invitationId, { status: 'failed', last_error: message.slice(0, 300) })
    return { email, outcome: 'failed', message }
  }
  if (!tokenHash) {
    await markInvitation(invitationId, { status: 'failed', last_error: 'Supabase не вернул ссылку' })
    return { email, outcome: 'failed', message: 'Supabase не вернул ссылку' }
  }

  // Новый человек сначала задаёт пароль; уже знакомый попадает сразу в кабинет.
  const next = input.next || (existing ? '/dashboard' : '/auth/reset-password')
  const url = new URL('/auth/verify', getSiteUrl())
  url.searchParams.set('token_hash', tokenHash)
  url.searchParams.set('type', type)
  url.searchParams.set('next', next)

  const sent = await sendPortalInvitationEmail(
    email,
    {
      name: input.name ?? profile?.full_name ?? null,
      company: input.company ?? null,
      roleLabel: input.staffRole ? STAFF_ROLE_LABELS[input.staffRole] : null,
      note: input.note ?? null,
      invitedByLabel: input.invitedByLabel ?? null,
      invitedAt: sentAt,
      expiresAt,
      url: url.toString(),
      existingAccount: existing,
    },
    { userId: profile?.id ?? null, invitationId },
  )

  if (!sent.ok) {
    await markInvitation(invitationId, { status: 'failed', last_error: (sent.error ?? 'Письмо не отправилось').slice(0, 300) })
    return { email, outcome: 'failed', message: sent.error ?? 'Письмо не отправилось' }
  }

  return existing
    ? { email, outcome: 'relinked', message: 'Аккаунт уже был — отправлена ссылка для входа' }
    : { email, outcome: 'invited', message: 'Приглашение отправлено' }
}

/**
 * Приглашение принято: человек перешёл по ссылке и получил сессию.
 *
 * Закрывает самую свежую живую запись приглашения и, если в ней была указана
 * роль персонала, выдаёт её. Роль попадает сюда только из приглашения, которое
 * создал сотрудник с правом 'roles.manage' — повысить себя переходом по чужой
 * ссылке нельзя.
 *
 * Никогда не бросает: вход по ссылке важнее, чем побочный учёт.
 */
export async function acceptInvitation(
  email: string | null | undefined,
  userId: string,
): Promise<{ accepted: boolean; staffRole: StaffRole | null }> {
  const normalized = normalizeEmail(email ?? '')
  if (!normalized) return { accepted: false, staffRole: null }

  try {
    const sb = createServiceClient()
    const nowIso = new Date().toISOString()
    const { data } = await sb
      .from('platform_invitations')
      .select('id, staff_role, expires_at')
      .ilike('email', normalized)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const invite = data as { id: string; staff_role: string | null; expires_at: string } | null
    if (!invite) return { accepted: false, staffRole: null }

    // Просроченную ссылку Supabase и так не примет, но статус надо закрыть.
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      await sb.from('platform_invitations').update({ status: 'expired', updated_at: nowIso }).eq('id', invite.id)
      return { accepted: false, staffRole: null }
    }

    await sb
      .from('platform_invitations')
      .update({ status: 'accepted', accepted_at: nowIso, user_id: userId, updated_at: nowIso })
      .eq('id', invite.id)

    const staffRole = (invite.staff_role ?? null) as StaffRole | null
    if (staffRole) {
      // Аккаунт персонала должен быть одобрен, иначе роль не сработает
      // (см. staffRoleOf в lib/admin/giga-actor.ts).
      await sb
        .from('profiles')
        .update({ status: 'approved', approved_at: nowIso })
        .eq('id', userId)
        .neq('status', 'approved')
      await sb
        .from('staff_roles')
        .upsert(
          { user_id: userId, role: staffRole, granted_by: `invitation:${invite.id}`, updated_at: nowIso },
          { onConflict: 'user_id' },
        )
    }
    return { accepted: true, staffRole }
  } catch (e) {
    console.warn('[invites] не удалось закрыть приглашение:', e instanceof Error ? e.message : e)
    return { accepted: false, staffRole: null }
  }
}
