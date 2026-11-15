/**
 * lib/point-a/ai-review-store.ts — the expert's review of the AI analysis of
 * Point A (R3-SLA, решение PO «гибрид»): read the analysis of a client, save
 * corrections over the AI text, confirm it («Проверено экспертом» — who, when).
 *
 * The routes authorise first (GIGA: clients.review + the client scope; the
 * expert cabinet: an approved expert / Admin for an assigned client —
 * guardExpertClient); everything here runs with the service role and is scoped
 * to the client's CURRENT diagnostics row.
 *
 *   corrections  diagnostics.ai_expert_edits — only what differs from the AI
 *                text (pruneEdits); the AI text itself is never changed
 *   confirmation ai_reviewed_at / ai_reviewed_by / ai_reviewed_by_name (the
 *                name the client sees — the profile name, never the email)
 *   SLA          the task pa_ai_review (migration 152): a saved correction is
 *                the reaction, the confirmation is the answer (the task is
 *                closed at once; expert_sla_sync closes it anyway ≤ 5 min)
 *
 * A confirmed analysis is changed only by confirming again (the new corrections
 * get the confirming expert's name and time) — never silently under another
 * expert's name. The row was regenerated meanwhile → 409 (reload): a new row,
 * or a new text in the same row (the version the panel opened — R3-VERIFY N3 —
 * checked on read and, by ai_generated_at, atomically in the UPDATE).
 */
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { stableStringify } from './analysis-cache'
import {
  AI_VIEW_COLUMNS, aiAnalysisView, analysisContent, pruneEdits, readExpertEdits,
  type AiAnalysisContent, type AiExpertEdits, type PointAAiAnalysisView,
} from './ai-review'
import { slaStage, slaTimerLabel, type SlaStage } from '@/lib/expert-sla/policy'
import type { AIAnalysis } from '@/types/onboarding'

type Sb = Pick<SupabaseClient, 'from'>

export interface AiReviewTaskView {
  id: string
  receivedAt: string
  reactionDueAt: string
  answerDueAt: string
  firstResponseAt: string | null
  closedAt: string | null
  assignee: { id: string; name: string } | null
  stage: SlaStage
  timer: string
}

export interface AiReviewData {
  diagnosticId: string | null
  /** What the client sees now (corrections applied, «черновик» / «проверено»). */
  view: PointAAiAnalysisView | null
  /** The AI text as generated (without corrections) — what a correction is compared with. */
  ai: AiAnalysisContent | null
  edits: AiExpertEdits | null
  /** There is a text to check: a complete or a partial analysis, not being generated. */
  reviewable: boolean
  /** The expert task (open, or the last one of this analysis). */
  task: AiReviewTaskView | null
  /**
   * R3-VERIFY N3: the version of the AI text the panel shows (generation time + hash of the
   * text). The panel sends it back with «Сохранить» / «Подтвердить»: a text regenerated in
   * the same row meanwhile → 409, the expert never confirms a text he has not seen.
   * Always set by loadAiReview (optional only for hand-built views).
   */
  version?: string | null
}

/** `ai_generated_at` as the database row has it (PostgREST: a string; node-pg: a Date). */
function generatedAtOf(row: Record<string, unknown>): string | null {
  const v = row.ai_generated_at
  if (v instanceof Date) return v.toISOString()
  return typeof v === 'string' && v ? v : null
}

/** The version of the AI text of a row: «<ai_generated_at>#<hash of ai_analysis>». */
export function aiReviewVersion(row: Record<string, unknown>): string {
  const hash = createHash('sha256').update(stableStringify(row.ai_analysis ?? null)).digest('hex').slice(0, 16)
  return `${generatedAtOf(row) ?? ''}#${hash}`
}

const ROW_COLUMNS = `${AI_VIEW_COLUMNS}, user_id, is_current`
const TASK_COLS = 'id, received_at, reaction_due_at, answer_due_at, first_response_at, closed_at, assignee_id, answered'

function storedAnalysis(raw: unknown): Partial<AIAnalysis> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) && !('strengths_text' in (raw as object)) ? (raw as Partial<AIAnalysis>) : null
}

async function currentRow(sb: Sb, clientId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await sb.from('diagnostics').select(ROW_COLUMNS).eq('user_id', clientId).eq('is_current', true).maybeSingle()
  if (error) throw new Error(`diagnostics read failed (${error.code ?? 'unknown'})`)
  return (data as Record<string, unknown> | null) ?? null
}

async function taskOf(sb: Sb, diagnosticId: string, now: Date): Promise<AiReviewTaskView | null> {
  try {
    const { data, error } = await sb.from('expert_sla_tasks').select(TASK_COLS)
      .eq('source', 'pa_ai_review').eq('source_id', diagnosticId)
      .order('received_at', { ascending: false }).limit(1)
    if (error) return null // before migration 152: no task, the review still works
    const t = ((data ?? []) as Array<Record<string, string | null>>)[0]
    if (!t) return null
    let assignee: AiReviewTaskView['assignee'] = null
    if (t.assignee_id) {
      const { data: p } = await sb.from('profiles').select('full_name').eq('id', t.assignee_id).maybeSingle()
      const name = (p as { full_name?: string | null } | null)?.full_name?.trim()
      assignee = { id: t.assignee_id, name: name && !name.includes('@') ? name : 'Эксперт' }
    }
    const times = {
      received_at: String(t.received_at), reaction_due_at: String(t.reaction_due_at), answer_due_at: String(t.answer_due_at),
      first_response_at: t.first_response_at, closed_at: t.closed_at, answered: (t as { answered?: unknown }).answered as boolean | null,
    }
    return {
      id: String(t.id), receivedAt: times.received_at, reactionDueAt: times.reaction_due_at, answerDueAt: times.answer_due_at,
      firstResponseAt: t.first_response_at, closedAt: t.closed_at, assignee,
      stage: slaStage(times, now), timer: slaTimerLabel(times, now),
    }
  } catch {
    return null
  }
}

/** The review card of a client: the analysis (as the client sees it and as the AI wrote it), the corrections, the task. */
export async function loadAiReview(sb: Sb, clientId: string, now: Date = new Date()): Promise<AiReviewData> {
  const row = await currentRow(sb, clientId)
  if (!row) return { diagnosticId: null, view: null, ai: null, edits: null, reviewable: false, task: null, version: null }
  const view = aiAnalysisView(row)
  const ai = analysisContent(storedAnalysis(row.ai_analysis))
  const diagnosticId = String(row.id)
  return {
    diagnosticId,
    view,
    ai,
    edits: readExpertEdits(row.ai_expert_edits),
    reviewable: !!ai && (row.ai_status === 'completed' || row.ai_status === 'failed'),
    task: await taskOf(sb, diagnosticId, now),
    version: aiReviewVersion(row),
  }
}

export type SaveAiReviewResult =
  | { ok: true; data: AiReviewData; edited: string[]; confirmed: boolean; taskId: string | null }
  | { ok: false; status: number; error: string }

/**
 * Save the corrections (`confirm` false) or confirm the analysis with them (`confirm` true). `diagnosticId` is the row
 * the expert opened: when the client's analysis was regenerated meanwhile, nothing is written (409).
 */
export async function saveAiReview(sb: Sb, input: {
  clientId: string
  diagnosticId: string
  edits: AiExpertEdits | null
  confirm: boolean
  actor: { id: string; name: string }
  /** The version the expert opened (AiReviewData.version); omitted by an older panel — then only the row / status checks. */
  version?: string | null
  now?: Date
}): Promise<SaveAiReviewResult> {
  const now = input.now ?? new Date()
  const at = now.toISOString()
  const { data, error } = await sb.from('diagnostics').select(ROW_COLUMNS).eq('id', input.diagnosticId).eq('user_id', input.clientId).maybeSingle()
  if (error) return { ok: false, status: 503, error: 'Не удалось прочитать разбор' }
  const row = data as Record<string, unknown> | null
  if (!row) return { ok: false, status: 404, error: 'Разбор не найден' }
  if (row.is_current !== true) return { ok: false, status: 409, error: 'Разбор обновился — откройте проверку заново' }
  if (row.ai_status === 'processing') return { ok: false, status: 409, error: 'Разбор ещё готовится — проверьте его, когда он будет готов' }
  const ai = analysisContent(storedAnalysis(row.ai_analysis))
  if (!ai || (row.ai_status !== 'completed' && row.ai_status !== 'failed')) {
    return { ok: false, status: 409, error: 'Проверять нечего — разбора ИИ нет' }
  }
  // R3-VERIFY N3: the text was regenerated in this very row after the expert opened it.
  if (input.version && input.version !== aiReviewVersion(row)) {
    return { ok: false, status: 409, error: 'Разбор обновился — откройте проверку заново' }
  }
  if (row.ai_reviewed_at && !input.confirm) {
    return { ok: false, status: 409, error: 'Разбор уже подтверждён — сохраните правки кнопкой «Подтвердить»' }
  }

  const edits = pruneEdits(ai, input.edits)
  const patch: Record<string, unknown> = { ai_expert_edits: edits }
  if (input.confirm) Object.assign(patch, { ai_reviewed_at: at, ai_reviewed_by: input.actor.id, ai_reviewed_by_name: input.actor.name })
  // Optimistic: the very row the expert opened, unchanged status / generation.
  let q = sb.from('diagnostics').update(patch).eq('id', input.diagnosticId).eq('user_id', input.clientId).eq('is_current', true)
  if (typeof row.ai_status === 'string') q = q.eq('ai_status', row.ai_status)
  // …and the same generation, atomically: a regeneration between this read and the write changes it.
  const generatedAt = generatedAtOf(row)
  q = generatedAt ? q.eq('ai_generated_at', generatedAt) : q.is('ai_generated_at', null)
  const { data: written, error: wErr } = await q.select('id')
  if (wErr) return { ok: false, status: 500, error: 'Не удалось сохранить проверку' }
  if (!(written as unknown[] | null)?.length) return { ok: false, status: 409, error: 'Разбор обновился — откройте проверку заново' }

  // SLA (152): a correction / the confirmation is the reaction, the confirmation the answer. Best effort —
  // expert_sla_sync derives the same from the row on its next pass.
  let taskId: string | null = null
  try {
    if (edits || input.confirm) {
      const { data: reacted } = await sb.from('expert_sla_tasks').update({ first_response_at: at })
        .eq('source', 'pa_ai_review').eq('source_id', input.diagnosticId).is('closed_at', null).is('first_response_at', null)
        .select('id')
      taskId = ((reacted ?? []) as Array<{ id: string }>)[0]?.id ?? null
    }
    if (input.confirm) {
      const { data: closed } = await sb.from('expert_sla_tasks').update({ closed_at: at, close_reason: 'reviewed', answered: true })
        .eq('source', 'pa_ai_review').eq('source_id', input.diagnosticId).is('closed_at', null)
        .select('id')
      taskId = ((closed ?? []) as Array<{ id: string }>)[0]?.id ?? taskId
    }
  } catch (err) {
    console.error('[point-a/ai-review] SLA task not updated', err instanceof Error ? err.message : err)
  }

  const data2 = await loadAiReview(sb, input.clientId, now)
  return {
    ok: true,
    data: data2,
    edited: edits ? Object.keys(edits) : [],
    confirmed: input.confirm,
    taskId,
  }
}
