export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

/**
 * GET /api/client/status?userId=xxx
 * Returns profile approval status using service role (bypasses RLS)
 */
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')
    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }

    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single()

    if (error) {
      return NextResponse.json({ status: 'pending_approval' })
    }

    return NextResponse.json({ status: data?.status || 'pending_approval' })
  } catch (error) {
    console.error('[client/status] error:', error)
    return NextResponse.json({ status: 'pending_approval' })
  }
}
