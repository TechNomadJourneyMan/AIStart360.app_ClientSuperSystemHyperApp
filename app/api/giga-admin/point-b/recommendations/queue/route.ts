export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { scopedClientIds } from '@/lib/admin/client-scope'
import { requireGiga } from '@/lib/admin/giga-actor'
import { guarded, json } from '@/lib/point-b/plan/route-guard'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * GET /api/giga-admin/point-b/recommendations/queue — recommendations waiting for an expert's check
 * («Рекомендации на проверке»), the oldest first:
 *   { ok, data: Array<{ id, userId, clientName, companyName, title, kind, generatedBy, createdAt }> }
 * Needs clients.review; a staff member limited to their own clients (staff_roles.client_scope = 'assigned') sees
 * only theirs, Admin / Super Admin see all. Migration 129 not applied → an empty list.
 * public.companies is a Prisma-era table: only id / user_id / name are read (no timestamps).
 */
const LIMIT = 200

interface PendingRow { id: string; company_id: string; title: string; kind: string; generated_by: string; created_at: string }
interface CompanyRow { id: string; user_id: string | null; name: string | null }

export async function GET(req: NextRequest) {
  return guarded('giga/point-b/recommendations/queue GET', async () => {
    const guard = await requireGiga(req, 'clients.review')
    if (guard.response) return guard.response
    const sb = createServiceClient()

    const { data: rs, error } = await sb.from('pb_recommendations')
      .select('id, company_id, title, kind, generated_by, created_at')
      .eq('status', 'pending_review').order('created_at', { ascending: true }).limit(LIMIT)
    if (error) {
      if (/^(42P01|PGRST205)$/.test(String((error as { code?: string }).code ?? ''))) return json({ ok: true, data: [] })
      throw new Error(`point-b recommendations queue: read failed (${(error as { code?: string }).code ?? 'unknown'})`)
    }
    const pending = (rs ?? []) as PendingRow[]
    if (!pending.length) return json({ ok: true, data: [] })

    const { data: cs, error: cErr } = await sb.from('companies').select('id, user_id, name').in('id', [...new Set(pending.map((r) => r.company_id))])
    if (cErr) throw new Error(`point-b recommendations queue: read companies failed (${(cErr as { code?: string }).code ?? 'unknown'})`)
    const companies = new Map(((cs ?? []) as CompanyRow[]).map((c) => [c.id, c]))

    const allowed = await scopedClientIds(guard.actor)
    const allowedSet = allowed ? new Set(allowed) : null
    const rows = pending.flatMap((r) => {
      const c = companies.get(r.company_id)
      return c?.user_id && (!allowedSet || allowedSet.has(c.user_id)) ? [{ r, c: c as CompanyRow & { user_id: string } }] : []
    })
    const userIds = [...new Set(rows.map((x) => x.c.user_id))]
    const { data: ps } = userIds.length ? await sb.from('profiles').select('id, full_name, email').in('id', userIds) : { data: [] }
    const names = new Map(((ps ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p.full_name?.trim() || p.email || null]))

    return json({
      ok: true,
      data: rows.map(({ r, c }) => ({
        id: r.id,
        userId: c.user_id,
        clientName: names.get(c.user_id) ?? 'Без имени',
        companyName: c.name ?? null,
        title: r.title,
        kind: r.kind,
        generatedBy: r.generated_by,
        createdAt: r.created_at,
      })),
    })
  })
}
