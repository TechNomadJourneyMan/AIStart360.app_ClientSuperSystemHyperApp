/**
 * lib/access/paid-access-grant.ts — what follows when staff give a client paid
 * access (R2-C, decision of the PO on M-5 / Q7).
 *
 * Every way staff assign a plan, ONE way out:
 *   • «Назначить Pro» right in the request (GIGA «Заявки» → «Доступы»,
 *     POST /api/giga-admin/requests/:id/assign-pro);
 *   • User 360 → Биллинг (PATCH /api/giga-admin/users/:id/billing);
 *   • the bulk action «Сменить тариф» (lib/admin/bulk-users.ts) and the access
 *     editor's `tier` (PATCH /api/giga-admin/users/:id/access) — R2-C review M-2.
 * Both assign the plan through lib/payments/billing.ts setPlan (audit, the same
 * RBAC) and then call completePaidAccessGrant() once:
 *   1. every OPEN request of the client for paid access (admin_requests type
 *      'access', source 'paywall' — incl. the «pilot» section — or the old
 *      'upgrade_modal') is closed as approved, each with an audit entry;
 *   2. the client gets ONE notice «Доступ открыт» — feed + e-mail + Telegram if
 *      linked (R4 N4B-2, PO 2026-11-16) — when the access was actually opened
 *      (Free before, paid now) or a request of his was closed (then, with paid
 *      access before, «Доступ продлён»). Coming from a request, the request id
 *      is the dedupe key, so the same request never notifies twice.
 * Registration requests are never touched (other type / source).
 * Never throws: the plan is already changed when this runs.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase-service'
import { logAudit } from '@/lib/audit'
import { notifyPaidAccessOpened } from '@/lib/notifications/product'
import type { EffectivePlan } from '@/lib/payments/plan-state'
import { ACCESS_REQUEST_SOURCES, OPEN_REQUEST_STATUSES } from './upgrade-requests'

/** Where the plan was assigned: User 360 → Биллинг, «Назначить Pro», the bulk action, the access editor. */
export type GrantVia = 'billing' | 'request' | 'bulk' | 'access'

export interface GrantActor {
  id: string
  kind: string
}

/** Close the client's open requests for paid access as approved; returns their ids. Throws on a DB error. */
export async function closeOpenAccessRequests(
  svc: SupabaseClient,
  userId: string,
  actor: GrantActor,
  opts: { via: GrantVia; requestId?: string | null; ipAddress?: string } = { via: 'billing' },
): Promise<string[]> {
  const { data, error } = await svc
    .from('admin_requests')
    .update({ status: 'approved', updatedAt: new Date().toISOString() })
    .eq('type', 'access')
    .in('source', [...ACCESS_REQUEST_SOURCES])
    .in('status', [...OPEN_REQUEST_STATUSES])
    .eq('payload->>userId', userId)
    .select('id')
  if (error) throw new Error(`admin_requests update failed: ${error.message}`)
  const ids = ((data ?? []) as Array<{ id: unknown }>).map((r) => String(r.id))
  await auditApproved(ids, userId, actor, opts)
  return ids
}

async function auditApproved(ids: string[], userId: string, actor: GrantActor, opts: { via: GrantVia; requestId?: string | null; ipAddress?: string }): Promise<void> {
  for (const id of ids) {
    try {
      await logAudit({
        entityType: 'request',
        entityId: id,
        action: 'request.approved',
        performedBy: actor.id,
        diff: { action: 'assign_pro', status: 'approved', userId, kind: 'paid_access', via: opts.via, actorKind: actor.kind, ...(opts.requestId ? { fromRequest: opts.requestId } : {}) },
        ipAddress: opts.ipAddress,
      })
    } catch (err) {
      console.error('[paid-access-grant] audit failed:', err instanceof Error ? err.message : err)
    }
  }
}

/**
 * R2-C (verify, L-5 race): «Назначить Pro» CLAIMS its request first — closes it
 * as approved only while it is still open (one conditional UPDATE). Of two
 * concurrent presses exactly one wins; the other gets null → 409, and the plan
 * is assigned (extended) once. If the plan then cannot be assigned, the claim
 * is undone (releaseAccessRequest).
 */
export async function claimAccessRequest(svc: SupabaseClient, requestId: string): Promise<boolean> {
  const { data, error } = await svc
    .from('admin_requests')
    .update({ status: 'approved', updatedAt: new Date().toISOString() })
    .eq('id', requestId)
    .in('status', [...OPEN_REQUEST_STATUSES])
    .select('id')
  if (error) throw new Error(`admin_requests claim failed: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

/** Undo a claim: the request is open again with its previous status. Best effort. */
export async function releaseAccessRequest(svc: SupabaseClient, requestId: string, previousStatus: string): Promise<void> {
  try {
    await svc.from('admin_requests').update({ status: previousStatus, updatedAt: new Date().toISOString() }).eq('id', requestId).eq('status', 'approved')
  } catch (err) {
    console.error('[paid-access-grant] claim not released:', err instanceof Error ? err.message : err)
  }
}

export interface GrantResult {
  /** Requests closed now (approved). */
  closed: string[]
  /** «Доступ открыт» went to the client's feed. */
  notified: boolean
  /** Closing the requests failed (the plan is changed anyway). */
  requestsError?: boolean
}

export async function completePaidAccessGrant(args: {
  userId: string
  actor: GrantActor
  before: Pick<EffectivePlan, 'accessTier'> | null
  after: Pick<EffectivePlan, 'accessTier' | 'periodEnd'> | null
  via: GrantVia
  /** The request «Назначить Pro» was pressed in (dedupe key of the notice). */
  requestId?: string | null
  /** Requests already closed by this action (claimAccessRequest): audited and counted here. */
  claimed?: string[]
  ipAddress?: string
  svc?: SupabaseClient
}): Promise<GrantResult> {
  if (!args.after || args.after.accessTier !== 'pro') return { closed: [], notified: false }
  const claimed = args.claimed ?? []
  if (claimed.length) await auditApproved(claimed, args.userId, args.actor, { via: args.via, requestId: args.requestId, ipAddress: args.ipAddress })
  let closed: string[] = [...claimed]
  let requestsError = false
  try {
    closed = closed.concat(await closeOpenAccessRequests(args.svc ?? createServiceClient(), args.userId, args.actor, { via: args.via, requestId: args.requestId, ipAddress: args.ipAddress }))
  } catch (err) {
    requestsError = true
    console.error('[paid-access-grant] requests not closed:', err instanceof Error ? err.message : err)
  }
  const opened = args.before?.accessTier !== 'pro'
  if (!opened && closed.length === 0) return { closed, notified: false, ...(requestsError ? { requestsError } : {}) }
  const key = args.requestId ?? [...closed].sort()[0] ?? null
  let notified = false
  try {
    const res = await notifyPaidAccessOpened(args.userId, { periodEnd: args.after.periodEnd ?? null, dedupeKey: key ? `paid_access_opened:${key}` : null, renewed: !opened })
    notified = res.delivered.inApp
  } catch (err) {
    console.error('[paid-access-grant] notice failed:', err instanceof Error ? err.message : err)
  }
  return { closed, notified, ...(requestsError ? { requestsError } : {}) }
}
