export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

function isSuperAdmin(req: NextRequest): boolean {
  return req.cookies.get('aistart360_role')?.value === 'super_admin'
}

/**
 * POST /api/giga-admin/impersonate
 * Generates a magic link to log in as the specified user.
 * Admin opens the link in a new tab to see the platform as the client.
 */
export async function POST(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { userId } = await req.json() as { userId: string }
    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }

    const sb = createServerClient()

    // Get user email from profiles
    const { data: profile } = await sb
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single()

    if (!profile?.email) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Generate magic link via Supabase Admin API
    const { data, error } = await sb.auth.admin.generateLink({
      type: 'magiclink',
      email: profile.email,
      options: {
        redirectTo: `${req.nextUrl.origin}/client/dashboard`,
      },
    })

    if (error) {
      console.error('[impersonate] generateLink error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // The magic link contains the token — extract and build URL
    const actionLink = data?.properties?.action_link
    if (!actionLink) {
      return NextResponse.json({ error: 'Failed to generate link' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, url: actionLink })
  } catch (error) {
    console.error('[impersonate] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
