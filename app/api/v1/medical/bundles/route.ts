/**
 * GET /api/v1/medical/bundles
 * Returns 9 growth_bundles rows ordered by priority for BundlesRoadmap.
 */

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user?.id) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data, error } = await sb
    .from('growth_bundles')
    .select('*')
    .eq('client_id', user.id)
    .order('priority', { ascending: true })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, data: data ?? [] })
}
