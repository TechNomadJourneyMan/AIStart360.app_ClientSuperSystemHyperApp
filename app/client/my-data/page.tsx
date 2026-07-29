// /client/my-data was merged into /client/point-a as the «Мои данные»
// section. This route stays as a redirect so existing links and bookmarks
// land on the correct anchor.
//
// The target depends on the approval status: /client/point-a sits behind the
// approval gate in middleware, so an unapproved client sent there would just
// bounce to the waiting room (the «Мои данные» tile in the waiting room used
// to do exactly that round trip). Until approval his answers are readable in
// the questionnaire itself, which the gate keeps open.

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function MyDataRedirect() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await sb
    .from('profiles')
    .select('status')
    .eq('id', user.id)
    .maybeSingle()

  // A status that cannot be read is treated as not approved here on purpose —
  // that is what the gate in middleware would do with it anyway.
  if (data?.status !== 'approved') redirect('/client/onboarding')

  redirect('/client/point-a#my-data')
}
