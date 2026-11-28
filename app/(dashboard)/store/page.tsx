export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import MyHonorIntegrationStatus from '@/components/store/MyHonorIntegrationStatus'
import { StoreAccessNotice } from '@/components/store/StoreAccessNotice'
import { authorizeStore } from '@/lib/store/request'
import { StoreOverviewView } from '@/components/store/StoreOverviewView'
import { loadStoreOverview } from '@/lib/store/loader'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Магазин · AIStart360',
  description: 'Продажи, маржа, цены и остатки магазина в одном контуре.',
}

export default async function StorePage({ searchParams }: { searchParams?: { companyId?: string } }) {
  const supabase = await createClient()
  const access = await authorizeStore(supabase, searchParams?.companyId)
  if (!access.ok) {
    if (access.error.status === 401) redirect('/login?from=%2Fstore')
    return <StoreAccessNotice error={access.error} path="/store" />
  }
  const overview = await loadStoreOverview(supabase, access.userId, access.company.id)
  const honorLinked = process.env.MYHONOR_ANALYTICS_USER_ID?.trim().toLowerCase() === access.userId.toLowerCase()
    && process.env.MYHONOR_ANALYTICS_COMPANY_ID?.trim() === access.company.id
  return (
    <StoreOverviewView data={overview} companyId={access.company.id} honorLinked={honorLinked}
      integration={honorLinked ? <MyHonorIntegrationStatus key={access.company.id} companyId={access.company.id} /> : undefined} />
  )
}
