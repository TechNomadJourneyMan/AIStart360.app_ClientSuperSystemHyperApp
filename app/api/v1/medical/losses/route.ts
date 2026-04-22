/**
 * GET /api/v1/medical/losses
 * Returns revenue_losses rows for the current client.
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
    .from('revenue_losses')
    .select('*')
    .eq('client_id', user.id)
    .order('estimated_loss_kzt', { ascending: false })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const rows = data ?? []
  const total = rows.reduce((s: number, r: { estimated_loss_kzt: number }) => s + r.estimated_loss_kzt, 0)

  return NextResponse.json({ ok: true, data: rows, total_loss_kzt: total })
}
