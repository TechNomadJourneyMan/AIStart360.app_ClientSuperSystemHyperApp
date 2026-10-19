/**
 * lib/point-b/plan/route-guard.ts — what every GIGA / expert plan route does first and last, in
 * one place: who may act on THIS client, which company and plan version it is about, how an
 * error becomes an answer, and how an action is audited.
 *
 *   guardPlanRoute   requireGiga('clients.review') [+ canApprovePointB] + guardClientAccess
 *                    [+ forbidTarget for writes] → { actor, userId, company, canApprove, … }
 *   findVersion      the version of THIS client's plan (a foreign / unknown id → null → 404)
 *   planFailure      ProfanityError → 400 with the field; PlanError → 404 / 409 (+ reasons)
 *   auditPlan        recordAdminAction with the plan's entity and the client as the target
 *
 * Answers are `{ ok: true, data }` / `{ ok: false, error, reasons?, field?, code? }`.
 */
import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { guardClientAccess } from '@/lib/admin/client-scope'
import { recordAdminAction, type AuditActor, type AuditEntry } from '@/lib/admin/audit'
import { forbidTarget, requireGiga, type GigaActor } from '@/lib/admin/giga-actor'
import { canApprovePointB } from '@/lib/expert-review/point-b'
import { displayNameOf } from '@/lib/expert-review/server'
import { PROFANITY_MESSAGE, profaneField } from '@/lib/moderation/http'
import { ProfanityError } from '@/lib/moderation/profanity'
import { createServiceClient } from '@/lib/supabase-service'
import { approvePlanVersion, authorKindOf, companyOfUser, legacyShape, saveNotesAndSubmit, type PlanActor, type PublishResult } from './flow'
import { StrategyError } from '../strategy/validate'
import { loadPlanBundle, PlanError, type PlanBundle } from './store'
import { EXCEPTION_REASON_MIN, validExceptionReason } from './status'
import type { PlanVersionRow } from './types'

export const PLAN_AUDIT = {
  created: 'point_b.plan.created',
  updated: 'point_b.plan.updated',
  submitted: 'point_b.plan.submitted',
  approved: 'point_b.plan.approved',
  rejected: 'point_b.plan.rejected',
  goalReviewed: 'point_b.goal.reviewed',
  scenariosComputed: 'point_b.scenarios.computed',
  scenarioSelected: 'point_b.scenario.selected',
  strategySaved: 'point_b.strategy.saved',
  tasksSyncFailed: 'point_b.tasks.sync_failed',
} as const

/** Shown to the approver when the version is published but its tasks did not reach the client's action plan. */
export const TASKS_SYNC_WARNING =
  'План одобрен и виден клиенту, но задачи стратегии пока не попали в его план действий. Сообщите администратору: синхронизация повторится при следующей публикации.'

export interface PlanRouteContext {
  actor: GigaActor
  userId: string
  sb: SupabaseClient
  /** The client's company; null when the client has none yet. */
  company: { id: string; name: string | null } | null
  canApprove: boolean
  /** Name shown to the client and in notifications (a person's name, never an email). */
  actorName: string
  author: PlanActor
}

export type PlanGuard = { ok: true; ctx: PlanRouteContext } | { ok: false; response: NextResponse }

export interface GuardOptions {
  /** Changes data: the target must also be a person the actor may manage (forbidTarget). */
  write?: boolean
  /** Admin / Super Admin only (approve, return). Checked before anything about the client is read. */
  approver?: boolean
}

export const json = (body: Record<string, unknown>, status = 200): NextResponse => NextResponse.json(body, { status })
export const fail = (error: string, status: number, extra: Record<string, unknown> = {}): NextResponse =>
  NextResponse.json({ ok: false, error, ...extra }, { status })

export async function guardPlanRoute(req: NextRequest, userId: string, opts: GuardOptions = {}): Promise<PlanGuard> {
  const guard = await requireGiga(req, 'clients.review')
  if (guard.response) return { ok: false, response: guard.response }
  const actor = guard.actor
  const canApprove = canApprovePointB(actor.role)
  if (opts.approver && !canApprove) {
    return { ok: false, response: fail('Одобрить или вернуть план Точки Б может только Admin или Super Admin', 403) }
  }
  const denied = await guardClientAccess(actor, userId)
  if (denied) return { ok: false, response: denied }
  if (opts.write) {
    const forbidden = await forbidTarget(actor, userId)
    if (forbidden) return { ok: false, response: forbidden }
  }
  return { ok: true, ctx: await planContext(actor, userId) }
}

/** The context of a plan route for an actor who has already been authorised by the caller. */
export async function planContext(actor: GigaActor, userId: string): Promise<PlanRouteContext> {
  const sb = createServiceClient()
  const company = await companyOfUser(sb, userId)
  const actorName = await displayNameOf(sb, actor.id)
  return {
    actor, userId, sb, company, canApprove: canApprovePointB(actor.role), actorName,
    author: { id: actor.id, name: actorName, kind: authorKindOf(actor.role) },
  }
}

export const NO_COMPANY = 'У клиента нет компании — плану Точки Б не к чему привязаться'

/** The version of this client's plan; null for an unknown id and for another client's version. */
export async function findVersion(
  ctx: PlanRouteContext, versionId: string,
): Promise<{ version: PlanVersionRow; bundle: PlanBundle } | null> {
  if (!ctx.company) return null
  const bundle = await loadPlanBundle(ctx.sb, ctx.company.id)
  const version = bundle.versions.find((v) => v.id === versionId)
  return version ? { version, bundle } : null
}

export const VERSION_NOT_FOUND = 'Версия плана не найдена'
export const versionNotFound = (): NextResponse => fail(VERSION_NOT_FOUND, 404, { code: 'not_found' })

/**
 * The answer for an error of the plan domain, or null for anything else (the caller answers 500).
 * `conditionsStatus`: PlanError('conditions') is a refused approval (409) everywhere except in
 * goal review, where it is a plain validation error (400).
 */
export function planFailure(err: unknown, opts: { conditionsStatus?: number } = {}): NextResponse | null {
  if (err instanceof ProfanityError) {
    return fail(PROFANITY_MESSAGE, 400, { code: 'profanity', field: err.field })
  }
  if (err instanceof StrategyError) {
    return fail(err.message, 400, { code: err.profanity ? 'profanity' : 'invalid_strategy', field: err.field })
  }
  if (err instanceof PlanError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'conditions' ? (opts.conditionsStatus ?? 409) : 409
    return fail(err.message, status, { code: err.code, ...(err.reasons?.length ? { reasons: err.reasons } : {}) })
  }
  return null
}

export function serverFailure(route: string, err: unknown): NextResponse {
  console.error(`[${route}]`, err instanceof Error ? err.message : err)
  return fail('Не удалось выполнить действие с планом Точки Б', 500)
}

/** Runs a route body: domain errors become their answer, everything else a logged 500. */
export async function guarded(route: string, run: () => Promise<NextResponse>, opts: { conditionsStatus?: number } = {}): Promise<NextResponse> {
  try {
    return await run()
  } catch (err) {
    return planFailure(err, opts) ?? serverFailure(route, err)
  }
}

export async function auditPlan(
  ctx: Pick<PlanRouteContext, 'actor' | 'userId'>, req: Request, entry: Omit<AuditEntry, 'targetUserId' | 'entityType'> & { entityType?: string },
): Promise<void> {
  const actor: AuditActor = { id: ctx.actor.id, kind: ctx.actor.kind, role: ctx.actor.role, email: ctx.actor.email }
  await recordAdminAction(actor, { entityType: 'pb_plan_version', ...entry, targetUserId: ctx.userId }, req)
}

/**
 * The OLD «save an expert correction» routes of the panel (giga point-b POST, review/point-b POST):
 * the notes become a plan version in review (flow.saveNotesAndSubmit) and the answer keeps the
 * legacy shape { id, expert_notes, author_name, is_approved, created_at } plus status / version.
 * Nothing is written to point_b_versions.
 */
export async function saveLegacyNotes(
  req: Request, ctx: PlanRouteContext, input: { notes: string; changeReason?: string | null },
): Promise<NextResponse> {
  if (!ctx.company) return fail(NO_COMPANY, 400)
  const { version, created } = await saveNotesAndSubmit(ctx.sb, {
    companyId: ctx.company.id, userId: ctx.userId, author: ctx.author, notes: input.notes, changeReason: input.changeReason ?? null,
  })
  await auditPlan(ctx, req, {
    action: created ? PLAN_AUDIT.created : PLAN_AUDIT.updated, entityId: version.id,
    metadata: { version: version.version, preview: input.notes.slice(0, 120), via: 'legacy-route' },
  })
  await auditPlan(ctx, req, {
    action: PLAN_AUDIT.submitted, entityId: version.id,
    oldValue: { status: 'draft' }, newValue: { status: version.status }, metadata: { version: version.version, via: 'legacy-route' },
  })
  return json({ ok: true, data: legacyShape(version) })
}

/**
 * The exception reason of an approval request: null when there is none, the trimmed text when it
 * is long enough, otherwise the 400 answer (the reason is shorter than the minimum or profane).
 */
export function exceptionReasonOf(raw: string | null | undefined): { reason: string | null } | { response: NextResponse } {
  const given = raw?.trim() || null
  if (given && !validExceptionReason(given)) {
    return { response: fail(`Причина исключения — не короче ${EXCEPTION_REASON_MIN} символов`, 400, { field: 'exceptionReason' }) }
  }
  if (given && profaneField({ exceptionReason: given })) {
    return { response: fail(PROFANITY_MESSAGE, 400, { code: 'profanity', field: 'exceptionReason' }) }
  }
  return { reason: given }
}

/** Approves a version of this client's plan and audits it (both approve routes). */
export async function approveAndAudit(
  req: Request, ctx: PlanRouteContext, version: PlanVersionRow, exceptionReason: string | null, via?: string,
): Promise<PublishResult> {
  const result = await approvePlanVersion(ctx.sb, {
    companyId: ctx.company!.id, userId: ctx.userId, version, actor: { id: ctx.actor.id, name: ctx.actorName }, exceptionReason,
  })
  await auditPlan(ctx, req, {
    action: PLAN_AUDIT.approved, entityId: result.version.id,
    oldValue: { status: 'in_review' }, newValue: { status: 'approved', approvedAt: result.version.approved_at },
    metadata: {
      version: result.version.version,
      first: result.previousPublishedId === null,
      supersededVersionId: result.previousPublishedId,
      exception: result.exception,
      ...(result.tasks.ok ? { tasks: { created: result.tasks.created, updated: result.tasks.updated, skipped: result.tasks.skipped } } : {}),
      ...(result.exception ? { exceptionReason: result.version.approval_exception } : {}),
      ...(via ? { via } : {}),
    },
  })
  if (!result.tasks.ok) {
    await auditPlan(ctx, req, {
      action: PLAN_AUDIT.tasksSyncFailed, entityId: result.version.id,
      metadata: { version: result.version.version, tasks: result.tasks.tasks, error: result.tasks.error, ...(via ? { via } : {}) },
    })
  }
  return result
}

/** `warnings` for the approve answers: omitted unless the tasks of the strategy were not written. */
export function publishWarnings(result: PublishResult): { warnings?: string[] } {
  return result.tasks.ok ? {} : { warnings: [TASKS_SYNC_WARNING] }
}
