/**
 * SR-07b: пояснение вместо формы смены пароля / 2FA, когда страница учётной
 * записи открыта из режима «от имени клиента» (или режим не проверен).
 * Без хуков и серверных зависимостей — годится и для серверных, и для
 * клиентских компонентов.
 */
import {
  ACCOUNT_LOCK_UNKNOWN_DETAILS,
  ACCOUNT_LOCK_UNKNOWN_MESSAGE,
  IMPERSONATION_ACCOUNT_LOCKED_DETAILS,
  IMPERSONATION_ACCOUNT_LOCKED_MESSAGE,
  type AccountLock,
} from '@/lib/impersonation/account-pages'

export default function AccountLockedNotice({ lock, className = '' }: { lock: Exclude<AccountLock, null>; className?: string }) {
  const impersonation = lock === 'impersonation'
  return (
    <div role="status" className={`rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-200 ${className}`}>
      <p className="font-semibold">{impersonation ? IMPERSONATION_ACCOUNT_LOCKED_MESSAGE : ACCOUNT_LOCK_UNKNOWN_MESSAGE}</p>
      <p className="mt-1 text-amber-200/80">{impersonation ? IMPERSONATION_ACCOUNT_LOCKED_DETAILS : ACCOUNT_LOCK_UNKNOWN_DETAILS}</p>
    </div>
  )
}
