import { createServiceClient } from '@/lib/supabase-service'
import { sendNotificationEmail } from '@/lib/email'
import { getSiteUrl } from '@/lib/site-url'

/**
 * lib/admin/invites.ts — приглашение на платформу письмом с нашего домена.
 *
 * Почему не штатный invite Supabase: он шлёт письмо по своему шаблону и ведёт
 * на Site URL проекта, который сейчас указывает на посторонний домен (проверено
 * пробой generate_link: любой запрошенный адрес подменяется). Поэтому здесь
 * берём только одноразовый токен, а ссылку и письмо формируем сами — так
 * приглашение всегда приземляется в нашем кабинете.
 */

export type InviteOutcome = 'invited' | 'relinked' | 'failed'

export interface InviteResult {
  email: string
  outcome: InviteOutcome
  /** Что показать в панели рядом с адресом. */
  message: string
}

export interface InviteInput {
  email: string
  /** Куда отправить после установки пароля/входа. */
  next?: string
  /** Личная строка от пригласившего — попадёт в письмо. */
  note?: string | null
  /** Подпись отправителя в письме (email сотрудника). */
  invitedByLabel?: string | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return EMAIL_RE.test(email) && email.length <= 200 ? email : null
}

/** Разбирает список адресов из textarea: запятые, точки с запятой, переводы строк. */
export function parseEmailList(raw: string): { emails: string[]; invalid: string[] } {
  const parts = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
  const emails: string[] = []
  const invalid: string[] = []
  for (const part of parts) {
    const email = normalizeEmail(part)
    if (!email) invalid.push(part)
    else if (!emails.includes(email)) emails.push(email)
  }
  return { emails, invalid }
}

/** Уже заходил ли человек на платформу (тогда шлём ссылку для входа, а не приглашение). */
async function alreadyRegistered(email: string): Promise<boolean> {
  try {
    const { data } = await createServiceClient()
      .from('profiles')
      .select('id')
      .ilike('email', email)
      .maybeSingle()
    return !!data
  } catch {
    return false
  }
}

export async function sendPlatformInvite(input: InviteInput): Promise<InviteResult> {
  const email = normalizeEmail(input.email)
  if (!email) return { email: input.email, outcome: 'failed', message: 'Некорректный адрес' }

  const existing = await alreadyRegistered(email)
  const type = existing ? 'magiclink' : 'invite'

  let tokenHash: string | undefined
  try {
    const { data, error } = await createServiceClient().auth.admin.generateLink({ type, email })
    if (error) throw new Error(error.message)
    tokenHash = data?.properties?.hashed_token
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось создать приглашение'
    return { email, outcome: 'failed', message }
  }
  if (!tokenHash) return { email, outcome: 'failed', message: 'Supabase не вернул ссылку' }

  // Новый человек сначала задаёт пароль; уже знакомый попадает сразу в кабинет.
  const next = input.next || (existing ? '/dashboard' : '/auth/reset-password')
  const url = new URL('/auth/verify', getSiteUrl())
  url.searchParams.set('token_hash', tokenHash)
  url.searchParams.set('type', type)
  url.searchParams.set('next', next)

  const from = input.invitedByLabel ? ` от ${input.invitedByLabel}` : ''
  const note = input.note?.trim()
  try {
    await sendNotificationEmail({
      to: email,
      subject: existing ? 'Ссылка для входа в AIStart360' : 'Приглашение в AIStart360',
      title: existing ? 'Вход в кабинет' : `Вас пригласили в AIStart360${from}`,
      body: [
        existing
          ? 'Нажмите кнопку, чтобы войти в кабинет без пароля.'
          : 'AIStart360 — платформа диагностики и роста бизнеса. Нажмите кнопку, задайте пароль и начните с анкеты: по ней собирается «Точка А» и GRI-оценка.',
        note ? `\n\nСообщение${from}: «${note}»` : '',
        '\n\nСсылка действует один час и срабатывает один раз. Если вы не ждали это письмо — просто проигнорируйте его.',
      ].join(''),
      ctaLabel: existing ? 'Войти в кабинет' : 'Принять приглашение',
      ctaUrl: url.toString(),
    })
  } catch (e) {
    return { email, outcome: 'failed', message: e instanceof Error ? e.message : 'Письмо не отправилось' }
  }

  return existing
    ? { email, outcome: 'relinked', message: 'Аккаунт уже был — отправлена ссылка для входа' }
    : { email, outcome: 'invited', message: 'Приглашение отправлено' }
}
