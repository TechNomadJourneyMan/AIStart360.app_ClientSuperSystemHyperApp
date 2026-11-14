export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireGiga } from '@/lib/admin/giga-actor'
import { dbError } from '@/lib/api-error'
import { hasPermission } from '@/lib/admin/rbac'
import { maskEmail } from '@/lib/admin/mask'
import { scopedClientIds } from '@/lib/admin/client-scope'
import { parseJsonBody } from '@/lib/validation/http'
import { GigaAdminRequestBody } from '@/lib/validation/schemas'

function mapStatus(s: string): 'pending' | 'approved' | 'rejected' | 'archived' {
  if (s === 'approved') return 'approved'
  if (s === 'rejected') return 'rejected'
  if (s === 'archived') return 'archived'
  return 'pending'
}

/**
 * GET /api/giga-admin/requests
 * Reads directly from Supabase: profiles (clients) + admin_requests fallback.
 *
 * Without users.sensitive (analyst) the e-mail is masked like everywhere else
 * in GIGA (lib/admin/mask.ts, R-133). With client scope 'assigned' (R-047)
 * decided requests are limited to the actor's clients; pending ones stay
 * visible — they are the intake queue and have no assignee yet.
 */
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response
  const sensitive = hasPermission(guard.actor.role, 'users.sensitive')
  const email = (v: string | null | undefined) => (sensitive ? v ?? '—' : maskEmail(v) ?? '—')
  const allowed = await scopedClientIds(guard.actor)
  const inScope = (status: string, userId: string | null | undefined) =>
    !allowed || status === 'pending' || (!!userId && allowed.includes(userId))

  try {
    // Service-role: giga cookie has no Supabase session; anon client hits RLS
    // and returns [] for both profiles and admin_requests. authz is on isGigaSuperAdmin().
    const sb = createServiceClient()

    // 1. Try admin_requests table first
    const { data: adminRows, error: arError } = await sb
      .from('admin_requests')
      .select('*')
      .order('created_at', { ascending: false })

    // 2. Always load client profiles as source of truth
    const { data: profiles } = await sb
      .from('profiles')
      .select('id, email, full_name, organization, status, role, created_at')
      .eq('role', 'client')
      .order('created_at', { ascending: false })

    // Build requests from admin_requests if table exists
    const requests: Array<Record<string, unknown>> = []
    const seenUserIds = new Set<string>()

    if (!arError && adminRows) {
      for (const r of adminRows) {
        const payload = (r.payload ?? {}) as Record<string, string>
        const uid = payload.userId
        if (uid) seenUserIds.add(uid)
        if (!inScope(mapStatus(r.status), uid)) continue
        requests.push({
          id: r.id,
          category: (r.type ?? 'registration').toLowerCase(),
          status: mapStatus(r.status),
          userName: payload.name ?? 'Неизвестный',
          userEmail: email(payload.email),
          subject: payload.subject ?? `Заявка #${r.id?.slice(-6) ?? ''}`,
          description: payload.description ?? '',
          createdAt: r.created_at,
          company: payload.company ?? undefined,
          rejectionReason: r.rejection_reason ?? undefined,
          priority: r.priority ?? 'medium',
          assignedAdmin: null,
          source: r.source ?? null,
        })
      }
    }

    // 3. Add profiles not yet in admin_requests (orphaned registrations)
    if (profiles) {
      for (const p of profiles) {
        if (seenUserIds.has(p.id)) continue
        const status = mapStatus(p.status === 'pending_approval' ? 'pending' : p.status)
        if (!inScope(status, p.id)) continue
        requests.push({
          id: p.id,
          category: 'registration',
          status,
          userName: p.full_name ?? email(p.email),
          userEmail: email(p.email),
          subject: `Регистрация: ${p.full_name ?? email(p.email)}`,
          description: `Клиент зарегистрирован ${new Date(p.created_at).toLocaleDateString('ru-RU')}`,
          createdAt: p.created_at,
          company: p.organization ?? undefined,
          rejectionReason: undefined,
          priority: 'medium',
          assignedAdmin: null,
          source: 'supabase_profile',
        })
      }
    }

    // Sort by date desc
    requests.sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime())

    return NextResponse.json({ requests })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[giga-admin/requests] GET error:', msg)
    return NextResponse.json({ error: `Server error: ${msg.slice(0, 200)}` }, { status: 500 })
  }
}

/**
 * POST /api/giga-admin/requests
 * Creates a new request via Supabase.
 */
export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, 'users.manage')
  if (guard.response) return guard.response

  // R-149: the body through Zod (type / priority — the Prisma enums; unknown keys refused).
  const parsed = await parseJsonBody(req, GigaAdminRequestBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  try {
    const sb = createServiceClient()
    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    const { error } = await sb.from('admin_requests').insert({
      id,
      type: body.type,
      status: 'new',
      priority: body.priority,
      source: body.source,
      payload: body.payload,
      // Prisma-owned table: quoted camelCase columns (as in client/register, lib/users/access-requests.ts).
      // The old created_at / updated_at made every POST fail.
      createdAt: now,
      updatedAt: now,
    })

    if (error) {
      return dbError('giga-admin/requests', error)
    }
    return NextResponse.json({ request: { id } }, { status: 201 })
  } catch (error) {
    console.error('[giga-admin/requests] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
