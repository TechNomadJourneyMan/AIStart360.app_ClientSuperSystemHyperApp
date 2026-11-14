/**
 * lib/notifications/expert-audience.ts — who of the expert audience may hear
 * about ONE client (SR-17).
 *
 * Expert notices (expert bot, WhatsApp copies, report review requests) name a
 * client: company, score, findings, a PDF. They may only reach people who may
 * read that client under the rule of migration 140 (lib/access/actor.ts):
 *   • the person is admitted to the expert bot (isExpertBotActor): an active
 *     expert, a staff Admin / Super Admin, or a staff SuperExpert — approved,
 *     staff only from staff_roles (a legacy profiles.role admin / super_admin
 *     without a staff_roles row is nobody here);
 *   • scope 'all' (super_admin / admin always; super_expert with
 *     client_scope 'all') hears about every client; scope 'assigned' (an
 *     expert, a super_expert limited to assigned clients) only about the
 *     client whose user_assignments.assignee_id is them.
 * A notice without a client is for scope 'all' only. Reads go through the
 * server Postgres connection like the senders; any read error fails CLOSED
 * (nobody is notified, the error is logged).
 */
import { prisma } from '@/lib/db'
import { actorFromRows, actorReachesClient, isExpertBotActor, type AccessActor } from '@/lib/access/actor'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ClientOfNotice {
  /** companies.user_id — the client; null when the company has no owner. */
  clientUserId: string | null
  /** user_assignments.assignee_id of that client; null when unassigned. */
  assigneeId: string | null
}

/** Owner and assignee of a company; null — unknown company. Throws when unreadable. */
export async function clientOfCompany(companyId: string): Promise<ClientOfNotice | null> {
  const rows = await prisma.$queryRaw<Array<{ user_id: string | null; assignee_id: string | null }>>`
    SELECT c.user_id::text AS user_id, a.assignee_id::text AS assignee_id
    FROM public.companies c LEFT JOIN public.user_assignments a ON a.user_id = c.user_id
    WHERE c.id = ${companyId}
    LIMIT 1`
  const r = rows[0]
  return r ? { clientUserId: r.user_id ?? null, assigneeId: r.assignee_id ?? null } : null
}

/** Actors (migration 140 rule) of the given people; throws when unreadable. */
export async function actorsOf(userIds: readonly string[]): Promise<Map<string, AccessActor>> {
  const ids = Array.from(new Set(userIds.filter((id) => UUID_RE.test(id))))
  const out = new Map<string, AccessActor>()
  if (!ids.length) return out
  const rows = await prisma.$queryRaw<Array<{ id: string; role: string | null; status: string | null; staff_role: string | null; client_scope: string | null }>>`
    SELECT p.id::text, p.role, p.status, s.role AS staff_role, s.client_scope
    FROM public.profiles p LEFT JOIN public.staff_roles s ON s.user_id = p.id
    WHERE p.id = ANY (${ids}::uuid[])`
  for (const r of rows) {
    out.set(r.id, actorFromRows(r.id, { profile: { role: r.role, status: r.status }, staff: r.staff_role ? { role: r.staff_role, client_scope: r.client_scope } : null }))
  }
  return out
}

/** Pure: may this expert-bot actor hear about this client? */
export function hearsAboutClient(actor: AccessActor | undefined, client: ClientOfNotice | null): boolean {
  if (!actor || !isExpertBotActor(actor)) return false
  if (actor.clientScope === 'all') return true
  if (!client) return false
  return actorReachesClient(actor, client.clientUserId, client.assigneeId)
}

/**
 * Keep the recipients who may hear about the client of `companyId` (or, with
 * no company, about nothing client-specific: scope 'all' only). Fails closed:
 * an unreadable row → [] and an error line.
 */
export async function filterExpertAudience<T extends { userId: string }>(
  recipients: readonly T[],
  companyId: string | null | undefined,
): Promise<T[]> {
  if (!recipients.length) return []
  try {
    const [actors, client] = await Promise.all([
      actorsOf(recipients.map((r) => r.userId)),
      companyId ? clientOfCompany(companyId) : Promise.resolve(null),
    ])
    return recipients.filter((r) => hearsAboutClient(actors.get(r.userId), client))
  } catch (err) {
    console.error('[notifications/expert-audience] audience unreadable, nobody notified:', err instanceof Error ? err.message.split('\n')[0] : err)
    return []
  }
}

/**
 * Same filter for a client user id (escalations name the client, not the company).
 */
export async function filterExpertAudienceForClient<T extends { userId: string }>(
  recipients: readonly T[],
  clientUserId: string | null | undefined,
): Promise<T[]> {
  if (!recipients.length) return []
  try {
    let client: ClientOfNotice | null = null
    if (clientUserId && UUID_RE.test(clientUserId)) {
      const rows = await prisma.$queryRaw<Array<{ assignee_id: string | null }>>`
        SELECT assignee_id::text FROM public.user_assignments WHERE user_id = ${clientUserId}::uuid LIMIT 1`
      client = { clientUserId, assigneeId: rows[0]?.assignee_id ?? null }
    }
    const actors = await actorsOf(recipients.map((r) => r.userId))
    return recipients.filter((r) => hearsAboutClient(actors.get(r.userId), client))
  } catch (err) {
    console.error('[notifications/expert-audience] audience unreadable, nobody notified:', err instanceof Error ? err.message.split('\n')[0] : err)
    return []
  }
}
