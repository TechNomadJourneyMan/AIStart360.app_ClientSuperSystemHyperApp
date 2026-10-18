export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { scopedClientIds } from '@/lib/admin/client-scope'
import { requireGiga } from '@/lib/admin/giga-actor'
import { canApprovePointB } from '@/lib/expert-review/point-b'
import { guarded, json } from '@/lib/point-b/plan/route-guard'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * GET /api/giga-admin/point-b/queue — plan versions waiting for approval («Точка Б — на одобрении»),
 * the longest wait first: { versionId, userId, clientName, companyName, version, authorName,
 * submittedAt, waitingDays }. Needs clients.review; a staff member limited to their own clients
 * (staff_roles.client_scope = 'assigned') sees only those, Admin / Super Admin see all.
 * `canApprove` tells the page whether the actor may approve what they see.
 */
const LIMIT = 200
const DAY_MS = 86_400_000

interface QueueVersion { id: string; plan_id: string; version: number; author_name: string | null; submitted_at: string | null; created_at: string }
interface QueuePlan { id: string; company_id: string; user_id: string }

export async function GET(req: NextRequest) {
  return guarded('giga/point-b/queue GET', async () => {
    const guard = await requireGiga(req, 'clients.review')
    if (guard.response) return guard.response
    const actor = guard.actor
    const sb = createServiceClient()

    const { data: vs, error } = await sb.from('pb_plan_versions')
      .select('id, plan_id, version, author_name, submitted_at, created_at')
      .eq('status', 'in_review').order('submitted_at', { ascending: true }).limit(LIMIT)
    if (error) throw new Error(`point-b queue: read versions failed (${error.code ?? 'unknown'})`)
    const versions = (vs ?? []) as QueueVersion[]
    if (!versions.length) return json({ ok: true, data: [], canApprove: canApprovePointB(actor.role) })

    const { data: ps, error: planError } = await sb.from('pb_plans').select('id, company_id, user_id').in('id', [...new Set(versions.map((v) => v.plan_id))])
    if (planError) throw new Error(`point-b queue: read plans failed (${planError.code ?? 'unknown'})`)
    const plans = new Map(((ps ?? []) as QueuePlan[]).map((p) => [p.id, p]))

    const allowed = await scopedClientIds(actor)
    const allowedSet = allowed ? new Set(allowed) : null
    const rows = versions.flatMap((v) => {
      const plan = plans.get(v.plan_id)
      return plan && (!allowedSet || allowedSet.has(plan.user_id)) ? [{ v, plan }] : []
    })

    const userIds = [...new Set(rows.map((r) => r.plan.user_id))]
    const companyIds = [...new Set(rows.map((r) => r.plan.company_id))]
    const [profiles, companies] = await Promise.all([
      userIds.length ? sb.from('profiles').select('id, full_name, email').in('id', userIds) : Promise.resolve({ data: [] }),
      companyIds.length ? sb.from('companies').select('id, name').in('id', companyIds) : Promise.resolve({ data: [] }),
    ])
    const names = new Map(((profiles.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p.full_name?.trim() || p.email || null]))
    const company = new Map(((companies.data ?? []) as Array<{ id: string; name: string | null }>).map((c) => [c.id, c.name]))

    const now = Date.now()
    const data = rows.map(({ v, plan }) => {
      const since = v.submitted_at ?? v.created_at
      return {
        versionId: v.id,
        userId: plan.user_id,
        clientName: names.get(plan.user_id) ?? 'Без имени',
        companyName: company.get(plan.company_id) ?? null,
        version: v.version,
        authorName: v.author_name,
        submittedAt: v.submitted_at,
        waitingDays: Math.max(0, Math.floor((now - Date.parse(since)) / DAY_MS)),
      }
    })
    return json({ ok: true, data, canApprove: canApprovePointB(actor.role) })
  })
}
