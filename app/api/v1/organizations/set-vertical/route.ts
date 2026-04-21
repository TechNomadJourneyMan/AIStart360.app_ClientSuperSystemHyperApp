export const dynamic = 'force-dynamic'

// POST /api/v1/organizations/set-vertical  body: { vertical: 'generic' | 'medical' }
// Writes the authenticated user's own profiles.vertical. Used by the Welcome
// screen and by /settings/business-type. Admin override via Гига-Панель is a
// separate endpoint (/api/giga-admin/...) — don't reuse this one for that.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { isValidVerticalId } from '@/lib/verticals'

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  }
}

export async function POST(req: NextRequest) {
  // Auth: user must be signed in. We update only their own row.
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let body: { vertical?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const vertical = body.vertical
  if (!isValidVerticalId(vertical)) {
    return NextResponse.json(
      { error: `unknown vertical: ${String(vertical)}` },
      { status: 400 },
    )
  }

  // Service-role PATCH — profiles RLS is tight around self-edits and the
  // column has no dedicated update policy yet.
  const { url, key } = srBase()
  try {
    const res = await fetch(`${url}/rest/v1/profiles?id=eq.${user.id}`, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ vertical }),
      cache: 'no-store',
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      console.error('[set-vertical] patch failed', res.status, txt)
      return NextResponse.json({ error: 'failed to update' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, vertical })
  } catch (e) {
    console.error('[set-vertical] exception', e)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
