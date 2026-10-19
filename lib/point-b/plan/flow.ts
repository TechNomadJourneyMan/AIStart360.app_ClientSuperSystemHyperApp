/**
 * lib/point-b/plan/flow.ts — the plan workflow as the routes use it: the store (store.ts), the
 * goals (goals.ts) and the notifications (notify.ts) put together, without any HTTP.
 *
 *   createPlanDraft     a new draft with a snapshot of the live goals (the store does not take it)
 *   submitPlanVersion   refresh the goals snapshot → draft → in_review → «ждёт одобрения» to staff
 *   approvePlanVersion  refresh the goals snapshot → in_review → approved → the tasks of the strategy go
 *                       into the client's action plan (a failure there never undoes the approval) →
 *                       the client is told
 *   saveNotesAndSubmit  the legacy «save an expert correction» path (three old routes) on top of
 *                       plan versions: create or edit the draft, set the notes, send for approval
 *   legacyShape         a plan version in the shape the old `point_b_versions` consumers know
 *
 * Service-role client; the callers authorise the actor and the client first.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  approveVersionDetailed, createDraft, getOrCreatePlan, loadPlanBundle, PlanError, refreshGoals, submitVersion, updateDraft,
  type ApproveResult,
} from './store'
import { snapshotGoals } from './goals'
import { notifyPlanApproved, notifyPlanSubmitted } from './notify'
import { syncPlanTasks } from '../strategy/tasks'
import { validateStrategy } from '../strategy/validate'
import type { PlanAuthorKind, PlanRow, PlanVersionRow } from './types'

/** Who writes: a staff member; `kind` is the label stored on the version. */
export interface PlanActor {
  id: string
  name: string
  kind: Extract<PlanAuthorKind, 'expert' | 'admin'>
}

/**
 * The legacy editors have no «причина изменений» field. A version saved through them gets this
 * text so it can reach the approver at all; the approver still decides and can send it back.
 */
export const LEGACY_CHANGE_REASON = 'Правка заметок эксперта'

export function authorKindOf(role: string | null | undefined): PlanActor['kind'] {
  return role === 'admin' || role === 'super_admin' ? 'admin' : 'expert'
}

function dbError(op: string, error: { code?: string } | null | undefined): Error {
  return new Error(`point-b flow: ${op} failed (${error?.code ?? 'unknown'})`)
}

/** The company of a client (the oldest one); null when the client has none. */
export async function companyOfUser(sb: SupabaseClient, userId: string): Promise<{ id: string; name: string | null } | null> {
  const { data, error } = await sb.from('companies').select('id, name').eq('user_id', userId).order('created_at', { ascending: true }).limit(1)
  if (error) throw dbError('read company', error)
  const row = ((data ?? []) as Array<{ id: string; name?: string | null }>)[0]
  return row ? { id: row.id, name: row.name ?? null } : null
}

/** The newest Point A snapshot of the company — the base a new version is written against. */
async function latestBaseSnapshotId(sb: SupabaseClient, companyId: string): Promise<string | null> {
  try {
    const { data } = await sb.from('point_a_snapshots').select('id').eq('company_id', companyId).order('created_at', { ascending: false }).limit(1)
    return ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null
  } catch {
    return null
  }
}

/** A draft that starts from the published version (content copied) with a snapshot of the live goals. */
export async function createPlanDraft(
  sb: SupabaseClient, input: { companyId: string; userId: string; author: PlanActor; changeReason?: string | null },
): Promise<{ plan: PlanRow; version: PlanVersionRow }> {
  const plan = await getOrCreatePlan(sb, input.companyId, input.userId)
  const bundle = await loadPlanBundle(sb, input.companyId)
  const goals = await snapshotGoals(sb, input.companyId, bundle.published?.goals?.primary ?? undefined)
  const version = await createDraft(sb, plan, {
    goals,
    baseSnapshotId: await latestBaseSnapshotId(sb, input.companyId),
    author: { id: input.author.id, name: input.author.name, kind: input.author.kind },
    changeReason: input.changeReason ?? null,
    fromVersion: bundle.published,
  })
  return { plan, version }
}

/** The goals snapshot of an open version, brought up to the live goals and review statuses. */
export async function refreshOpenGoals(sb: SupabaseClient, companyId: string, version: PlanVersionRow): Promise<PlanVersionRow> {
  if (version.status !== 'draft' && version.status !== 'in_review') return version
  const goals = await snapshotGoals(sb, companyId, version.goals?.primary ?? undefined)
  return (await refreshGoals(sb, version.id, goals)) ?? version
}

export async function submitPlanVersion(
  sb: SupabaseClient, input: { companyId: string; userId: string; version: PlanVersionRow; actor: { name: string } },
): Promise<PlanVersionRow> {
  await refreshOpenGoals(sb, input.companyId, input.version)
  const submitted = await submitVersion(sb, input.version.id)
  await notifyPlanSubmitted(sb, {
    companyId: input.companyId,
    userId: input.userId,
    versionId: submitted.id,
    authorName: submitted.author_name?.trim() || input.actor.name,
    submittedAt: submitted.submitted_at,
  })
  return submitted
}

/** What happened to the tasks of the strategy when the version was published. */
export type TasksSyncOutcome =
  | { ok: true; created: number; updated: number; skipped: number }
  | { ok: false; error: string; /** How many tasks the version has. */ tasks: number }

export interface PublishResult extends ApproveResult {
  tasks: TasksSyncOutcome
}

/**
 * Writes the tasks of an APPROVED version into the action plan of the client. Never throws: the version
 * is already published, a failure (migration 128 not applied, a broken stored strategy) is reported in
 * the outcome for the caller to audit and show.
 */
export async function publishTasks(sb: SupabaseClient, userId: string, version: PlanVersionRow): Promise<TasksSyncOutcome> {
  try {
    // The stored strategy is read as it is (the profanity filter is for what people write, not for what is already published).
    const parsed = validateStrategy(version.strategy ?? {}, { moderation: false })
    if (!parsed.ok) throw new Error(`stored strategy is not valid (${parsed.field})`)
    const r = await syncPlanTasks(sb, { userId, versionId: version.id, strategy: parsed.strategy })
    return { ok: true, ...r }
  } catch (err) {
    console.error('[point-b/flow] tasks of the strategy were not written to the action plan', err instanceof Error ? err.message : err)
    const raw = (version.strategy as { items?: unknown } | null)?.items
    const tasks = Array.isArray(raw) ? raw.filter((x) => (x as { kind?: unknown } | null)?.kind === 'task').length : 0
    return { ok: false, error: (err instanceof Error ? err.message : 'unknown').slice(0, 200), tasks }
  }
}

export async function approvePlanVersion(
  sb: SupabaseClient,
  input: { companyId: string; userId: string; version: PlanVersionRow; actor: { id: string; name: string }; exceptionReason?: string | null },
): Promise<PublishResult> {
  await refreshOpenGoals(sb, input.companyId, input.version)
  const approved = await approveVersionDetailed(sb, input.version.id, { id: input.actor.id }, { exceptionReason: input.exceptionReason })
  const result: PublishResult = { ...approved, tasks: await publishTasks(sb, input.userId, approved.version) }
  await notifyPlanApproved(sb, {
    userId: input.userId,
    versionId: result.version.id,
    first: result.previousPublishedId === null,
    actor: input.actor,
  })
  return result
}

/**
 * The legacy write path: «save the expert's notes» → a plan version in review. An existing draft
 * is edited, otherwise a new one is created from the published version; a version already in
 * review cannot be changed (PlanError not_editable) — it has to be decided first.
 */
export async function saveNotesAndSubmit(
  sb: SupabaseClient,
  input: { companyId: string; userId: string; author: PlanActor; notes: string; changeReason?: string | null },
): Promise<{ version: PlanVersionRow; created: boolean }> {
  const bundle = await loadPlanBundle(sb, input.companyId)
  const reason = input.changeReason?.trim() || null
  let draft = bundle.open
  let created = false
  if (draft && draft.status !== 'draft') throw new PlanError('not_editable', 'Версия плана уже на одобрении — дождитесь решения или попросите вернуть её с комментарием')
  if (!draft) {
    draft = (await createPlanDraft(sb, { companyId: input.companyId, userId: input.userId, author: input.author, changeReason: reason ?? LEGACY_CHANGE_REASON })).version
    created = true
  }
  const goals = await snapshotGoals(sb, input.companyId, draft.goals?.primary ?? undefined)
  const updated = await updateDraft(sb, draft.id, {
    expertNotes: input.notes,
    goals,
    changeReason: reason ?? draft.change_reason ?? LEGACY_CHANGE_REASON,
  })
  const version = await submitPlanVersion(sb, { companyId: input.companyId, userId: input.userId, version: updated, actor: input.author })
  return { version, created }
}

/** The shape the old `point_b_versions` consumers (expert editors, review routes) expect. */
export interface LegacyVersion {
  id: string
  expert_notes: string
  author_name: string | null
  is_approved: boolean
  approved_by: string | null
  approved_at: string | null
  created_at: string
  /** New fields: where the version stands in the plan workflow. */
  status: PlanVersionRow['status']
  version: number
}

export function legacyShape(v: PlanVersionRow): LegacyVersion {
  return {
    id: v.id,
    expert_notes: v.expert_notes ?? '',
    author_name: v.author_name,
    is_approved: v.status === 'approved' || v.status === 'superseded',
    approved_by: v.approved_by,
    approved_at: v.approved_at,
    created_at: v.created_at,
    status: v.status,
    version: v.version,
  }
}

/** The latest version of the client's plan in the legacy shape; null when the client has no company or plan. Throws when the tables cannot be read. */
export async function latestPlanVersionLegacy(sb: SupabaseClient, userId: string): Promise<LegacyVersion | null> {
  const company = await companyOfUser(sb, userId)
  if (!company) return null
  const latest = (await loadPlanBundle(sb, company.id)).versions[0]
  return latest ? legacyShape(latest) : null
}
