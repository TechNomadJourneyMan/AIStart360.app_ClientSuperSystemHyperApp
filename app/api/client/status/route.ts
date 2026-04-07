export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/client/status?userId=xxx
 * Returns profile approval status using service role (bypasses RLS).
 * Uses direct REST API call to avoid Supabase SDK issues with RLS infinite recursion.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')
    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    const res = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=status`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        cache: 'no-store',
      }
    )

    if (!res.ok) {
      console.error('[client/status] REST API error:', res.status, await res.text())
      return NextResponse.json({ status: 'pending_approval' })
    }

    const rows = await res.json() as Array<{ status: string }>
    const status = rows[0]?.status || 'pending_approval'
    return NextResponse.json({ status })
  } catch (error) {
    console.error('[client/status] error:', error)
    return NextResponse.json({ status: 'pending_approval' })
  }
}
