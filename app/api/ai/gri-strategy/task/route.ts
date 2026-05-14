export const dynamic = 'force-dynamic'

/**
 * POST /api/ai/gri-strategy/task
 * Body: { taskId: string, done: boolean }
 *
 * Maintains profiles.branding.gri_strategy.completed_tasks (string[]) —
 * task ids in the form "days_30:0" / "days_60:2" / "days_90:5".
 * Idempotent: setting done=true is fine even if already in the list.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

function getServiceCreds() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  }
}

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let body: { taskId?: string; done?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }) }

  const taskId = (body.taskId ?? '').toString()
  const done = Boolean(body.done)
  if (!/^days_(30|60|90):\d+$/.test(taskId)) {
    return NextResponse.json({ error: 'invalid taskId format' }, { status: 400 })
  }

  const { url, key } = getServiceCreds()
  const H = { apikey: key, Authorization: `Bearer ${key}` }

  // Read current branding
  let branding: Record<string, unknown> = {}
  try {
    const r = await fetch(`${url}/rest/v1/profiles?id=eq.${user.id}&select=branding`, { headers: H, cache: 'no-store' })
    if (r.ok) {
      const rows = await r.json() as Array<{ branding: Record<string, unknown> | null }>
      branding = rows[0]?.branding ?? {}
    }
  } catch {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
  }

  const gs = (branding.gri_strategy as Record<string, unknown> | undefined) ?? {}
  const existing = Array.isArray(gs.completed_tasks) ? (gs.completed_tasks as string[]) : []
  const set = new Set(existing)
  if (done) set.add(taskId); else set.delete(taskId)
  const completed_tasks = Array.from(set)

  const nextBranding = { ...branding, gri_strategy: { ...gs, completed_tasks } }

  try {
    const r = await fetch(`${url}/rest/v1/profiles?id=eq.${user.id}`, {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ branding: nextBranding }),
    })
    if (!r.ok) {
      return NextResponse.json({ error: 'persist_failed', status: r.status }, { status: 500 })
    }
  } catch (e) {
    return NextResponse.json({ error: 'patch_failed', detail: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }

  return NextResponse.json({ ok: true, completed_tasks })
}
