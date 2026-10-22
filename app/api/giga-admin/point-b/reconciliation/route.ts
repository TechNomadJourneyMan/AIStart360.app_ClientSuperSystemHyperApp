export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { scopedClientIds } from '@/lib/admin/client-scope'
import { requireGiga } from '@/lib/admin/giga-actor'
import { guarded, json } from '@/lib/point-b/plan/route-guard'
import { lastFinishedPeriod, PERIOD_RE } from '@/lib/point-b/planfact/kpis'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * GET /api/giga-admin/point-b/reconciliation[?period=YYYY-MM] — the monthly reconciliation of the clients with an
 * APPROVED plan (spec §13: «эксперту видно, у каких клиентов сверки не было»), the clients WITHOUT facts first:
 *   { ok, data: { period, items: Array<{ userId, clientName, companyName, done, enteredRole, updatedAt }> } }
 * The month defaults to the last finished one. Needs clients.review; a staff member limited to his own clients sees
 * only them. Migration 132 not applied → every client is «not done» (no facts can exist yet).
 * public.companies is a Prisma-era table: only id / user_id / name are read (no timestamps).
 */
const LIMIT = 500

export async function GET(req: NextRequest) {
  return guarded('giga/point-b/reconciliation GET', async () => {
    const guard = await requireGiga(req, 'clients.review')
    if (guard.response) return guard.response
    const sb = createServiceClient()
    const asked = new URL(req.url).searchParams.get('period')
    const period = asked && PERIOD_RE.test(asked) ? asked : lastFinishedPeriod(new Date())

    const { data: plans, error } = await sb.from('pb_plans').select('company_id, user_id').not('published_version_id', 'is', null).limit(LIMIT)
    if (error) {
      if (/^(42P01|PGRST205)$/.test(String(error.code ?? ''))) return json({ ok: true, data: { period, items: [] } })
      throw new Error(`point-b reconciliation: read plans failed (${error.code ?? 'unknown'})`)
    }
    const allowed = await scopedClientIds(guard.actor)
    const allowedSet = allowed ? new Set(allowed) : null
    const rows = ((plans ?? []) as Array<{ company_id: string; user_id: string }>).filter((p) => !allowedSet || allowedSet.has(p.user_id))
    if (!rows.length) return json({ ok: true, data: { period, items: [] } })

    const companyIds = rows.map((r) => r.company_id)
    const userIds = [...new Set(rows.map((r) => r.user_id))]
    const [facts, companies, profiles] = await Promise.all([
      sb.from('pb_monthly_facts').select('company_id, entered_role, updated_at').eq('period', period).in('company_id', companyIds),
      sb.from('companies').select('id, name').in('id', companyIds),
      sb.from('profiles').select('id, full_name, email').in('id', userIds),
    ])
    const filled = new Map<string, { role: string; at: string }>()
    if (!facts.error) {
      for (const f of (facts.data ?? []) as Array<{ company_id: string; entered_role: string; updated_at: string }>) {
        const cur = filled.get(f.company_id)
        if (!cur || f.updated_at > cur.at) filled.set(f.company_id, { role: f.entered_role, at: f.updated_at })
      }
    }
    const names = new Map(((companies.data ?? []) as Array<{ id: string; name: string | null }>).map((c) => [c.id, c.name]))
    const people = new Map(((profiles.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p.full_name?.trim() || p.email || null]))

    const items = rows.map((r) => {
      const f = filled.get(r.company_id)
      return {
        userId: r.user_id,
        clientName: people.get(r.user_id) ?? 'Без имени',
        companyName: names.get(r.company_id) ?? null,
        done: !!f,
        enteredRole: f?.role ?? null,
        updatedAt: f?.at ?? null,
      }
    }).sort((a, b) => Number(a.done) - Number(b.done) || a.clientName.localeCompare(b.clientName, 'ru'))
    return json({ ok: true, data: { period, items } })
  })
}
