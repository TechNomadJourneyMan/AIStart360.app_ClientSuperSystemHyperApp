import { describe, expect, it } from 'vitest'
import { resetPasswordErrorMessage } from '@/app/auth/reset-password/errors'
import { loginNoticeFrom } from '@/app/auth/notices'

describe('resetPasswordErrorMessage — ошибки Supabase по-русски', () => {
  it('тот же пароль', () => {
    const r = resetPasswordErrorMessage({ code: 'same_password', message: 'New password should be different from the old password.' })
    expect(r.expired).toBe(false)
    expect(r.message).toMatch(/совпадает с текущим/)
  })

  it('слабый пароль', () => {
    expect(resetPasswordErrorMessage({ code: 'weak_password', message: 'Password should contain…' }).message).toMatch(/слишком простой/)
    expect(resetPasswordErrorMessage({ message: 'Password should be at least 6 characters.' }).message).toMatch(/слишком простой/)
  })

  it('нет сессии — ссылка устарела', () => {
    for (const e of [
      { name: 'AuthSessionMissingError', message: 'Auth session missing!' },
      { code: 'session_not_found' },
      { status: 401, message: 'invalid JWT' },
    ]) {
      const r = resetPasswordErrorMessage(e)
      expect(r.expired).toBe(true)
      expect(r.message).toMatch(/устарела/)
    }
  })

  it('прочее — общий текст', () => {
    expect(resetPasswordErrorMessage(new Error('boom')).message).toMatch(/Не удалось обновить пароль/)
    expect(resetPasswordErrorMessage(null).expired).toBe(false)
  })
})

describe('loginNoticeFrom — сообщения на странице входа', () => {
  const notice = (q: string) => { const p = new URLSearchParams(q); return loginNoticeFrom((k) => p.get(k)) }
  it('заблокированный аккаунт', () => {
    expect(notice('blocked=1')?.text).toBe('Аккаунт заблокирован. Свяжитесь с поддержкой.')
  })
  it('устаревшая и битая ссылка ведут к запросу новой', () => {
    expect(notice('error=link_expired')?.action?.href).toBe('/forgot-password')
    expect(notice('error=link_invalid')?.text).toMatch(/недействительна/)
  })
  it('без параметров — ничего', () => {
    expect(notice('')).toBeNull()
    expect(notice('error=other')).toBeNull()
  })
})
