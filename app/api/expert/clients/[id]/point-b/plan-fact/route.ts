export const dynamic = 'force-dynamic'
// The recompute runs one company inline within its 45-second budget.
export const maxDuration = 60

// Plan-fact of a client in the EXPERT PORTAL (spec §13–§14, §15.4): the same as the GIGA routes
// (/api/giga-admin/users/:id/point-b/plan-fact and …/recompute) for the expert's assigned clients.
//   GET  → { ok, data: { published, planFact, runs } }
//   POST { action: 'recompute' } → the button «Пересчитать» (once in 10 minutes per company → 429 with retryAt)
//   PUT  { period, values, note? } → «Факт за месяц» entered by the expert (source «ежемесячная сверка»)
// Staff only (resolveExpert: expert / admin / super_admin, approved, second factor) and only the expert's assigned
// clients (guardExpertClient); a client gets 401 / 403. Audited like the GIGA routes.

import { NextRequest, NextResponse } from 'next/server'
import { recordAdminAction, type AuditActor } from '@/lib/admin/audit'
import { expertBlockResponse, guardExpertClient, resolveExpert, type ExpertViewer } from '@/lib/expert-auth'
import { companyOfUser } from '@/lib/point-b/plan/flow'
import { PLANFACT_AUDIT, planFactFailure, recomputeNow, saveFactsAndRefresh, staffPlanFactView } from '@/lib/point-b/planfact/route'
import { createServiceClient } from '@/lib/supabase-service'
import { withDeadline } from '@/lib/runtime/deadline'

const NO_COMPANY = 'У клиента нет компании — плану Точки Б не к чему привязаться'

type Guard = { ok: true; viewer: ExpertViewer } | { ok: false; response: NextResponse }

async function guard(clientId: string): Promise<Guard> {
  const auth = await resolveExpert()
  if (!auth.ok) return { ok: false, response: expertBlockResponse(auth.block) }
  const denied = await guardExpertClient(auth.viewer, clientId)
  if (denied) return { ok: false, response: denied }
  return { ok: true, viewer: auth.viewer }
}

const actorOf = (v: ExpertViewer): AuditActor => ({
  id: v.id, kind: 'session', email: v.email ?? undefined, role: v.role === 'admin' || v.role === 'super_admin' ? v.role : undefined,
})

async function run(route: string, fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn()
  } catch (err) {
    const failure = planFactFailure(err)
    if (failure) return failure
    console.error(`[${route}]`, err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось выполнить действие с план-фактом' }, { status: 500 })
  }
}

async function handleGet(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id)
  if (!g.ok) return g.response
  return run('expert/point-b/plan-fact GET', async () => {
    const sb = createServiceClient()
    const company = await companyOfUser(sb, params.id)
    if (!company) return NextResponse.json({ ok: true, data: { published: false, planFact: null, runs: [] } })
    return NextResponse.json({ ok: true, data: await staffPlanFactView(sb, { companyId: company.id, now: new Date() }) })
  })
}

async function handlePost(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id)
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null
  if (body?.action !== 'recompute') return NextResponse.json({ ok: false, error: 'Неверный запрос' }, { status: 400 })
  return run('expert/point-b/plan-fact POST', async () => {
    const sb = createServiceClient()
    const company = await companyOfUser(sb, params.id)
    if (!company) return NextResponse.json({ ok: false, error: NO_COMPANY }, { status: 400 })
    const r = await recomputeNow(sb, { companyId: company.id, userId: params.id, actorId: g.viewer.id, now: new Date() })
    if (!r.ok) return NextResponse.json({ ok: false, error: 'Пересчёт уже запускали недавно — следующий через несколько минут', code: 'rate_limited', retryAt: r.retryAt }, { status: 429 })
    await recordAdminAction(actorOf(g.viewer), {
      action: PLANFACT_AUDIT.recomputed, entityType: 'company', entityId: company.id, targetUserId: params.id,
      metadata: { status: r.outcome.status, overall: r.outcome.overall ?? null, period: r.outcome.period ?? null, draft: r.outcome.draft ?? null, runId: r.runId, via: 'expert-portal' },
    }, req)
    const { companyId: _c, ...data } = r.outcome
    return NextResponse.json({ ok: true, data })
  })
}

async function handlePut(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id)
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'Неверный запрос', code: 'invalid' }, { status: 400 })
  return run('expert/point-b/plan-fact PUT', async () => {
    const sb = createServiceClient()
    const company = await companyOfUser(sb, params.id)
    if (!company) return NextResponse.json({ ok: false, error: NO_COMPANY }, { status: 400 })
    const r = await saveFactsAndRefresh(sb, {
      companyId: company.id, userId: params.id, body: { period: body.period, values: body.values, note: body.note },
      enteredBy: g.viewer.id, role: 'expert', now: new Date(),
    })
    await recordAdminAction(actorOf(g.viewer), {
      action: PLANFACT_AUDIT.factsSaved, entityType: 'company', entityId: company.id, targetUserId: params.id,
      metadata: { period: r.period, saved: r.saved, cleared: r.cleared, unchanged: r.unchanged, via: 'expert-portal' },
    }, req)
    return NextResponse.json({ ok: true, data: { period: r.period, saved: r.saved, cleared: r.cleared, unchanged: r.unchanged, checkpoint: { status: r.checkpoint.status, overall: r.checkpoint.overall ?? null, reason: r.checkpoint.reason ?? null } } })
  })
}

/**
 * R-015: on Railway `next start` ignores maxDuration, so the request had no time limit. After 60 s the client
 * gets 504 (DEADLINE_EXCEEDED) and the work below sees its deadline spent. ROUTE_DEADLINE_MS_POINT_B_PLAN_FACT_EXPERT overrides it;
 * ROUTE_DEADLINE_DISABLED=1 turns it off.
 */
export const GET = withDeadline(handleGet, { label: 'point-b-plan-fact-expert', ms: 60_000 })
export const POST = withDeadline(handlePost, { label: 'point-b-plan-fact-expert', ms: 60_000 })
export const PUT = withDeadline(handlePut, { label: 'point-b-plan-fact-expert', ms: 60_000 })
