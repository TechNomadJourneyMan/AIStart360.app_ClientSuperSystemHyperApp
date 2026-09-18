export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSetting } from '@/lib/settings/store'

// GET /api/v1/platform/maintenance — public status for the /maintenance page.
export async function GET() {
  const m = await getSetting('maintenance', { fresh: true }).catch((e) => {
    console.error('[maintenance] settings read failed:', e instanceof Error ? e.message : e)
    return null
  })
  return NextResponse.json(
    { ok: true, enabled: !!m?.enabled, message: m?.enabled ? m.message : '', until: m?.enabled ? m.until : '' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
