import { createHash, randomBytes } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase-service'
import { adminResetUserMfa } from '@/lib/mfa/store'
import { logActivity } from '@/lib/activity/log'
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
 *
 * SR-04 / R-009 (захват аккаунта до его создания). Роль из приглашения
 * выдаётся ТОЛЬКО по одноразовому токену приглашения из письма (`invite=` в
 * ссылке; в базе — лишь его SHA-256 в `metadata.accept_token_hash`), а не по
 * совпадению e-mail. Если аккаунт с этим адресом существовал ДО приглашения
 * (его мог заранее зарегистрировать посторонний — почта при регистрации не
 * подтверждается), перед выдачей роли он отбирается у прежнего держателя:
 * случайный пароль (новый задаёт владелец почты), отзыв всех остальных
 * сессий, удаление факторов 2FA, отзыв MCP/OAuth-токенов и Telegram-привязок,
 * событие в журнале безопасности. Не получилось — роль не выдаётся.
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

/** Одноразовый токен приглашения: 32 случайных байта, в письме — base64url. */
export function newInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Что хранится в записи приглашения вместо самого токена. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export async function sendPlatformInvite(input: InviteInput): Promise<InviteResult> {
  const email = normalizeEmail(input.email)
  if (!email) return { email: input.email, outcome: 'failed', message: 'Некорректный адрес' }

  const profile = await findProfile(email)
  const existing = !!profile
  const type = existing ? 'magiclink' : 'invite'
  const sentAt = new Date()
  const expiresAt = new Date(sentAt.getTime() + INVITE_TTL_MS)
  const inviteToken = newInviteToken()

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
    metadata: { accept_token_hash: hashInviteToken(inviteToken) },
  })
  // SR-04: роль выдаётся только по записи с токеном. Без записи приглашение
  // сотрудника бессмысленно (роль не придёт) — не шлём письмо-обманку.
  if (input.staffRole && !invitationId) {
    return { email, outcome: 'failed', message: 'Не удалось сохранить приглашение — повторите позже' }
  }

  let tokenHash: string | undefined
  try {
    const { data, error } = await createServiceClient().auth.admin.generateLink({ type, email })
    if (error) throw new Error(error.message)
    tokenHash = data?.properties?.hashed_token
    // Аккаунт, созданный самим приглашением: по нему при принятии отличаем
    // «новый» аккаунт от существовавшего раньше (SR-04).
    if (type === 'invite' && data?.user?.id) await markInvitation(invitationId, { user_id: data.user.id })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось создать приглашение'
    await markInvitation(invitationId, { status: 'failed', last_error: message.slice(0, 300) })
    return { email, outcome: 'failed', message }
  }
  if (!tokenHash) {
    await markInvitation(invitationId, { status: 'failed', last_error: 'Supabase не вернул ссылку' })
    return { email, outcome: 'failed', message: 'Supabase не вернул ссылку' }
  }

  // Новый человек сначала задаёт пароль; уже знакомый попадает сразу в кабинет
  // (если приглашение отбирает у аккаунта пароль — /auth/verify отправит
  // задать новый, см. acceptInvitation).
  const next = input.next || (existing ? '/dashboard' : '/auth/reset-password')
  const url = new URL('/auth/verify', getSiteUrl())
  url.searchParams.set('token_hash', tokenHash)
  url.searchParams.set('type', type)
  url.searchParams.set('next', next)
  url.searchParams.set('invite', inviteToken)

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

export interface AcceptInvitationInput {
  /** Токен `invite=` из ссылки письма. Без него роль не выдаётся никогда. */
  inviteToken: string | null | undefined
  /** Аккаунт, в который ссылка только что впустила (verifyOtp). */
  userId: string
  /** Его e-mail — на этот адрес ушла одноразовая ссылка Supabase. */
  email: string | null | undefined
  /**
   * Access token сессии, только что созданной ссылкой. Её сохраняем (это
   * владелец почты), все ОСТАЛЬНЫЕ сессии аккаунта отзываются.
   */
  accessToken?: string | null
  request?: Request
}

export type AcceptRefusal =
  | 'no_token' | 'bad_email' | 'not_found' | 'expired' | 'email_mismatch' | 'already_used' | 'secure_failed' | 'error'

export interface AcceptInvitationResult {
  accepted: boolean
  staffRole: StaffRole | null
  /**
   * Аккаунт существовал до приглашения и был отобран у прежнего держателя:
   * пароль сброшен — владелец почты должен задать новый (/auth/reset-password).
   */
  secured: boolean
  refused?: AcceptRefusal
}

interface InvitationRow {
  id: string
  email: string
  staff_role: string | null
  status: string
  link_type: string | null
  user_id: string | null
  sent_at: string
  expires_at: string
}

const refusedResult = (refused: AcceptRefusal): AcceptInvitationResult => ({ accepted: false, staffRole: null, secured: false, refused })

/**
 * Нужно ли отобрать аккаунт у прежнего держателя перед выдачей роли: он
 * существовал до приглашения (или его не удаётся проверить — тогда тоже да).
 * «Новый» — только аккаунт, который создало само приглашение (generateLink
 * type=invite записал его id) и который создан не раньше приглашения.
 */
async function accountPredatesInvitation(invite: InvitationRow, userId: string): Promise<{ predates: boolean; reasons: string[] }> {
  const reasons: string[] = []
  if (invite.link_type !== 'invite' || invite.user_id !== userId) reasons.push('existing_account')
  try {
    const { data, error } = await createServiceClient().auth.admin.getUserById(userId)
    const user = data?.user as { created_at?: string; email_confirmed_at?: string | null } | null | undefined
    if (error || !user) {
      reasons.push('account_unreadable')
    } else {
      const created = user.created_at ? new Date(user.created_at).getTime() : NaN
      if (!Number.isFinite(created) || created < new Date(invite.sent_at).getTime()) reasons.push('created_before_invitation')
      if (!user.email_confirmed_at) reasons.push('email_unconfirmed')
    }
  } catch {
    reasons.push('account_unreadable')
  }
  return { predates: reasons.length > 0, reasons }
}

/**
 * Отбирает существовавший аккаунт у прежнего держателя. Бросает при любой
 * ошибке шага: вызывающий тогда НЕ выдаёт роль.
 */
async function secureExistingAccount(userId: string, accessToken: string): Promise<void> {
  const sb = createServiceClient()
  const nowIso = new Date().toISOString()

  // 1. Пароль: случайный, никому не известный. Новый задаёт владелец почты по
  //    ссылке (/auth/reset-password) в сессии, которую ему дала ссылка.
  const pw = await sb.auth.admin.updateUserById(userId, { password: randomBytes(48).toString('base64url') })
  if (pw.error) throw new Error(`password reset: ${pw.error.message}`)

  // 2. Все ОСТАЛЬНЫЕ сессии GoTrue (refresh-токены) — в т.ч. атакующего.
  const out = await sb.auth.admin.signOut(accessToken, 'others')
  if (out.error) throw new Error(`sessions revoke: ${out.error.message}`)

  // 3. Факторы 2FA платформы (TOTP, резервные коды, ключи доступа, флаги)…
  await adminResetUserMfa(userId)
  // …и штатные факторы GoTrue, если они когда-либо заводились.
  const mfa = sb.auth.admin.mfa
  const listed = await mfa.listFactors({ userId })
  if (listed.error) throw new Error(`factors list: ${listed.error.message}`)
  for (const f of listed.data?.factors ?? []) {
    const del = await mfa.deleteFactor({ id: f.id, userId })
    if (del.error) throw new Error(`factor delete: ${del.error.message}`)
  }

  // 4. Долгоживущие доступы прежнего держателя: MCP- и OAuth-токены, Telegram.
  const mcp = await sb.from('mcp_tokens').update({ revoked_at: nowIso, revoked_by: userId }).eq('user_id', userId).is('revoked_at', null)
  if (mcp.error) throw new Error(`mcp tokens: ${mcp.error.message}`)
  const oauth = await sb.from('oauth_tokens').update({ revoked_at: nowIso, revoked_reason: 'revoked' }).eq('user_id', userId).is('revoked_at', null)
  if (oauth.error) throw new Error(`oauth tokens: ${oauth.error.message}`)
  const tgStaff = await sb.from('staff_telegram_links').delete().eq('user_id', userId)
  if (tgStaff.error) throw new Error(`staff telegram: ${tgStaff.error.message}`)
  const tgClient = await sb.from('profiles').update({ telegram_chat_id: null, telegram_link_code: null }).eq('id', userId)
  if (tgClient.error) throw new Error(`client telegram: ${tgClient.error.message}`)
}

/**
 * Приглашение принято: человек перешёл по ссылке из письма и получил сессию.
 *
 * SR-04: запись ищется по одноразовому токену приглашения (`invite=`), а не
 * по e-mail; она должна быть живой, на этот же адрес и ещё не принятой —
 * захват атомарный (status 'sent' → 'accepted'). Если аккаунт существовал до
 * приглашения, перед выдачей роли он отбирается у прежнего держателя
 * (secureExistingAccount); не вышло — роль не выдаётся, запись 'failed'.
 *
 * Никогда не бросает: вход по ссылке важнее, чем побочный учёт.
 */
export async function acceptInvitation(input: AcceptInvitationInput): Promise<AcceptInvitationResult> {
  const token = typeof input.inviteToken === 'string' ? input.inviteToken.trim() : ''
  if (!token || token.length > 200) return refusedResult('no_token')
  const normalized = normalizeEmail(input.email ?? '')
  if (!normalized) return refusedResult('bad_email')
  const { userId } = input

  const journal = (action: string, description: string, metadata: Record<string, unknown>, failure = false) =>
    logActivity({
      userId,
      action,
      category: 'security',
      severity: 'critical',
      status: failure ? 'failure' : 'success',
      description,
      metadata,
      req: input.request,
    })

  try {
    const sb = createServiceClient()
    const nowIso = new Date().toISOString()
    const { data } = await sb
      .from('platform_invitations')
      .select('id, email, staff_role, status, link_type, user_id, sent_at, expires_at')
      .eq('metadata->>accept_token_hash', hashInviteToken(token))
      .limit(1)
      .maybeSingle()

    const invite = data as InvitationRow | null
    if (!invite) return refusedResult('not_found')
    if (normalizeEmail(invite.email) !== normalized) {
      await journal('security.invite_accept_refused', 'Ссылка приглашения открыта не тем аккаунтом', { invitation_id: invite.id, reason: 'email_mismatch' }, true)
      return refusedResult('email_mismatch')
    }
    if (invite.status !== 'sent') return refusedResult('already_used')

    // Просроченную ссылку Supabase и так не примет, но статус надо закрыть.
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      await sb.from('platform_invitations').update({ status: 'expired', updated_at: nowIso }).eq('id', invite.id).eq('status', 'sent')
      return refusedResult('expired')
    }

    // Одноразовость: выигрывает только тот, кто перевёл запись из 'sent'.
    const claim = await sb
      .from('platform_invitations')
      .update({ status: 'accepted', accepted_at: nowIso, user_id: userId, updated_at: nowIso })
      .eq('id', invite.id)
      .eq('status', 'sent')
      .select('id')
    const claimed = Array.isArray(claim.data) ? claim.data.length > 0 : !!claim.data
    if (claim.error || !claimed) return refusedResult('already_used')

    const staffRole = (invite.staff_role ?? null) as StaffRole | null
    if (!staffRole) return { accepted: true, staffRole: null, secured: false }

    const { predates, reasons } = await accountPredatesInvitation(invite, userId)
    if (predates) {
      try {
        if (!input.accessToken) throw new Error('no session of the link: other sessions cannot be revoked')
        await secureExistingAccount(userId, input.accessToken)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.error('[invites] SR-04: аккаунт не удалось отобрать — роль не выдана:', message)
        await sb
          .from('platform_invitations')
          .update({ status: 'failed', last_error: `secure_failed: ${message}`.slice(0, 300), updated_at: new Date().toISOString() })
          .eq('id', invite.id)
        await journal(
          'security.invite_accept_refused',
          'Роль из приглашения не выдана: не удалось отобрать существовавший аккаунт у прежнего владельца',
          { invitation_id: invite.id, staff_role: staffRole, reasons, error: message.slice(0, 200) },
          true,
        )
        return refusedResult('secure_failed')
      }
      await journal(
        'security.invite_account_secured',
        'Аккаунт существовал до приглашения: пароль сброшен, остальные сессии, факторы 2FA и токены отозваны',
        { invitation_id: invite.id, staff_role: staffRole, reasons },
      )
    }

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
    return { accepted: true, staffRole, secured: predates }
  } catch (e) {
    console.warn('[invites] не удалось закрыть приглашение:', e instanceof Error ? e.message : e)
    return refusedResult('error')
  }
}
