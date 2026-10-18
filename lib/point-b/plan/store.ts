/**
 * lib/point-b/plan/store.ts — plans and their versions (pb_plans, pb_plan_versions).
 *
 * Service-role client only (the tables have no write policy for API roles);
 * the callers authorise the company / actor first. The rules live in status.ts:
 * here they are applied with CONDITIONAL updates (`where status = …`), so two
 * concurrent calls cannot both win — the loser gets PlanError('bad_state').
 *
 *   createDraft   one open (draft / in_review) version per plan
 *   updateDraft   only a draft is editable
 *   submitVersion draft → in_review
 *   approveVersion in_review → approved; the previous approved → superseded,
 *                 pb_plans.published_version_id / current_version_id → the new one
 *   rejectVersion in_review → draft with rejected_by / _at / _reason
 *
 * Text people type (notes, reasons) goes through the profanity filter here too
 * (ProfanityError names the field), so no writer can skip it.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertClean } from '@/lib/moderation/profanity'
import { canTransition, checkApprovalConditions, isEditable, validExceptionReason } from './status'
import type { PlanAuthorKind, PlanGoalsSnapshot, PlanRow, PlanVersionRow } from './types'

export type PlanErrorCode = 'open_exists' | 'not_editable' | 'bad_state' | 'conditions' | 'not_found'

export class PlanError extends Error {
  constructor(public readonly code: PlanErrorCode, message: string, public readonly reasons?: string[]) {
    super(message)
    this.name = 'PlanError'
  }
}

const MESSAGES: Record<PlanErrorCode, string> = {
  open_exists: 'У плана уже есть открытая версия — завершите или верните её',
  not_editable: 'Версию нельзя изменить: правится только черновик',
  bad_state: 'Версия уже в другом статусе — обновите страницу',
  conditions: 'Условия одобрения не выполнены',
  not_found: 'Версия плана не найдена',
}

function planError(code: PlanErrorCode, reasons?: string[]): PlanError {
  return new PlanError(code, reasons?.length ? reasons.join('; ') : MESSAGES[code], reasons)
}

function dbError(op: string, error: { code?: string } | null | undefined): Error {
  return new Error(`point-b plan: ${op} failed (${error?.code ?? 'unknown'})`)
}

const UNIQUE_VIOLATION = '23505'

const OPEN_STATUSES = ['draft', 'in_review'] as const

async function fetchVersion(sb: SupabaseClient, versionId: string): Promise<PlanVersionRow | null> {
  const { data, error } = await sb.from('pb_plan_versions').select('*').eq('id', versionId).maybeSingle()
  if (error) throw dbError('read version', error)
  return (data as PlanVersionRow | null) ?? null
}

/** The plan of the company; created on first use (one per company). */
export async function getOrCreatePlan(sb: SupabaseClient, companyId: string, userId: string): Promise<PlanRow> {
  const read = async () => {
    const { data, error } = await sb.from('pb_plans').select('*').eq('company_id', companyId).maybeSingle()
    if (error) throw dbError('read plan', error)
    return (data as PlanRow | null) ?? null
  }
  const existing = await read()
  if (existing) return existing
  const { data, error } = await sb.from('pb_plans').insert({ company_id: companyId, user_id: userId }).select('*').single()
  if (!error && data) return data as PlanRow
  if (error?.code === UNIQUE_VIOLATION) {
    const raced = await read()
    if (raced) return raced
  }
  throw dbError('create plan', error)
}

export interface PlanBundle {
  plan: PlanRow | null
  /** Newest first. */
  versions: PlanVersionRow[]
  /** The draft / in_review version, if any. */
  open: PlanVersionRow | null
  /** The approved version the client sees. */
  published: PlanVersionRow | null
}

export async function loadPlanBundle(sb: SupabaseClient, companyId: string): Promise<PlanBundle> {
  const { data: plan, error } = await sb.from('pb_plans').select('*').eq('company_id', companyId).maybeSingle()
  if (error) throw dbError('read plan', error)
  if (!plan) return { plan: null, versions: [], open: null, published: null }
  const row = plan as PlanRow
  const res = await sb.from('pb_plan_versions').select('*').eq('plan_id', row.id).order('version', { ascending: false })
  if (res.error) throw dbError('read versions', res.error)
  const versions = (res.data ?? []) as PlanVersionRow[]
  const open = versions.find((v) => (OPEN_STATUSES as readonly string[]).includes(v.status)) ?? null
  // published_version_id is authoritative; if it is stale (a crash between the two writes of an
  // approval) the newest approved version is what the client sees.
  const published =
    versions.find((v) => v.id === row.published_version_id && v.status === 'approved') ??
    versions.find((v) => v.status === 'approved') ??
    null
  return { plan: row, versions, open, published }
}

export interface DraftInput {
  goals: PlanGoalsSnapshot
  baseSnapshotId: string | null
  author: { id: string; name: string; kind: PlanAuthorKind }
  changeReason: string | null
  /** The version to start from: its content is copied into the new draft. */
  fromVersion?: PlanVersionRow | null
}

export async function createDraft(sb: SupabaseClient, plan: PlanRow, input: DraftInput): Promise<PlanVersionRow> {
  assertClean({ changeReason: input.changeReason })
  const open = async () => {
    const { data, error } = await sb.from('pb_plan_versions').select('id').eq('plan_id', plan.id).in('status', [...OPEN_STATUSES]).limit(1)
    if (error) throw dbError('read open version', error)
    return ((data ?? []) as Array<{ id: string }>).length > 0
  }
  const nextNumber = async () => {
    const { data, error } = await sb.from('pb_plan_versions').select('version').eq('plan_id', plan.id).order('version', { ascending: false }).limit(1)
    if (error) throw dbError('read version number', error)
    return (((data ?? []) as Array<{ version: number }>)[0]?.version ?? 0) + 1
  }
  if (await open()) throw planError('open_exists')

  const from = input.fromVersion ?? null
  const base = {
    plan_id: plan.id,
    status: 'draft',
    base_snapshot_id: input.baseSnapshotId,
    goals: input.goals,
    assumptions: from?.assumptions ?? {},
    scenarios: from?.scenarios ?? [],
    selected_scenario: from?.selected_scenario ?? null,
    strategy: from?.strategy ?? {},
    risks: from?.risks ?? [],
    expert_notes: from?.expert_notes ?? null,
    change_reason: input.changeReason?.trim() || null,
    author_id: input.author.id,
    author_name: input.author.name,
    author_kind: input.author.kind,
  }
  // A concurrent creator can win the unique index (open version or number): once more, then open_exists.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await sb.from('pb_plan_versions').insert({ ...base, version: await nextNumber() }).select('*').single()
    if (!error && data) {
      const created = data as PlanVersionRow
      const upd = await sb.from('pb_plans').update({ current_version_id: created.id }).eq('id', plan.id)
      if (upd.error) throw dbError('point to the new version', upd.error)
      return created
    }
    if (error?.code !== UNIQUE_VIOLATION) throw dbError('create draft', error)
    if (await open()) throw planError('open_exists')
  }
  throw planError('open_exists')
}

export interface DraftPatch {
  expertNotes?: string | null
  changeReason?: string | null
  goals?: PlanGoalsSnapshot
  selectedScenario?: string | null
}

export async function updateDraft(sb: SupabaseClient, versionId: string, patch: DraftPatch): Promise<PlanVersionRow> {
  assertClean({ expertNotes: patch.expertNotes, changeReason: patch.changeReason })
  const row: Record<string, unknown> = {}
  if (patch.expertNotes !== undefined) row.expert_notes = patch.expertNotes?.trim() || null
  if (patch.changeReason !== undefined) row.change_reason = patch.changeReason?.trim() || null
  if (patch.goals !== undefined) row.goals = patch.goals
  if (patch.selectedScenario !== undefined) row.selected_scenario = patch.selectedScenario
  if (!Object.keys(row).length) {
    const cur = await fetchVersion(sb, versionId)
    if (!cur) throw planError('not_found')
    if (!isEditable(cur.status)) throw planError('not_editable')
    return cur
  }
  const { data, error } = await sb.from('pb_plan_versions').update(row).eq('id', versionId).eq('status', 'draft').select('*').maybeSingle()
  if (error) throw dbError('update draft', error)
  if (data) return data as PlanVersionRow
  const cur = await fetchVersion(sb, versionId)
  throw planError(cur ? 'not_editable' : 'not_found')
}

/** Conditional status change; the loser of a race (or a wrong state) gets bad_state. */
async function transition(
  sb: SupabaseClient, versionId: string, from: PlanVersionRow['status'], patch: Record<string, unknown>, op: string,
): Promise<PlanVersionRow> {
  const { data, error } = await sb.from('pb_plan_versions').update(patch).eq('id', versionId).eq('status', from).select('*').maybeSingle()
  if (error) throw dbError(op, error)
  if (data) return data as PlanVersionRow
  const cur = await fetchVersion(sb, versionId)
  throw planError(cur ? 'bad_state' : 'not_found')
}

export async function submitVersion(sb: SupabaseClient, versionId: string): Promise<PlanVersionRow> {
  if (!canTransition('draft', 'submit')) throw planError('bad_state')
  return transition(sb, versionId, 'draft', { status: 'in_review', submitted_at: new Date().toISOString() }, 'submit')
}

export interface ApproveResult {
  version: PlanVersionRow
  /** The approved version this one replaced (null on the first publication). */
  previousPublishedId: string | null
  /** The approval waived the primary-goal condition (the reason is on the version). */
  exception: boolean
}

export async function approveVersionDetailed(
  sb: SupabaseClient, versionId: string, actor: { id: string }, opts: { exceptionReason?: string | null } = {},
): Promise<ApproveResult> {
  const current = await fetchVersion(sb, versionId)
  if (!current) throw planError('not_found')
  if (!canTransition(current.status, 'approve')) throw planError('bad_state')
  assertClean({ exceptionReason: opts.exceptionReason })
  const check = checkApprovalConditions({ goals: current.goals, changeReason: current.change_reason }, { exceptionReason: opts.exceptionReason })
  if (!check.ok) throw planError('conditions', check.reasons)

  const version = await transition(sb, versionId, 'in_review', {
    status: 'approved',
    approved_by: actor.id,
    approved_at: new Date().toISOString(),
    approval_exception: check.exception ? validExceptionReason(opts.exceptionReason) : null,
  }, 'approve')

  // The previous approved version(s) become superseded (only the status changes — the trigger allows it).
  const sup = await sb.from('pb_plan_versions').update({ status: 'superseded' })
    .eq('plan_id', version.plan_id).eq('status', 'approved').neq('id', version.id).select('id, version')
  if (sup.error) throw dbError('supersede previous', sup.error)
  const superseded = ((sup.data ?? []) as Array<{ id: string; version: number }>).sort((a, b) => b.version - a.version)

  const plan = await sb.from('pb_plans').update({ published_version_id: version.id, current_version_id: version.id }).eq('id', version.plan_id)
  if (plan.error) throw dbError('publish version', plan.error)
  return { version, previousPublishedId: superseded[0]?.id ?? null, exception: check.exception }
}

export async function approveVersion(
  sb: SupabaseClient, versionId: string, actor: { id: string }, opts: { exceptionReason?: string | null } = {},
): Promise<PlanVersionRow> {
  return (await approveVersionDetailed(sb, versionId, actor, opts)).version
}

export async function rejectVersion(sb: SupabaseClient, versionId: string, actor: { id: string }, reason: string): Promise<PlanVersionRow> {
  const text = typeof reason === 'string' ? reason.trim() : ''
  if (!text) throw planError('conditions', ['Укажите причину возврата'])
  assertClean({ reason: text })
  return transition(sb, versionId, 'in_review', {
    status: 'draft',
    submitted_at: null,
    rejected_by: actor.id,
    rejected_at: new Date().toISOString(),
    rejected_reason: text,
  }, 'reject')
}
