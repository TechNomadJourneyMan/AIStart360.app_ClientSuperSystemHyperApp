export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import { CLIENT_DASHBOARD_PATH } from '@/lib/role-landing'

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

/**
 * POST /api/giga-admin/impersonate
 * Generates a magic link to log in as the specified user.
 * Admin opens the link in a new tab to see the platform as the client.
 */
export async function POST(req: NextRequest) {
  const actor = await getGigaActor(req)
  if (!actor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { userId, redirectTo } = await req.json() as { userId: string; redirectTo?: string }
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
        redirectTo: `${req.nextUrl.origin}${redirectTo || CLIENT_DASHBOARD_PATH}`,
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

    // A8: audit the impersonation. Best-effort — must attempt, never block.
    // performedBy is the ACTOR (the admin), never the target: audit records that
    // point at the impersonated user made incidents unattributable (R6).
    try {
      await logAudit({
        entityType: 'user',
        entityId: userId,
        action: 'user.impersonated',
        performedBy: actor.id,
        diff: {
          actorKind: actor.kind,
          target: { id: userId, email: profile.email },
          redirectTo: redirectTo || CLIENT_DASHBOARD_PATH,
        },
        ipAddress: clientIp(req),
      })
    } catch (auditErr) {
      console.error('[impersonate] audit log failed:', auditErr)
    }

    return NextResponse.json({ ok: true, url: actionLink })
  } catch (error) {
    console.error('[impersonate] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
