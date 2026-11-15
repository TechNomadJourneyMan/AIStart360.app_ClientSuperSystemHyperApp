/**
 * lib/point-a/ai-review.ts — the AI analysis of Point A as the CLIENT sees it
 * (R3-PA, решение PO «гибрид»): a draft of the AI the client sees at once,
 * marked «Черновик ИИ — эксперт проверит», until an expert checks it; the
 * expert's corrections are laid over the AI text, never written into it.
 *
 * Also the diagnosis of a generation (migration 150): which part of the
 * 4-part analysis failed and why (`ai_error`), which model answered
 * (`ai_model`), when (`ai_generated_at`).
 *
 * Pure and browser-safe (no server imports).
 */
import { z } from 'zod'
import type { AIAnalysis, AIBlockAnalysis, RoadmapItem, StrategicPriority } from '@/types/onboarding'

// ─── Parts of one generation (lib/ai/point-a-analyzer.ts) ───────────────────

export const ANALYSIS_PARTS = ['summary', 'priorities', 'blocksA', 'blocksB'] as const
export type AnalysisPart = (typeof ANALYSIS_PARTS)[number]

/** What the client misses when a part did not come (Russian, lower case). */
export const PART_LABEL_RU: Record<AnalysisPart, string> = {
  summary: 'резюме и отраслевой контекст',
  priorities: 'стратегические приоритеты',
  blocksA: 'разбор финансов, продаж и операций',
  blocksB: 'разбор маркетинга и стратегии, план 30/90/180 дней',
}

/**
 * Why a part (or the whole call) failed — a short code, never a provider body
 * (it may echo client data): schema / cut / not_json (the answer), http_<n> /
 * timeout / no_answer / no_route / budget / no_key / error (the call).
 */
export type PartFailure = string

export interface PartOutcome {
  ok: boolean
  failure: PartFailure | null
  /** The model that answered (the last attempt), when one did. */
  model: string | null
}

export interface PointAAnalysisReport {
  parts: Record<AnalysisPart, PartOutcome>
  startedAt: string
  finishedAt: string
}

/**
 * A partial analysis is kept when at least this many of the 4 parts came
 * (решение R3-PA): the paid calls that succeeded are not thrown away, the
 * client sees what is ready and «часть не получилась — повторить».
 */
export const MIN_PARTS_FOR_PARTIAL = 3

/** Max length of diagnostics.ai_error (CHECK of migration 150). */
export const AI_ERROR_MAX = 500

/** «blocksB:cut; summary:schema» — the failed parts of a generation; null when every part came. */
export function aiErrorOf(report: PointAAnalysisReport): string | null {
  const failed = ANALYSIS_PARTS.filter((p) => !report.parts[p]?.ok).map((p) => `${p}:${report.parts[p]?.failure ?? 'error'}`)
  return failed.length ? clipAiError(failed.join('; ')) : null
}

/** A route-level code («budget», «input:survey», «fanout:http_504») within the column limit. */
export function clipAiError(code: string): string {
  const clean = code.replace(/[\r\n\t]+/g, ' ').trim()
  return clean.length > AI_ERROR_MAX ? `${clean.slice(0, AI_ERROR_MAX - 1)}…` : clean
}

/** The models that answered, in part order, without repeats: «anthropic/claude-haiku-4.5 + qwen3-8». */
export function aiModelOf(report: PointAAnalysisReport): string | null {
  const seen: string[] = []
  for (const p of ANALYSIS_PARTS) {
    const m = report.parts[p]?.model
    if (m && !seen.includes(m)) seen.push(m)
  }
  return seen.length ? seen.join(' + ') : null
}

/** The parts that came. */
export function partsOk(report: PointAAnalysisReport): AnalysisPart[] {
  return ANALYSIS_PARTS.filter((p) => report.parts[p]?.ok)
}

// ─── The expert's corrections (diagnostics.ai_expert_edits) ─────────────────

const text = z.string().trim().min(1).max(4000)
const blockEdit = z.object({
  diagnosis: text.optional(),
  benchmark_comparison: text.optional(),
  key_risk: text.optional(),
  top_recommendation: text.optional(),
}).strict()

/**
 * What an expert may correct: any text of the analysis, the priorities and the
 * plan as a whole, and a note to the client. Unknown keys are refused (the
 * future expert route validates with this schema).
 */
export const AiExpertEditsSchema = z.object({
  executive_summary: text.optional(),
  industry_context: text.optional(),
  strategic_priorities: z.array(z.object({ title: text, rationale: text, expected_impact: text }).strict()).min(1).max(6).optional(),
  growth_roadmap: z.array(z.object({ horizon: z.enum(['30_days', '90_days', '180_days']), actions: z.array(text).min(1).max(8) }).strict()).min(1).max(3).optional(),
  blocks: z.record(z.string().min(1).max(40), blockEdit).optional(),
  note: text.optional(),
}).strict()

export type AiExpertEdits = z.infer<typeof AiExpertEditsSchema>

/** The edits of a row, or null (none / not an object / an invalid value — never thrown at a reader). */
export function readExpertEdits(v: unknown): AiExpertEdits | null {
  const r = AiExpertEditsSchema.safeParse(v)
  return r.success ? r.data : null
}

/** The analysis content the page shows (no bookkeeping keys). */
export interface AiAnalysisContent {
  executive_summary: string | null
  industry_context: string | null
  strategic_priorities: StrategicPriority[]
  growth_roadmap: RoadmapItem[]
  blocks: Record<string, Partial<AIBlockAnalysis>>
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** A timestamp as ISO text: PostgREST sends strings, node-pg / Prisma readers send Date objects. */
function isoOf(v: unknown): string | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : null
  return str(v)
}

/** The AI text of a stored analysis, tolerant of partial / older shapes. */
export function analysisContent(ai: Partial<AIAnalysis> | null | undefined): AiAnalysisContent | null {
  if (!ai) return null
  const blocks: AiAnalysisContent['blocks'] = {}
  if (isRecord(ai.blocks)) {
    for (const [k, b] of Object.entries(ai.blocks)) {
      if (!isRecord(b)) continue
      const out: Partial<AIBlockAnalysis> = {}
      for (const f of ['diagnosis', 'benchmark_comparison', 'key_risk', 'top_recommendation'] as const) {
        const s = str(b[f])
        if (s) out[f] = s
      }
      if (Object.keys(out).length) blocks[k] = out
    }
  }
  const priorities = Array.isArray(ai.strategic_priorities)
    ? ai.strategic_priorities.filter((p) => isRecord(p) && str(p.title)).map((p) => ({ title: String(p.title).trim(), rationale: str(p.rationale) ?? '', expected_impact: str(p.expected_impact) ?? '' }))
    : []
  const roadmap = Array.isArray(ai.growth_roadmap)
    ? ai.growth_roadmap.filter((r) => isRecord(r) && Array.isArray(r.actions)).map((r) => ({ horizon: r.horizon, actions: r.actions.map((a) => String(a).trim()).filter(Boolean) })).filter((r) => r.actions.length > 0)
    : []
  const content: AiAnalysisContent = {
    executive_summary: str(ai.executive_summary),
    industry_context: str(ai.industry_context),
    strategic_priorities: priorities,
    growth_roadmap: roadmap as RoadmapItem[],
    blocks,
  }
  const empty = !content.executive_summary && !content.industry_context && !priorities.length && !roadmap.length && !Object.keys(blocks).length
  return empty ? null : content
}

/** The expert's corrections over the AI text; `edited` names what the expert changed. */
export function applyExpertEdits(content: AiAnalysisContent | null, edits: AiExpertEdits | null): { content: AiAnalysisContent | null; edited: string[] } {
  if (!edits) return { content, edited: [] }
  const base: AiAnalysisContent = content ?? { executive_summary: null, industry_context: null, strategic_priorities: [], growth_roadmap: [], blocks: {} }
  const edited: string[] = []
  const out: AiAnalysisContent = { ...base, blocks: { ...base.blocks } }
  if (edits.executive_summary) { out.executive_summary = edits.executive_summary; edited.push('executive_summary') }
  if (edits.industry_context) { out.industry_context = edits.industry_context; edited.push('industry_context') }
  if (edits.strategic_priorities) { out.strategic_priorities = edits.strategic_priorities; edited.push('strategic_priorities') }
  if (edits.growth_roadmap) { out.growth_roadmap = edits.growth_roadmap as RoadmapItem[]; edited.push('growth_roadmap') }
  for (const [k, b] of Object.entries(edits.blocks ?? {})) {
    if (!Object.keys(b).length) continue
    out.blocks[k] = { ...(out.blocks[k] ?? {}), ...b }
    edited.push(`blocks.${k}`)
  }
  return { content: edited.length || content ? out : null, edited }
}

// ─── The view of one diagnostics row ────────────────────────────────────────

export const AI_DRAFT_LABEL = 'Черновик ИИ — эксперт проверит'
export const AI_REVIEWED_LABEL = 'Проверено экспертом'

/** Columns of public.diagnostics the view reads (150 columns included). */
export const AI_VIEW_COLUMNS = 'id, ai_status, ai_analysis, ai_error, ai_model, ai_generated_at, ai_reviewed_at, ai_reviewed_by_name, ai_expert_edits'
/** The same before migration 150. */
export const AI_VIEW_COLUMNS_PRE150 = 'id, ai_status, ai_analysis'

export type AiAnalysisStatus = 'processing' | 'completed' | 'partial' | 'failed' | 'none'

export interface PointAAiAnalysisView {
  diagnosticId: string
  status: AiAnalysisStatus
  /** The text to show (expert's corrections applied), or null. */
  analysis: AiAnalysisContent | null
  /** A partial analysis: the parts that did not come. */
  missingParts: AnalysisPart[]
  /** Not checked by an expert yet → «Черновик ИИ — эксперт проверит». */
  draft: boolean
  review: { by: string | null; at: string } | null
  /** What the expert corrected (empty: the AI text as it is). */
  editedByExpert: string[]
  expertNote: string | null
  /** diagnostics.ai_error — for staff; the client gets a plain sentence. */
  errorCode: string | null
  model: string | null
  generatedAt: string | null
  /**
   * R3-SLA: the expert's task to confirm this analysis (migration 152) — «Эксперт проверит до <срок>» while it is
   * open and the deadline has not passed. Absent / null — no promise of a date.
   */
  reviewDue?: { at: string; overdue: boolean } | null
}

/** ai_analysis.partial of a stored partial analysis: the parts that did not come. */
export function missingPartsOf(ai: unknown): AnalysisPart[] {
  if (!isRecord(ai) || !Array.isArray(ai.partial)) return []
  return ai.partial.filter((p): p is AnalysisPart => (ANALYSIS_PARTS as readonly unknown[]).includes(p))
}

/**
 * The view of a diagnostics row (AI_VIEW_COLUMNS). `ai_status` 'none' → no
 * analysis (not requested: before the official score, or no paid access).
 * 'failed' keeps the last analysis of the row when there is one — a partial
 * one (ai_analysis.partial) or a complete one an unsuccessful retry left.
 */
export function aiAnalysisView(row: Record<string, unknown> | null | undefined): PointAAiAnalysisView | null {
  if (!row || row.id === undefined || row.id === null) return null
  const raw = row.ai_status
  const stored = isRecord(row.ai_analysis) && !('strengths_text' in row.ai_analysis) ? (row.ai_analysis as Partial<AIAnalysis>) : null
  const missing = missingPartsOf(stored)
  const edits = readExpertEdits(row.ai_expert_edits)
  const reviewedAt = isoOf(row.ai_reviewed_at)
  const status: AiAnalysisStatus = raw === 'processing' ? 'processing'
    : raw === 'completed' ? (stored ? 'completed' : 'failed')
    : raw === 'failed' ? (stored && missing.length ? 'partial' : 'failed')
    : 'none'
  const { content, edited } = status === 'none' ? { content: null, edited: [] } : applyExpertEdits(analysisContent(stored), edits)
  return {
    diagnosticId: String(row.id),
    status,
    analysis: content,
    missingParts: status === 'partial' ? missing : [],
    draft: !reviewedAt,
    review: reviewedAt ? { by: str(row.ai_reviewed_by_name), at: reviewedAt } : null,
    editedByExpert: edited,
    expertNote: edits?.note ?? null,
    errorCode: str(row.ai_error),
    model: str(row.ai_model) ?? str(stored?.model_used),
    generatedAt: isoOf(row.ai_generated_at) ?? str(stored?.generated_at),
  }
}

/** The line next to the analysis in the PDF and the share link (null: nothing AI to label). */
export function aiAnalysisNote(view: Pick<PointAAiAnalysisView, 'draft' | 'review'> | null): string | null {
  if (!view) return null
  if (!view.draft && view.review) {
    const at = new Date(view.review.at)
    const date = Number.isFinite(at.getTime()) ? at.toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty' }) : ''
    return `${AI_REVIEWED_LABEL}${view.review.by ? `: ${view.review.by}` : ''}${date ? `, ${date}` : ''}`
  }
  return `${AI_DRAFT_LABEL}. Разбор подготовлен ИИ по вашим данным и ещё не проверен экспертом.`
}

/** The client's sentence for a failed generation (the code stays for staff). */
export function aiFailureText(view: Pick<PointAAiAnalysisView, 'status' | 'missingParts' | 'analysis'>): string {
  if (view.status === 'partial') {
    return `Часть разбора не получилась: ${view.missingParts.map((p) => PART_LABEL_RU[p]).join('; ')}. Остальное — ниже.`
  }
  return view.analysis
    ? 'Последняя попытка обновить разбор не удалась — показан предыдущий вариант.'
    : 'Разбор ИИ не удался.'
}

// ─── The expert's review form (R3-SLA: the route of the expert / staff) ─────

export const ROADMAP_HORIZONS = ['30_days', '90_days', '180_days'] as const
export const BLOCK_EDIT_FIELDS = ['diagnosis', 'benchmark_comparison', 'key_risk', 'top_recommendation'] as const

/** The editor's form: the text the client sees now (the AI text with the corrections applied), plain strings. */
export interface AiReviewForm {
  executive_summary: string
  industry_context: string
  strategic_priorities: Array<{ title: string; rationale: string; expected_impact: string }>
  /** One entry per horizon, actions one per line. */
  growth_roadmap: Record<(typeof ROADMAP_HORIZONS)[number], string>
  blocks: Record<string, Record<(typeof BLOCK_EDIT_FIELDS)[number], string>>
  note: string
}

export function reviewFormOf(content: AiAnalysisContent | null, note: string | null = null): AiReviewForm {
  const roadmap = Object.fromEntries(ROADMAP_HORIZONS.map((h) => [h, (content?.growth_roadmap.find((r) => r.horizon === h)?.actions ?? []).join('\n')])) as AiReviewForm['growth_roadmap']
  const blocks: AiReviewForm['blocks'] = {}
  for (const [k, b] of Object.entries(content?.blocks ?? {})) {
    blocks[k] = Object.fromEntries(BLOCK_EDIT_FIELDS.map((f) => [f, b[f] ?? ''])) as AiReviewForm['blocks'][string]
  }
  return {
    executive_summary: content?.executive_summary ?? '',
    industry_context: content?.industry_context ?? '',
    strategic_priorities: (content?.strategic_priorities ?? []).map((p) => ({ title: p.title, rationale: p.rationale ?? '', expected_impact: p.expected_impact ?? '' })),
    growth_roadmap: roadmap,
    blocks,
    note: note ?? '',
  }
}

const clean = (v: string | null | undefined): string => (v ?? '').replace(/\r\n/g, '\n').trim()

/**
 * The form as corrections (AiExpertEdits shape, every filled field). The server keeps only what differs from the AI
 * text ({@link pruneEdits}); an emptied field means «as the AI wrote it» — the AI text is never deleted, only replaced.
 */
export function editsFromForm(form: AiReviewForm): AiExpertEdits {
  const out: AiExpertEdits = {}
  if (clean(form.executive_summary)) out.executive_summary = clean(form.executive_summary)
  if (clean(form.industry_context)) out.industry_context = clean(form.industry_context)
  const priorities = form.strategic_priorities
    .map((p) => ({ title: clean(p.title), rationale: clean(p.rationale), expected_impact: clean(p.expected_impact) }))
    .filter((p) => p.title && p.rationale && p.expected_impact)
  if (priorities.length) out.strategic_priorities = priorities.slice(0, 6)
  const roadmap = ROADMAP_HORIZONS
    .map((h) => ({ horizon: h, actions: clean(form.growth_roadmap[h]).split('\n').map((a) => a.trim()).filter(Boolean).slice(0, 8) }))
    .filter((r) => r.actions.length > 0)
  if (roadmap.length) out.growth_roadmap = roadmap
  const blocks: NonNullable<AiExpertEdits['blocks']> = {}
  for (const [k, b] of Object.entries(form.blocks)) {
    const e: Record<string, string> = {}
    for (const f of BLOCK_EDIT_FIELDS) if (clean(b[f])) e[f] = clean(b[f])
    if (Object.keys(e).length) blocks[k] = e
  }
  if (Object.keys(blocks).length) out.blocks = blocks
  if (clean(form.note)) out.note = clean(form.note)
  return out
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Corrections = only what differs from the AI text: a field equal to the AI text is not a correction (the client
 * would see «поправлено экспертом» on a text nobody changed). null — nothing left.
 */
export function pruneEdits(ai: AiAnalysisContent | null, edits: AiExpertEdits | null): AiExpertEdits | null {
  if (!edits) return null
  const out: AiExpertEdits = {}
  if (edits.executive_summary && clean(edits.executive_summary) !== clean(ai?.executive_summary)) out.executive_summary = edits.executive_summary
  if (edits.industry_context && clean(edits.industry_context) !== clean(ai?.industry_context)) out.industry_context = edits.industry_context
  if (edits.strategic_priorities) {
    const base = (ai?.strategic_priorities ?? []).map((p) => ({ title: clean(p.title), rationale: clean(p.rationale), expected_impact: clean(p.expected_impact) }))
    const mine = edits.strategic_priorities.map((p) => ({ title: clean(p.title), rationale: clean(p.rationale), expected_impact: clean(p.expected_impact) }))
    if (!same(base, mine)) out.strategic_priorities = edits.strategic_priorities
  }
  if (edits.growth_roadmap) {
    const norm = (rs: ReadonlyArray<{ horizon: string; actions: readonly string[] }>) =>
      ROADMAP_HORIZONS.map((h) => (rs.find((r) => r.horizon === h)?.actions ?? []).map((a) => clean(a)).filter(Boolean))
    if (!same(norm(ai?.growth_roadmap ?? []), norm(edits.growth_roadmap))) out.growth_roadmap = edits.growth_roadmap
  }
  if (edits.blocks) {
    const blocks: NonNullable<AiExpertEdits['blocks']> = {}
    for (const [k, b] of Object.entries(edits.blocks)) {
      const e: Record<string, string> = {}
      for (const f of BLOCK_EDIT_FIELDS) {
        const v = b[f]
        if (v && clean(v) !== clean(ai?.blocks[k]?.[f])) e[f] = v
      }
      if (Object.keys(e).length) blocks[k] = e
    }
    if (Object.keys(blocks).length) out.blocks = blocks
  }
  if (edits.note && clean(edits.note)) out.note = edits.note
  return Object.keys(out).length ? out : null
}
