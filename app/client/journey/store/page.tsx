import type { Metadata } from 'next'
import { unstable_noStore as noStore } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { authorizeStore } from '@/lib/store/request'
import { loadStoreOverview } from '@/lib/store/loader'
import { StoreAccessNotice } from '@/components/store/StoreAccessNotice'
import { StoreJourneyWorkspace } from '@/components/journey/StoreJourneyWorkspace'
import { buildStoreJourneyState } from '@/lib/journey/store-seed'
import { storeJourneyWorkspaceId } from '@/lib/journey/store-persistence'
import { storeHref } from '@/lib/store/links'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata: Metadata = {
  title: 'Магазин · Путь A → B',
  description: 'Путь от опубликованных показателей магазина к подтверждённой цели.',
  robots: { index: false, follow: false },
}

export default async function StoreJourneyPage({ searchParams }: { searchParams?: { companyId?: string } }) {
  noStore()
  const supabase = await createClient()
  const access = await authorizeStore(supabase, searchParams?.companyId)
  if (!access.ok) {
    const path = storeHref('/client/journey/store', searchParams?.companyId)
    if (access.error.status === 401) redirect(`/login?from=${encodeURIComponent(path)}`)
    return <StoreAccessNotice error={access.error} path={path} />
  }
  const overview = await loadStoreOverview(supabase, access.userId, access.company.id)
  const state = buildStoreJourneyState(overview, { workspaceId: storeJourneyWorkspaceId(access.userId, access.company.id) })
  return <StoreJourneyWorkspace key={access.company.id} initialState={state} companyId={access.company.id} />
}
