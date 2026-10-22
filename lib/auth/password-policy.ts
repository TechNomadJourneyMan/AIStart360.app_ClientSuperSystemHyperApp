/**
 * lib/auth/password-policy.ts — одно правило пароля и одни тексты ошибок для
 * регистрации, смены пароля в настройках и восстановления по письму.
 *
 * Раньше каждая форма проверяла по-своему (регистрация на сервере — 6 символов,
 * в форме — 8; страница восстановления не знала верхней границы), а любой отказ
 * Supabase превращался в «Не удалось сменить пароль» без причины.
 *
 * Supabase может проверять пароль строже (Auth → Policies: длина, классы
 * символов, утечки); его отказ переводится здесь в понятный русский текст.
 */

/** Минимальная длина пароля на платформе. */
export const PASSWORD_MIN = 8
/** bcrypt (Supabase Auth) учитывает только первые 72 байта. */
export const PASSWORD_MAX = 72

/** Причина отказа своим правилом, `null` — пароль подходит. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Пароль — минимум ${PASSWORD_MIN} символов`
  if (new TextEncoder().encode(password).length > PASSWORD_MAX) return `Пароль слишком длинный — не больше ${PASSWORD_MAX} символов`
  return null
}

interface AuthLikeError {
  message?: string | null
  code?: string | null
  status?: number | null
  reasons?: unknown
}

/** Короткий машинный код отказа Supabase при смене пароля. */
export type PasswordUpdateFailure =
  | 'weak_password'
  | 'same_password'
  | 'reauthentication_needed'
  | 'rate_limited'
  | 'session_expired'
  | 'update_failed'

export function classifyPasswordUpdateError(err: AuthLikeError | null | undefined): PasswordUpdateFailure {
  const code = (err?.code ?? '').toLowerCase()
  const msg = (err?.message ?? '').toLowerCase()
  // Before the weak check: «should be different from the old password».
  if (code === 'same_password' || /different from the old password|same.*password/.test(msg)) return 'same_password'
  if (code === 'weak_password' || /weak|password should (be|contain)|at least \d+ characters|pwned|leaked/.test(msg)) return 'weak_password'
  if (code === 'reauthentication_needed' || code === 'reauth_nonce_missing' || /reauthenticat/.test(msg)) return 'reauthentication_needed'
  if (code === 'over_request_rate_limit' || err?.status === 429 || /rate limit|too many/.test(msg)) return 'rate_limited'
  if (code === 'session_not_found' || code === 'session_expired' || /auth session missing|session.*(expired|not found)|jwt expired/.test(msg)) return 'session_expired'
  return 'update_failed'
}

const WEAK_REASONS: Record<string, string> = {
  length: `слишком короткий (минимум ${PASSWORD_MIN} символов)`,
  characters: 'нужны строчные и заглавные буквы, цифры и символы',
  pwned: 'встречается в утёкших базах паролей — придумайте другой',
}

/** Русский текст для кода отказа (для ответа API и для форм). */
export function passwordUpdateMessage(failure: PasswordUpdateFailure | string, reasons?: unknown): string {
  switch (failure) {
    case 'weak_password': {
      const list = Array.isArray(reasons)
        ? reasons.map((r) => WEAK_REASONS[String(r)]).filter(Boolean)
        : []
      return list.length > 0
        ? `Пароль не принят: ${list.join('; ')}.`
        : 'Пароль слишком простой. Используйте не меньше 8 символов: буквы разного регистра, цифры и символы.'
    }
    case 'same_password':
      return 'Новый пароль совпадает с текущим'
    case 'reauthentication_needed':
      return 'Для смены пароля нужно войти заново. Выйдите и войдите в аккаунт, затем повторите.'
    case 'rate_limited':
      return 'Слишком много попыток. Подождите несколько минут и попробуйте снова.'
    case 'session_expired':
      return 'Сессия истекла. Запросите новую ссылку или войдите заново.'
    case 'wrong_current_password':
      return 'Неверный текущий пароль'
    default:
      return 'Не удалось сменить пароль. Попробуйте ещё раз.'
  }
}

/** Отказ Supabase сразу текстом. */
export function passwordUpdateErrorText(err: AuthLikeError | null | undefined): string {
  return passwordUpdateMessage(classifyPasswordUpdateError(err), err?.reasons)
}
