export const dynamic = 'force-dynamic'

// Expert-side ExpertCase management for a specific client (§ smart-assistant).
//   GET   — list the client's escalation cases (status/priority/detected_issues/
//           assistant_recommendation). Staff-only.
//   PATCH — expert updates a single case (status new→in_progress→resolved→closed,
//           priority, assigned_to, expert_action_recommended) via service role,
//           then notifies the client ('expert_case_updated') that an expert engaged.
// Reads/writes go through the service role (RLS bypass) after requireExpert().
// The client reads their own cases via session-scoped routes — never this one.

import { NextRequest, NextResponse } from 'next/server'
import { requireExpert, srGet } from '@/lib/expert-auth'
import { notifyUser, notifyAdmins } from '@/lib/notifications'
import type { ExpertCase } from '@/lib/assistant/types'

// Allowed enum values — must mirror the CHECK constraints in migration 032.
const STATUSES = new Set<ExpertCase['status']>(['new', 'in_progress', 'resolved', 'closed'])
const PRIORITIES = new Set<ExpertCase['priority']>(['low', 'medium', 'high', 'critical'])

// Service-role REST write helper — bypasses owner-write RLS (same srBase/key
// pattern as lib/expert-auth.ts srGet, but adds a PATCH; mirrors comments/[id]).
function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  }
}

async function srFetch(method: string, path: string, body?: unknown): Promise<Response | null> {
  const { url, key } = srBase()
  if (!url || !key) return null
  return fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
}

// GET /api/expert/clients/[id]/expert-cases — list cases for one client
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const viewer = await requireExpert()
  if (!viewer) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  const clientId = params.id
  if (!clientId) return NextResponse.json({ ok: false, error: 'client id required' }, { status: 400 })

  const rows = await srGet<Array<Record<string, unknown>>>(
    `expert_cases?user_id=eq.${clientId}` +
      '&select=id,user_id,company_id,diagnostic_id,status,priority,trigger_type,title,summary,' +
      'detected_issues,user_message,assistant_recommendation,expert_action_recommended,assigned_to,' +
      'created_at,updated_at&order=created_at.desc',
  )
  if (!rows) return NextResponse.json({ ok: false, error: 'failed to load cases' }, { status: 500 })

  return NextResponse.json({ ok: true, data: rows })
}

// PATCH /api/expert/clients/[id]/expert-cases
//   body: { caseId, status?, priority?, assigned_to?, expert_action_recommended? }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const viewer = await requireExpert()
  if (!viewer) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  const clientId = params.id
  if (!clientId) return NextResponse.json({ ok: false, error: 'client id required' }, { status: 400 })

  let body: {
    caseId?: string
    status?: string
    priority?: string
    assigned_to?: string | null
    expert_action_recommended?: string | null
  } | null
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
  }

  const caseId = String(body?.caseId ?? '').trim()
  if (!caseId) return NextResponse.json({ ok: false, error: 'caseId required' }, { status: 400 })

  // Build the patch from only the provided, validated fields.
  const patch: Record<string, unknown> = {}

  if (body?.status !== undefined) {
    if (!STATUSES.has(body.status as ExpertCase['status']))
      return NextResponse.json({ ok: false, error: 'invalid status' }, { status: 400 })
    patch.status = body.status
  }

  if (body?.priority !== undefined) {
    if (!PRIORITIES.has(body.priority as ExpertCase['priority']))
      return NextResponse.json({ ok: false, error: 'invalid priority' }, { status: 400 })
    patch.priority = body.priority
  }

  if (body?.assigned_to !== undefined) {
    patch.assigned_to = body.assigned_to === null ? null : String(body.assigned_to).trim() || null
  }

  if (body?.expert_action_recommended !== undefined) {
    const action = body.expert_action_recommended
    if (action === null) {
      patch.expert_action_recommended = null
    } else {
      const txt = String(action).trim()
      if (txt.length > 8000)
        return NextResponse.json({ ok: false, error: 'expert_action_recommended too long' }, { status: 400 })
      patch.expert_action_recommended = txt
    }
  }

  if (Object.keys(patch).length === 0)
    return NextResponse.json({ ok: false, error: 'no fields to update' }, { status: 400 })

  // Scope the update to this client's case (id AND user_id) so an expert cannot
  // mutate a case that belongs to a different client via a mismatched caseId.
  // updated_at is maintained by the DB trigger (set_updated_at).
  const upd = await srFetch(
    'PATCH',
    `expert_cases?id=eq.${encodeURIComponent(caseId)}&user_id=eq.${encodeURIComponent(clientId)}`,
    patch,
  )
  if (!upd?.ok) return NextResponse.json({ ok: false, error: 'failed to update' }, { status: 500 })

  const updatedRows = (await upd.json().catch(() => null)) as Array<Record<string, unknown>> | null
  const updated = Array.isArray(updatedRows) ? updatedRows[0] : null
  if (!updated) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })

  // Notify the client that an expert engaged with their case. notifyUser falls
  // back to admin channels if the client has no email/telegram; fire-and-forget.
  try {
    await notifyUser(clientId, 'expert_case_updated', {
      caseId,
      title: updated.title ?? null,
      status: updated.status ?? null,
      priority: updated.priority ?? null,
    })
  } catch (err) {
    console.error('[expert/expert-cases] notifyUser failed:', err)
    notifyAdmins('expert_case_updated', { caseId, status: updated.status ?? null }, clientId)
  }

  return NextResponse.json({ ok: true, data: updated })
}
