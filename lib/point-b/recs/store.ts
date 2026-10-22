/**
 * lib/point-b/recs/store.ts — recommendations of a company's plan (pb_recommendations, migration 129) and
 * their verification by an expert (spec §12).
 *
 *   createRecommendations       rules / AI drafts → pending_review (profanity MASKED, lengths cut, a live
 *                               duplicate by (title, inputsHash, kind) skipped)
 *   createExpertRecommendation  written by an expert → expert_verified at once, the expert is the reviewer
 *   verifyRecommendation        pending_review → expert_verified (name + scope note required)
 *   rejectRecommendation        pending_review → expert_rejected (a comment required)
 *   editRecommendation          a NEW row rec_version + 1 (pending_review, supersedes_id = the old one);
 *                               the old one → stale
 *   markStale                   verified / pending with another inputs_hash → stale
 *   clientView                  what the client may see (pure)
 *
 * Only an expert action writes expert_verified / expert_rejected. Status changes are CONDITIONAL updates
 * (`where status = …`), so of two concurrent verifies exactly one wins, the other gets RecError('bad_state').
 * Text people type goes through assertClean (ProfanityError names the field); text of rules and the AI is
 * masked instead. Service-role client; the callers authorise the actor and the company.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertClean, maskProfanity } from '@/lib/moderation/profanity'
import type { ClientRecommendationView, RecDraft, RecKind, RecSourceRef, RecStatus, Recommendation } from './types'

export type RecErrorCode = 'not_found' | 'bad_state' | 'invalid'

export class RecError extends Error {
  constructor(public readonly code: RecErrorCode, message: string, public readonly field?: string) {
    super(message)
    this.name = 'RecError'
  }
}

const MESSAGES: Record<RecErrorCode, string> = {
  not_found: 'Рекомендация не найдена',
  bad_state: 'Рекомендация уже в другом статусе — обновите страницу',
  invalid: 'Неверные данные рекомендации',
}
const recError = (code: RecErrorCode, message?: string, field?: string): RecError => new RecError(code, message ?? MESSAGES[code], field)

export const REC_KINDS: readonly RecKind[] = ['lever', 'risk', 'action', 'contradiction', 'constraint']
export const REC_LIMITS = Object.freeze({ title: 200, text: 2000, reviewer: 200, refs: 20, refText: 200, list: 200 })
const LIVE: RecStatus[] = ['pending_review', 'expert_verified']
const CONFIDENCE = ['low', 'medium', 'high'] as const

function dbError(op: string, error: { code?: string } | null | undefined): Error {
  return new Error(`point-b recs: ${op} failed (${error?.code ?? 'unknown'})`)
}

/** pb_recommendations row. */
interface RecRow {
  id: string
  company_id: string
  version_id: string | null
  kind: RecKind
  title: string
  essence: string
  reason: string
  expected_effect: string | null
  resources: string | null
  confidence: Recommendation['confidence']
  confidence_reason: string | null
  risks: string | null
  next_action: string | null
  source_refs: unknown
  status: RecStatus
  generated_by: Recommendation['generatedBy']
  inputs_hash: string | null
  rec_version: number
  supersedes_id: string | null
  reviewer_id: string | null
  reviewer_name: string | null
  reviewer_specialty: string | null
  reviewed_at: string | null
  scope_note: string | null
  review_comment: string | null
  created_at: string
  updated_at: string
}

const REF_TYPES: ReadonlyArray<RecSourceRef['type']> = ['metric', 'model', 'snapshot', 'check', 'scenario', 'finmodel', 'goal']

/** Source refs as stored: known types only, strings cut, at most 20. */
export function cleanRefs(raw: unknown): RecSourceRef[] {
  if (!Array.isArray(raw)) return []
  const out: RecSourceRef[] = []
  for (const r of raw) {
    const x = r as Partial<RecSourceRef> | null
    if (!x || !REF_TYPES.includes(x.type as RecSourceRef['type']) || typeof x.ref !== 'string' || typeof x.label !== 'string') continue
    out.push({ type: x.type as RecSourceRef['type'], ref: x.ref.slice(0, REC_LIMITS.refText), label: x.label.slice(0, REC_LIMITS.refText) })
    if (out.length >= REC_LIMITS.refs) break
  }
  return out
}

export function toRecommendation(r: RecRow): Recommendation {
  return {
    id: r.id, companyId: r.company_id, versionId: r.version_id ?? null,
    kind: r.kind, title: r.title, essence: r.essence ?? '', reason: r.reason ?? '',
    expectedEffect: r.expected_effect ?? null, resources: r.resources ?? null,
    confidence: r.confidence, confidenceReason: r.confidence_reason ?? null,
    risks: r.risks ?? null, nextAction: r.next_action ?? null,
    sourceRefs: cleanRefs(r.source_refs),
    status: r.status, generatedBy: r.generated_by, inputsHash: r.inputs_hash ?? null,
    recVersion: r.rec_version ?? 1, supersedesId: r.supersedes_id ?? null,
    reviewerName: r.reviewer_name ?? null, reviewerSpecialty: r.reviewer_specialty ?? null, reviewedAt: r.reviewed_at ?? null,
    scopeNote: r.scope_note ?? null, reviewComment: r.review_comment ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at,
  }
}

// ─── texts ───────────────────────────────────────────────────────────────────

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
/** A machine text (rules / AI): trimmed, profanity masked, cut; empty → null. */
const machine = (v: unknown, n: number = REC_LIMITS.text): string | null => {
  const t = typeof v === 'string' ? v.trim() : ''
  return t ? cut(maskProfanity(t), n) : null
}
/** A text an expert typed: trimmed, cut (the profanity check is done before). */
const typed = (v: unknown, n: number = REC_LIMITS.text): string | null => {
  const t = typeof v === 'string' ? v.trim() : ''
  return t ? cut(t, n) : null
}
const confidenceOf = (v: unknown): Recommendation['confidence'] => (CONFIDENCE.includes(v as never) ? (v as Recommendation['confidence']) : 'medium')

const dupKey = (title: string, inputsHash: string | null, kind: string): string => `${kind}|${inputsHash ?? ''}|${title.trim().toLowerCase().replace(/\s+/g, ' ')}`

/** The profanity fields an expert can fill (ProfanityError names the first dirty one). */
function assertCleanDraft(d: Partial<RecDraft>): void {
  assertClean({
    title: d.title, essence: d.essence, reason: d.reason, expectedEffect: d.expectedEffect, resources: d.resources,
    confidenceReason: d.confidenceReason, risks: d.risks, nextAction: d.nextAction,
  })
}

// ─── reads ───────────────────────────────────────────────────────────────────

export async function listRecommendations(sb: SupabaseClient, companyId: string, opts: { statuses?: RecStatus[] } = {}): Promise<Recommendation[]> {
  let q = sb.from('pb_recommendations').select('*').eq('company_id', companyId)
  if (opts.statuses?.length) q = q.in('status', opts.statuses)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(REC_LIMITS.list)
  if (error) throw dbError('list', error)
  return ((data ?? []) as RecRow[]).map(toRecommendation)
}

async function fetchRec(sb: SupabaseClient, id: string, companyId: string): Promise<RecRow | null> {
  const { data, error } = await sb.from('pb_recommendations').select('*').eq('id', id).eq('company_id', companyId).maybeSingle()
  if (error) throw dbError('read', error)
  return (data as RecRow | null) ?? null
}

/** Conditional update of ONE recommendation of the company; the loser of a race / a wrong state → bad_state. */
async function transition(sb: SupabaseClient, id: string, companyId: string, from: RecStatus[], patch: Record<string, unknown>): Promise<RecRow> {
  const { data, error } = await sb.from('pb_recommendations').update(patch).eq('id', id).eq('company_id', companyId).in('status', from).select('*')
  if (error) throw dbError('update', error)
  const row = ((data ?? []) as RecRow[])[0]
  if (row) return row
  throw recError((await fetchRec(sb, id, companyId)) ? 'bad_state' : 'not_found')
}

// ─── writes ──────────────────────────────────────────────────────────────────

export type RecItemInput = Omit<RecDraft, 'confidence'> & { confidence?: Recommendation['confidence']; status?: 'pending_review' }

/**
 * Stores drafts of the rules / the AI as pending_review. Profanity is MASKED (a machine text is never refused),
 * lengths are cut, invalid items (no title, unknown kind) are dropped; an item whose (title, inputsHash, kind)
 * is already live (pending or verified) for the company — or repeats in the batch — is skipped. Returns the
 * created rows only.
 */
export async function createRecommendations(
  sb: SupabaseClient, input: { companyId: string; versionId: string | null; items: RecItemInput[] },
): Promise<Recommendation[]> {
  if (!input.items.length) return []
  const live = await listRecommendations(sb, input.companyId, { statuses: LIVE })
  const seen = new Set(live.map((r) => dupKey(r.title, r.inputsHash, r.kind)))
  const rows: Record<string, unknown>[] = []
  for (const it of input.items) {
    const title = machine(it.title, REC_LIMITS.title)
    if (!title || !REC_KINDS.includes(it.kind)) continue
    const inputsHash = typeof it.inputsHash === 'string' && it.inputsHash ? it.inputsHash.slice(0, 128) : null
    const key = dupKey(title, inputsHash, it.kind)
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      company_id: input.companyId,
      version_id: input.versionId,
      kind: it.kind,
      title,
      essence: machine(it.essence) ?? '',
      reason: machine(it.reason) ?? '',
      expected_effect: machine(it.expectedEffect),
      resources: machine(it.resources),
      confidence: confidenceOf(it.confidence),
      confidence_reason: machine(it.confidenceReason),
      risks: machine(it.risks),
      next_action: machine(it.nextAction),
      source_refs: cleanRefs(it.sourceRefs),
      status: 'pending_review',
      generated_by: it.generatedBy === 'ai' || it.generatedBy === 'expert' ? it.generatedBy : 'rule',
      inputs_hash: inputsHash,
      rec_version: 1,
    })
  }
  if (!rows.length) return []
  const { data, error } = await sb.from('pb_recommendations').insert(rows).select('*')
  if (error) throw dbError('create', error)
  return ((data ?? []) as RecRow[]).map(toRecommendation)
}

export interface RecReviewer { id: string; name: string; specialty: string | null }

export type ExpertDraft = Pick<RecDraft, 'kind' | 'title'> & Partial<Omit<RecDraft, 'kind' | 'title' | 'generatedBy'>>

/** An expert's own recommendation: verified at once, the expert is the reviewer. */
export async function createExpertRecommendation(
  sb: SupabaseClient,
  input: { companyId: string; versionId: string | null; draft: ExpertDraft; reviewer: RecReviewer; scopeNote: string | null; now?: Date },
): Promise<Recommendation> {
  const d = input.draft
  const title = typed(d.title, REC_LIMITS.title)
  if (!title) throw recError('invalid', 'Укажите название рекомендации', 'title')
  if (!REC_KINDS.includes(d.kind)) throw recError('invalid', 'Неизвестный вид рекомендации', 'kind')
  const name = typed(input.reviewer.name, REC_LIMITS.reviewer)
  if (!name) throw recError('invalid', 'Не указано имя эксперта', 'reviewerName')
  assertCleanDraft(d)
  assertClean({ scopeNote: input.scopeNote })
  const { data, error } = await sb.from('pb_recommendations').insert({
    company_id: input.companyId,
    version_id: input.versionId,
    kind: d.kind,
    title,
    essence: typed(d.essence) ?? '',
    reason: typed(d.reason) ?? '',
    expected_effect: typed(d.expectedEffect),
    resources: typed(d.resources),
    confidence: confidenceOf(d.confidence),
    confidence_reason: typed(d.confidenceReason),
    risks: typed(d.risks),
    next_action: typed(d.nextAction),
    source_refs: cleanRefs(d.sourceRefs),
    status: 'expert_verified',
    generated_by: 'expert',
    inputs_hash: typeof d.inputsHash === 'string' && d.inputsHash ? d.inputsHash.slice(0, 128) : null,
    rec_version: 1,
    reviewer_id: input.reviewer.id,
    reviewer_name: name,
    reviewer_specialty: typed(input.reviewer.specialty, REC_LIMITS.reviewer),
    reviewed_at: (input.now ?? new Date()).toISOString(),
    scope_note: typed(input.scopeNote),
  }).select('*').single()
  if (error || !data) throw dbError('create expert', error)
  return toRecommendation(data as RecRow)
}

/** pending_review → expert_verified. The reviewer's name and the scope note are required. */
export async function verifyRecommendation(
  sb: SupabaseClient,
  input: { id: string; companyId: string; reviewer: RecReviewer; scopeNote: string; comment?: string | null; now?: Date },
): Promise<Recommendation> {
  const name = typed(input.reviewer?.name, REC_LIMITS.reviewer)
  if (!name) throw recError('invalid', 'Не указано имя эксперта', 'reviewerName')
  const scope = typed(input.scopeNote)
  if (!scope) throw recError('invalid', 'Укажите область применимости: для какого плана и каких данных верна рекомендация', 'scopeNote')
  assertClean({ scopeNote: scope, comment: input.comment })
  const row = await transition(sb, input.id, input.companyId, ['pending_review'], {
    status: 'expert_verified',
    reviewer_id: input.reviewer.id,
    reviewer_name: name,
    reviewer_specialty: typed(input.reviewer.specialty, REC_LIMITS.reviewer),
    reviewed_at: (input.now ?? new Date()).toISOString(),
    scope_note: scope,
    review_comment: typed(input.comment),
  })
  return toRecommendation(row)
}

/** pending_review → expert_rejected. A comment is required. */
export async function rejectRecommendation(
  sb: SupabaseClient,
  input: { id: string; companyId: string; reviewer: { id: string; name: string }; comment: string; now?: Date },
): Promise<Recommendation> {
  const comment = typed(input.comment)
  if (!comment) throw recError('invalid', 'Укажите, почему рекомендация отклонена', 'comment')
  assertClean({ comment })
  const row = await transition(sb, input.id, input.companyId, ['pending_review'], {
    status: 'expert_rejected',
    reviewer_id: input.reviewer.id,
    reviewer_name: typed(input.reviewer.name, REC_LIMITS.reviewer),
    reviewed_at: (input.now ?? new Date()).toISOString(),
    review_comment: comment,
  })
  return toRecommendation(row)
}

export type RecPatch = Partial<Pick<Recommendation, 'title' | 'essence' | 'reason' | 'expectedEffect' | 'resources' | 'confidence' | 'confidenceReason' | 'risks' | 'nextAction'>>

/**
 * An expert changes a pending or verified recommendation: a NEW row (rec_version + 1, supersedes_id = the old
 * one, pending_review — it has to be verified again), the old one becomes stale. The old one is claimed first
 * (conditional update), so two concurrent edits cannot both fork it; a failed insert gives the claim back.
 */
export async function editRecommendation(
  sb: SupabaseClient,
  input: { id: string; companyId: string; patch: RecPatch; editor: { id: string; name: string } },
): Promise<Recommendation> {
  const p = input.patch ?? {}
  if (p.title !== undefined && !typed(p.title, REC_LIMITS.title)) throw recError('invalid', 'Укажите название рекомендации', 'title')
  if (p.confidence !== undefined && !CONFIDENCE.includes(p.confidence)) throw recError('invalid', 'Уровень уверенности: низкий, средний или высокий', 'confidence')
  assertCleanDraft(p)
  const old = await fetchRec(sb, input.id, input.companyId)
  if (!old) throw recError('not_found')
  if (!LIVE.includes(old.status)) throw recError('bad_state', 'Править можно только рекомендацию на проверке или проверенную')

  const pick = <K extends keyof RecPatch>(k: K, fallback: string | null): string | null =>
    (p[k] !== undefined ? typed(p[k] as string | null) : fallback)
  const next = {
    company_id: old.company_id,
    version_id: old.version_id,
    kind: old.kind,
    title: p.title !== undefined ? (typed(p.title, REC_LIMITS.title) as string) : old.title,
    essence: pick('essence', old.essence) ?? '',
    reason: pick('reason', old.reason) ?? '',
    expected_effect: pick('expectedEffect', old.expected_effect),
    resources: pick('resources', old.resources),
    confidence: p.confidence ?? old.confidence,
    confidence_reason: pick('confidenceReason', old.confidence_reason),
    risks: pick('risks', old.risks),
    next_action: pick('nextAction', old.next_action),
    source_refs: cleanRefs(old.source_refs),
    status: 'pending_review',
    generated_by: old.generated_by,
    inputs_hash: old.inputs_hash,
    rec_version: (old.rec_version ?? 1) + 1,
    supersedes_id: old.id,
  }
  await transition(sb, old.id, input.companyId, [old.status], { status: 'stale' })
  const { data, error } = await sb.from('pb_recommendations').insert(next).select('*').single()
  if (error || !data) {
    await sb.from('pb_recommendations').update({ status: old.status }).eq('id', old.id).eq('status', 'stale')
    throw dbError('create version', error)
  }
  return toRecommendation(data as RecRow)
}

/**
 * The inputs of the model changed: verified and pending recommendations with ANOTHER inputs_hash become stale
 * (rejected ones stay rejected; a recommendation without a hash — an expert's own — has nothing to compare and
 * is left). Returns how many changed.
 */
export async function markStale(sb: SupabaseClient, companyId: string, currentInputsHash: string): Promise<number> {
  const { data, error } = await sb.from('pb_recommendations').update({ status: 'stale' })
    .eq('company_id', companyId).in('status', LIVE).not('inputs_hash', 'is', null).neq('inputs_hash', currentInputsHash).select('id')
  if (error) throw dbError('mark stale', error)
  return ((data ?? []) as unknown[]).length
}

// ─── the client ──────────────────────────────────────────────────────────────

const KIND_ORDER: RecKind[] = ['constraint', 'contradiction', 'risk', 'lever', 'action']
const byReviewNewest = (a: Recommendation, b: Recommendation): number => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '')

/**
 * What the client may see: expert_verified → 'verified'; stale → 'stale' ONLY if it had been verified (it has
 * reviewed_at) and no newer verified version replaces it; pending_review → counted, never shown;
 * expert_rejected and never-verified stale → nothing. Verified first (newest review first), then stale.
 */
export function clientView(recs: Recommendation[]): { verified: ClientRecommendationView[]; pendingCount: number } {
  const replacedByVerified = new Set(recs.filter((r) => r.status === 'expert_verified' && r.supersedesId).map((r) => r.supersedesId as string))
  const verified = recs.filter((r) => r.status === 'expert_verified').sort(byReviewNewest)
  const stale = recs.filter((r) => r.status === 'stale' && r.reviewedAt && !replacedByVerified.has(r.id)).sort(byReviewNewest)
  const view = (r: Recommendation, state: ClientRecommendationView['state']): ClientRecommendationView => ({
    id: r.id, kind: r.kind, title: r.title, essence: r.essence, reason: r.reason,
    expectedEffect: r.expectedEffect, resources: r.resources, confidence: r.confidence, confidenceReason: r.confidenceReason,
    risks: r.risks, nextAction: r.nextAction, sourceRefs: r.sourceRefs, state,
    reviewerName: r.reviewerName, reviewerSpecialty: r.reviewerSpecialty, reviewedAt: r.reviewedAt, scopeNote: r.scopeNote,
  })
  return {
    verified: [...verified.map((r) => view(r, 'verified')), ...stale.map((r) => view(r, 'stale'))],
    pendingCount: recs.filter((r) => r.status === 'pending_review').length,
  }
}

/** The most important verified recommendation with a next action (the «Следующий шаг» of the page). */
export function topVerifiedWithAction(recs: Recommendation[]): Recommendation | null {
  const confidence = { high: 0, medium: 1, low: 2 }
  return recs
    .filter((r) => r.status === 'expert_verified' && r.nextAction?.trim())
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || confidence[a.confidence] - confidence[b.confidence] || byReviewNewest(a, b))[0] ?? null
}
