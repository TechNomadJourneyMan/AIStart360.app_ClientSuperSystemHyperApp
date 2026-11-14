import { Suspense } from 'react'
import { getRequestUser } from '@/lib/request-user'
import { accountLockForThisSession } from '@/lib/impersonation/account-lock'
import AccountLockedNotice from '@/components/impersonation/AccountLockedNotice'
import ResetPasswordForm from './ResetPasswordForm'

// Avoid static prerender: the Supabase browser client requires env vars that
// are not present at build time. Forcing dynamic rendering prevents the
// "@supabase/ssr: Your project's URL and API key are required" crash. The
// session check below needs the request cookies anyway.
export const dynamic = 'force-dynamic'

/**
 * SR-07b: the form sets a new password with supabase.auth.updateUser straight
 * from the browser — with ANY live session, no current password asked. During
 * an impersonation that session is the client's, so staff could take the
 * account over. middleware.ts redirects away first; this is the second line:
 * the form is not rendered for an impersonation session or when that cannot
 * be told now (fail closed). An ordinary visitor (signed in by the recovery
 * link, or not yet — hash links sign in in the browser) gets the form.
 */
export default async function ResetPasswordPage() {
  // The verified user narrows the check to this account's impersonation; when
  // it cannot be read, any impersonation of this browser session counts.
  let userId: string | null = null
  try { userId = (await getRequestUser())?.id ?? null } catch { /* stricter: any user */ }
  const lock = await accountLockForThisSession(userId)
  if (lock) {
    return (
      <div className="glass-card rounded-2xl p-8 shadow-modal">
        <h1 className="font-headline text-2xl font-bold text-on-surface mb-4">Новый пароль</h1>
        <AccountLockedNotice lock={lock} />
      </div>
    )
  }
  return (
    <Suspense fallback={<div className="glass-card rounded-2xl p-8 shadow-modal">Загрузка...</div>}>
      <ResetPasswordForm />
    </Suspense>
  )
}
