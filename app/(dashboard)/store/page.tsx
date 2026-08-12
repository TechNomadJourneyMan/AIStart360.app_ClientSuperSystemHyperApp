export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { StoreOverviewView } from '@/components/store/StoreOverviewView'
import { loadStoreOverview } from '@/lib/store/loader'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Магазин · AIStart360',
  description: 'Продажи, маржа, цены и остатки магазина в одном контуре.',
}

export default async function StorePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const overview = await loadStoreOverview(supabase, user.id)
  return <StoreOverviewView data={overview} />
}
