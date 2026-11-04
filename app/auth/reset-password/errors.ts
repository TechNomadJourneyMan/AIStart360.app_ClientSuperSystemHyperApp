/**
 * Ошибки Supabase при смене пароля → понятный русский текст.
 * `expired: true` — сессии из ссылки больше нет: форму показывать бессмысленно,
 * нужна новая ссылка.
 */
export interface ResetPasswordError {
  message: string
  expired: boolean
}

interface AuthErrorLike {
  name?: string
  code?: string
  status?: number
  message?: string
}

export function resetPasswordErrorMessage(error: unknown): ResetPasswordError {
  const e = (error ?? {}) as AuthErrorLike
  const code = typeof e.code === 'string' ? e.code : ''
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''

  if (code === 'same_password' || msg.includes('should be different from the old password')) {
    return { message: 'Новый пароль совпадает с текущим. Придумайте другой.', expired: false }
  }
  if (code === 'weak_password' || msg.includes('password should') || msg.includes('weak password')) {
    return {
      message: 'Пароль слишком простой. Используйте не меньше 8 символов, буквы разного регистра и цифры.',
      expired: false,
    }
  }
  if (
    e.name === 'AuthSessionMissingError' ||
    code === 'session_not_found' ||
    code === 'session_expired' ||
    code === 'refresh_token_not_found' ||
    code === 'reauthentication_needed' ||
    msg.includes('auth session missing') ||
    e.status === 401 ||
    e.status === 403
  ) {
    return { message: 'Ссылка устарела — запросите новую.', expired: true }
  }
  if (code === 'over_request_rate_limit' || e.status === 429) {
    return { message: 'Слишком много попыток. Подождите минуту и попробуйте снова.', expired: false }
  }
  return { message: 'Не удалось обновить пароль. Попробуйте снова.', expired: false }
}
