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
import { ACCESS_REQUEST_SOURCES, isTariffAccessRequest } from '@/lib/access/upgrade-requests'
import { utcIso } from '@/lib/payments/plan-state'
import { requestSlaDueAt, requestSlaHours } from '@/lib/access/request-notices'
import { INVITE_REQUEST_SOURCE, isInviteRequestRow } from '@/lib/registration/invite-request-shared'

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
    // R4 (N4B-1): the answer deadline of a request for paid access (request_sla_hours, 4 h by default).
    const slaHours = await requestSlaHours()

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

    const seenRequestIds = new Set<string>()
    if (!arError && adminRows) {
      for (const r of adminRows) {
        // R4 B3: a request for an invitation is listed by 2c below (contact, masking).
        if (isInviteRequestRow(r)) continue
        const payload = (r.payload ?? {}) as Record<string, string>
        const uid = payload.userId
        // A request for paid access is not a registration: the client's own
        // registration row (or profile) must still be listed.
        if (uid && !isTariffAccessRequest(r)) seenUserIds.add(uid)
        if (r.id) seenRequestIds.add(String(r.id))
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

    // 2b. R2-A: requests for paid access (paywall / the old «Pro» window), read
    //     with the real columns of the Prisma-owned table ("createdAt",
    //     "rejectionReason"). Listed even when the read above fails. Category
    //     'access' → tab «Доступы»; the tariff itself is set in User 360 → Биллинг.
    const { data: tariffRows, error: tariffError } = await sb
      .from('admin_requests')
      .select('id, type, status, priority, source, payload, rejectionReason, createdAt')
      .eq('type', 'access')
      .in('source', [...ACCESS_REQUEST_SOURCES])
      .order('createdAt', { ascending: false })
      .limit(500)
    if (tariffError) console.error('[giga-admin/requests] paid-access requests read failed:', tariffError.message)
    for (const r of (tariffRows ?? []) as Array<Record<string, unknown>>) {
      if (seenRequestIds.has(String(r.id))) continue
      const payload = (r.payload ?? {}) as Record<string, unknown>
      const uid = typeof payload.userId === 'string' ? payload.userId : undefined
      const status = mapStatus(String(r.status ?? ''))
      if (!inScope(status, uid)) continue
      const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
      requests.push({
        id: r.id,
        category: 'access',
        status,
        userName: str(payload.name) ?? 'Неизвестный',
        userEmail: email(str(payload.email)),
        subject: str(payload.subject) ?? `Заявка на доступ #${String(r.id ?? '').slice(-6)}`,
        description: str(payload.description) ?? '',
        // admin_requests."createdAt" is a Prisma timestamp WITHOUT a zone (UTC): sent as ISO with «Z», otherwise the
        // browser reads it as local time and the card shows the request hours earlier than its deadline (R4 staging).
        createdAt: utcIso(r.createdAt) ?? r.createdAt,
        company: str(payload.company),
        rejectionReason: str(r.rejectionReason),
        priority: str(r.priority) ?? 'medium',
        assignedAdmin: null,
        source: str(r.source) ?? null,
        // R2-C (verify L-3): «Назначить Pro» checks the client scope of the actor
        // (as User 360 → Биллинг); a pending request of a client outside it is
        // still listed (intake queue), but the button is inactive with the reason.
        assignable: !allowed || (!!uid && allowed.includes(uid)),
        // R4 (N4B-1 / N4B-9): the card shows the answer deadline (highlighted when
        // passed) and links to the client's User 360 and «Сообщения».
        userId: uid ?? null,
        slaDueAt: status === 'pending' ? requestSlaDueAt(r.createdAt, slaHours) : null,
      })
    }

    // 2c. R4 B3 (N4B-3): requests for an invitation («Запросить приглашение»
    //     while registration is by invitation). No account yet ("userId" NULL),
    //     so neither the profiles below nor a person-based decision cover them;
    //     read with the real columns of the Prisma-owned table. Tab
    //     «Регистрация», card «Запрос приглашения»: «Отправить приглашение»
    //     (POST /requests/:id/invite) or reject / archive. E-mail and contact
    //     only with users.sensitive (WB-2 / R-133).
    //     Review W3A-7: they are seen by those who may act on them — the right
    //     to invite (as the «Отправить приглашение» button) or the whole client
    //     base; with a limited scope (R-047) only the open ones, like the rest.
    const seesInvites = hasPermission(guard.actor.role, 'users.invite') || !allowed
    const { data: inviteRows, error: inviteError } = seesInvites
      ? await sb
        .from('admin_requests')
        .select('id, type, status, priority, source, payload, rejectionReason, createdAt')
        .eq('type', 'registration')
        .eq('source', INVITE_REQUEST_SOURCE)
        .order('createdAt', { ascending: false })
        .limit(500)
      : { data: [], error: null }
    if (inviteError) console.error('[giga-admin/requests] invitation requests read failed:', inviteError.message)
    for (const r of (inviteRows ?? []) as Array<Record<string, unknown>>) {
      if (seenRequestIds.has(String(r.id))) continue
      seenRequestIds.add(String(r.id))
      const status = mapStatus(String(r.status ?? ''))
      if (!inScope(status, null)) continue
      const payload = (r.payload ?? {}) as Record<string, unknown>
      const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
      const contact = str(payload.contact)
      const hide = (v: string | undefined) => (v ? (sensitive ? v : 'скрыт') : null)
      // Review W3A-5: repeats with OTHER data than the first request — shown apart, never merged into it.
      const otherRequests = (Array.isArray(payload.otherRequests) ? payload.otherRequests : [])
        .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
        .map((o) => ({ name: str(o.name) ?? null, company: str(o.company) ?? null, contact: hide(str(o.contact)), at: str(o.at) ?? null }))
      requests.push({
        id: r.id,
        category: 'registration',
        status,
        userName: str(payload.name) ?? 'Без имени',
        userEmail: email(str(payload.email)),
        subject: str(payload.subject) ?? 'Запрос приглашения',
        description: str(payload.description) ?? '',
        createdAt: utcIso(r.createdAt) ?? r.createdAt,
        company: str(payload.company),
        rejectionReason: str(r.rejectionReason),
        priority: str(r.priority) ?? 'medium',
        assignedAdmin: null,
        source: INVITE_REQUEST_SOURCE,
        userId: null,
        contact: hide(contact),
        accountExists: payload.accountExists === true,
        repeats: typeof payload.repeats === 'number' ? payload.repeats : 1,
        otherRequests,
      })
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

    return NextResponse.json({ requests, slaHours })
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
