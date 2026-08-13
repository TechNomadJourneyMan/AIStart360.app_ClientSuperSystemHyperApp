import { getStoreJourney, patchStoreJourney } from '@/lib/journey/store-handlers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = getStoreJourney
export const PATCH = patchStoreJourney
