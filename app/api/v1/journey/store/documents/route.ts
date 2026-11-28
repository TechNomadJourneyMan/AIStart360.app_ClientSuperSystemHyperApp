import { NextResponse } from 'next/server'
import { getStoreJourney } from '@/lib/journey/store-handlers'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const access = await getStoreJourney(request)
  if (!access.ok) return access
  return NextResponse.json({ error: { code: 'store_documents_disabled', message: 'Загрузите и опубликуйте источник через раздел импорта магазина.' } }, {
    status: 405, headers: { 'cache-control': 'private, no-store', allow: 'OPTIONS' },
  })
}
