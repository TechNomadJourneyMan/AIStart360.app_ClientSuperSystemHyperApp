/**
 * lib/point-b/plan/waiting.ts — where the client's plan honestly stands (R3, part of S1, without the SLA) and the
 * sign «клиент ждёт план» for the queue of the next round.
 *
 *   published   an approved version exists — the client sees it
 *   in_work     a DRAFT is open: somebody of the team works on the plan
 *   in_review   a version waits for the approval of Admin / Super Admin
 *   waiting     the data carries a plan (the model has scenarios), nobody has started: the client WAITS for a plan
 *               — {@link isWaitingForPlan}; the queue «Pro без плана» and its 48-hour SLA plug in here: the pass of
 *               lib/expert-sla/run.ts opens / drops the plan_prep tasks (migration 152) from {@link listClientsWaitingForPlan}
 *   needs_data  the model cannot build scenarios (no revenue goal or no base revenue): the client is told what to add
 *
 * The client is never promised «эксперт готовит», «от вас ничего не требуется» while nobody works: the texts are in
 * components/point-b/planPrep.ts. The pure part (planPrepState) has no IO; loadPlanPrep / listClientsWaitingForPlan
 * read with the service role (callers authorise first) — one model calculation per client, bounded by a budget.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { REVENUE_GOAL_METRIC } from '@/lib/goals/store'
import type { MissingInput, ModelResult } from '../model/types'

export type PlanPrepKind = 'published' | 'in_work' | 'in_review' | 'waiting' | 'needs_data'

export interface PlanPrepMissing {
  key: string
  label: string
  actions: MissingInput['actions']
}

/**
 * R3-SLA (migration 152): the open plan_prep task of the client — «План готовит: <имя>, до <срок>» / «Назначаем
 * ответственного». `assignee` — the profile name of who took it (never the email), null — nobody yet; `overdue` — the
 * deadline has passed (no date is promised then).
 */
export interface PlanPrepTask {
  assignee: string | null
  dueAt: string
  overdue: boolean
}

export interface PlanPrep {
  kind: PlanPrepKind
  /** needs_data: what the plan lacks and where to add it (level-1 inputs of the model). Empty otherwise. */
  missing: PlanPrepMissing[]
  /** in_work: when the draft was created; in_review: when it was sent; otherwise null. */
  since: string | null
  /** The SLA task of the plan (waiting / in_work / in_review), when there is one. */
  task?: PlanPrepTask | null
}

/** The task joins the state only while the plan is not published and somebody owes it to the client. */
export function withPlanTask(prep: PlanPrep, task: PlanPrepTask | null | undefined): PlanPrep {
  if (!task || !['waiting', 'in_work', 'in_review'].includes(prep.kind)) return prep
  return { ...prep, task }
}

export interface PlanPrepFacts {
  published: boolean
  open: { status: string; createdAt: string | null; submittedAt: string | null } | null
  /** The automatic calculation of the model (level, scenarios, what is missing). */
  result: Pick<ModelResult, 'level' | 'scenarios' | 'missing'>
}

/** What a plan needs when the model lists nothing (e.g. the deadline of the goal has passed). */
const FALLBACK_MISSING: PlanPrepMissing[] = [
  { key: 'goal', label: 'Цель по выручке с реальным сроком', actions: ['survey'] },
]

export function planPrepState(f: PlanPrepFacts): PlanPrep {
  if (f.published) return { kind: 'published', missing: [], since: null }
  if (f.open?.status === 'draft') return { kind: 'in_work', missing: [], since: f.open.createdAt }
  if (f.open?.status === 'in_review') return { kind: 'in_review', missing: [], since: f.open.submittedAt ?? f.open.createdAt }
  if (f.result.level >= 1 && (f.result.scenarios?.length ?? 0) > 0) return { kind: 'waiting', missing: [], since: null }
  const missing = (f.result.missing ?? [])
    .filter((m) => m.level === 1)
    .map((m) => ({ key: m.key, label: m.label, actions: m.actions }))
  return { kind: 'needs_data', missing: missing.length ? missing : FALLBACK_MISSING, since: null }
}

/** «Клиент ждёт план»: the data carries a plan and nobody has started one. */
export function isWaitingForPlan(p: Pick<PlanPrep, 'kind'>): boolean {
  return p.kind === 'waiting'
}

// ── Reads ───────────────────────────────────────────────────────────────

const isMissingTable = (message: string): boolean => /\((42P01|PGRST205)\)/.test(message)

export interface WaitingClient {
  userId: string
  companyId: string
  /** When the revenue goal was set (the earliest moment the client could wait); null = unknown. */
  since: string | null
}

/** Why a checked candidate does not wait (R3-SLA, migration 152: closes its plan_prep task when nobody works on the plan). */
export type NotWaitingReason = 'no_access' | 'needs_data'

export interface WaitingScan {
  waiting: WaitingClient[]
  /** Clients whose model was calculated. */
  checked: number
  /** The budget or the limit stopped the scan before every candidate was checked. */
  truncated: boolean
  /** Candidates the scan checked and found NOT waiting (no Point B access; the model builds no scenarios). */
  dropped: Array<{ companyId: string; userId: string; reason: NotWaitingReason }>
  /**
   * Every candidate company (a revenue goal, an owner, no approved / open version) — checked or not. A company with an
   * open SLA task that is not here lost its goal or got a plan version (R3-SLA).
   */
  candidates: string[]
}

export interface WaitingScanOptions {
  now?: Date
  /** At most this many candidates are calculated (default 50). */
  limit?: number
  /** Wall-clock budget of the scan (default 30 s — the rule «≤ 45 s» of background work). */
  budgetMs?: number
  /** Has the client Point B (default: lib/access/decision resolveFeature 'point_b' — the tariff, overrides, the toggle). */
  hasAccess?: (userId: string) => Promise<boolean>
  /** The model of one client (default: the loader of the client page). Test seam. */
  model?: (userId: string, companyId: string, now: Date) => Promise<PlanPrepFacts['result']>
  clock?: () => number
}

async function defaultModel(sb: SupabaseClient, userId: string, companyId: string, now: Date): Promise<PlanPrepFacts['result']> {
  const [{ loadModelForCompany }, { computeModel }, { snapshotGoals }] = await Promise.all([
    import('../model/load'), import('../model/compute'), import('./goals'),
  ])
  const goals = await snapshotGoals(sb, companyId)
  const { inputs } = await loadModelForCompany(sb, { userId, companyId, goals, now })
  return computeModel(inputs)
}

async function defaultAccess(sb: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { resolveFeature } = await import('@/lib/access/decision')
    return (await resolveFeature(sb, userId, 'point_b')).allowed
  } catch {
    return false // fail closed: an unknown tariff is not a Pro client waiting
  }
}

/**
 * R4 (S0, migration 153): owners who are NOT clients of the product — a staff_roles row, or a profile whose role is
 * not a client role (lib/profiles/client-roles.ts). Staff always have Point B access, so without this the scan put
 * the team's own accounts into «Ждут план» (production 2026-11-16). The same rule as public.expert_sla_is_client,
 * whose trigger is the guarantee; here it only spares the model calculation. A failed read filters nobody (the
 * trigger still skips the task).
 */
async function nonClientOwners(sb: SupabaseClient, userIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  const ids = Array.from(new Set(userIds))
  try {
    const { isClientProfileRole } = await import('@/lib/profiles/client-roles')
    for (let i = 0; i < ids.length; i += 100) {
      const part = ids.slice(i, i + 100)
      const [staff, profiles] = await Promise.all([
        sb.from('staff_roles').select('user_id').in('user_id', part),
        sb.from('profiles').select('id, role').in('id', part),
      ])
      if (staff.error || profiles.error) throw new Error(`staff ${staff.error?.code ?? 'ok'}, profiles ${profiles.error?.code ?? 'ok'}`)
      for (const s of (staff.data ?? []) as Array<{ user_id: string }>) out.add(s.user_id)
      for (const p of (profiles.data ?? []) as Array<{ id: string; role: string | null }>) {
        if (p.role != null && !isClientProfileRole(p.role)) out.add(p.id)
      }
    }
    return out
  } catch (err) {
    console.error('[point-b/waiting] staff filter not read', err instanceof Error ? err.message : err)
    return new Set()
  }
}

/**
 * The client candidates of the queue: companies with a revenue goal (metric_targets or the companies columns the
 * survey writes), without an approved and without an open plan version, owned by a client of the product (not staff —
 * R4 S0). Ordered by the goal's age (oldest first).
 */
async function candidates(sb: SupabaseClient): Promise<Array<{ companyId: string; userId: string; since: string | null }>> {
  const [targets, columns] = await Promise.all([
    sb.from('metric_targets').select('company_id, created_at').eq('metric_key', REVENUE_GOAL_METRIC).order('created_at', { ascending: true }).limit(2000),
    sb.from('companies').select('id, user_id, target_revenue_12m_kzt, target_revenue_3y_kzt, createdAt').limit(5000),
  ])
  if (targets.error && !isMissingTable(`(${targets.error.code ?? ''})`)) throw new Error(`point-b waiting: goals read failed (${targets.error.code ?? 'unknown'})`)
  if (columns.error) throw new Error(`point-b waiting: companies read failed (${columns.error.code ?? 'unknown'})`)

  const since = new Map<string, string | null>()
  for (const t of (targets.data ?? []) as Array<{ company_id: string; created_at: string | null }>) if (!since.has(t.company_id)) since.set(t.company_id, t.created_at)
  const owner = new Map<string, string>()
  for (const c of (columns.data ?? []) as Array<Record<string, unknown>>) {
    const id = String(c.id)
    if (typeof c.user_id === 'string' && c.user_id) owner.set(id, c.user_id)
    const hasColumnGoal = Number(c.target_revenue_12m_kzt) > 0 || Number(c.target_revenue_3y_kzt) > 0
    if (hasColumnGoal && !since.has(id)) since.set(id, typeof c.createdAt === 'string' ? c.createdAt : null)
  }
  const owned = [...since.keys()].filter((id) => owner.has(id))
  const staff = owned.length ? await nonClientOwners(sb, owned.map((id) => owner.get(id)!)) : new Set<string>()
  const ids = owned.filter((id) => !staff.has(owner.get(id)!))
  if (!ids.length) return []

  // Plans: approved or open → not waiting.
  const busy = new Set<string>()
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const plans = await sb.from('pb_plans').select('id, company_id, published_version_id').in('company_id', chunk)
    if (plans.error) {
      if (isMissingTable(`(${plans.error.code ?? ''})`)) break
      throw new Error(`point-b waiting: plans read failed (${plans.error.code ?? 'unknown'})`)
    }
    const rows = (plans.data ?? []) as Array<{ id: string; company_id: string; published_version_id: string | null }>
    for (const p of rows) if (p.published_version_id) busy.add(p.company_id)
    const planIds = rows.filter((p) => !p.published_version_id).map((p) => p.id)
    if (planIds.length) {
      const open = await sb.from('pb_plan_versions').select('plan_id').in('plan_id', planIds).in('status', ['draft', 'in_review'])
      if (open.error) throw new Error(`point-b waiting: versions read failed (${open.error.code ?? 'unknown'})`)
      const openPlans = new Set(((open.data ?? []) as Array<{ plan_id: string }>).map((v) => v.plan_id))
      for (const p of rows) if (openPlans.has(p.id)) busy.add(p.company_id)
    }
  }
  return ids
    .filter((id) => !busy.has(id))
    .map((id) => ({ companyId: id, userId: owner.get(id)!, since: since.get(id) ?? null }))
    .sort((a, b) => (a.since ?? '9999').localeCompare(b.since ?? '9999'))
}

/**
 * The clients who wait for a plan right now (the sign of the queue «Pro без плана»): Point B access, a company, a
 * revenue goal, no approved and no open version, and the model can build scenarios. One model calculation per
 * candidate, sequential, under `budgetMs` — never a mass background generation.
 */
export async function listClientsWaitingForPlan(sb: SupabaseClient, opts: WaitingScanOptions = {}): Promise<WaitingScan> {
  const now = opts.now ?? new Date()
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500))
  const clock = opts.clock ?? Date.now
  const started = clock()
  const budget = opts.budgetMs ?? 30_000
  const access = opts.hasAccess ?? ((u: string) => defaultAccess(sb, u))
  const model = opts.model ?? ((u: string, c: string, n: Date) => defaultModel(sb, u, c, n))

  const list = await candidates(sb)
  const waiting: WaitingClient[] = []
  const dropped: WaitingScan['dropped'] = []
  let checked = 0
  let truncated = false
  for (const c of list) {
    if (checked >= limit || clock() - started > budget) { truncated = true; break }
    if (!(await access(c.userId))) { dropped.push({ companyId: c.companyId, userId: c.userId, reason: 'no_access' }); continue }
    checked += 1
    try {
      const result = await model(c.userId, c.companyId, now)
      if (isWaitingForPlan(planPrepState({ published: false, open: null, result }))) waiting.push(c)
      else dropped.push({ companyId: c.companyId, userId: c.userId, reason: 'needs_data' })
    } catch (err) {
      // Not calculated: neither waiting nor dropped — an open task stays as it is.
      console.error('[point-b/waiting] model not calculated', c.companyId, err instanceof Error ? err.message : err)
    }
  }
  return { waiting, checked, truncated, dropped, candidates: list.map((c) => c.companyId) }
}
