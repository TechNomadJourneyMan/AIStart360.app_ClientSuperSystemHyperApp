import type { Metadata } from 'next'
import { unstable_noStore as noStore } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { StoreJourneyView } from '@/components/journey/StoreJourneyView'
import { buildStoreJourneyState } from '@/lib/journey/store-seed'
import { MFA_COOKIE_NAME } from '@/lib/mfa/step-up'
import { createClient } from '@/lib/supabase/server'
import { hasStoreMfaStepUp, resolveStoreAccess } from '@/lib/store/access'
import { loadStoreOverview } from '@/lib/store/loader'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = {
  title: 'Магазин · Journey',
  description: 'Опубликованные показатели интернет-магазина в управленческом пути AIStart360 Journey.',
  robots: { index: false, follow: false },
}

export default async function StoreJourneyPage() {
  noStore()
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login?from=%2Fclient%2Fjourney%2Fstore')
  }

  if (!hasStoreMfaStepUp(user, cookies().get(MFA_COOKIE_NAME)?.value)) {
    redirect('/2fa?from=%2Fclient%2Fjourney%2Fstore')
  }

  const access = await resolveStoreAccess(supabase, user.id)
  if (access !== 'allowed') {
    redirect('/dashboard')
  }

  const overview = await loadStoreOverview(supabase, user.id)
  const state = buildStoreJourneyState(overview, {
    workspaceId: `store-journey-${user.id}`,
  })

  return <StoreJourneyView state={state} overview={overview} />
}
