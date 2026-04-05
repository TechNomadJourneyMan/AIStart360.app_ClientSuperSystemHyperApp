import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(req: Request) {
  try {
    const sb = createServerClient()
    const { userId, status } = await req.json()

    if (!userId || !status) {
      return NextResponse.json({ ok: false, error: 'Missing userId or status' }, { status: 400 })
    }

    // Only allow valid statuses to be set using this route
    if (!['approved', 'rejected', 'pending_approval'].includes(status)) {
       return NextResponse.json({ ok: false, error: 'Invalid status' }, { status: 400 })
    }

    const { data, error } = await sb
      .from('profiles')
      .update({ status })
      .eq('id', userId)

    if (error) throw error

    return NextResponse.json({ ok: true, data })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
