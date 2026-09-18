export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { isClientEvent } from '@/lib/events/registry'
import { toEventRow } from '@/lib/events/track'
import { activeImpersonation } from '@/lib/impersonation/server'
import { getSetting } from '@/lib/settings/store'

// POST /api/v1/events — browser analytics batch for the SESSION user.
// Only events the registry marks as client-sendable are stored; anything else
// in the batch is dropped silently (never an error: analytics must not break UI).
const bodySchema = z.object({
  events: z.array(z.object({
    name: z.string().max(64),
    page: z.string().max(500).optional(),
    entity_type: z.string().max(40).optional(),
    entity_id: z.string().max(80).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    session_id: z.string().max(64).optional(),
  })).min(1).max(20),
})

const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let raw: unknown
  try {
    // sendBeacon posts text/plain-ish blobs; parse the body ourselves.
    raw = JSON.parse(await req.text())
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })

  if (await isRateLimitedKey(user.id, 'events', { max: 240, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  const [imp, analyticsEnabled] = await Promise.all([activeImpersonation(user.id), getSetting('analytics_enabled')])
  // Behavioural analytics switched off in platform settings: accept and drop.
  const rows = (analyticsEnabled ? parsed.data.events : [])
    .filter((e) => isClientEvent(e.name))
    .map((e) => toEventRow({
      userId: user.id,
      name: e.name as Parameters<typeof toEventRow>[0]['name'],
      page: e.page,
      entityType: e.entity_type,
      entityId: e.entity_id,
      metadata: e.metadata,
      sessionId: e.session_id,
      // An admin browsing the cabinet is not the user's own activity.
      source: imp ? 'impersonation' : 'web',
      impersonationSessionId: imp?.sid ?? null,
    }))

  const service = createServiceClient()
  if (rows.length) {
    const { error } = await service.from('user_events').insert(rows)
    if (error) console.error('[events] batch insert failed:', error.message)
  }

  if (!imp) {
    const threshold = new Date(Date.now() - LAST_SEEN_THROTTLE_MS).toISOString()
    await service
      .from('profiles')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', user.id)
      .or(`last_seen_at.is.null,last_seen_at.lt.${threshold}`)
  }

  return NextResponse.json({ ok: true, accepted: rows.length })
}
