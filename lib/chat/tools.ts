/**
 * lib/chat/tools.ts — the tools of the unified AI chat (spec 2026-10-12 §6.2).
 *
 * read     the company's own data, through the caller's session (RLS) —
 *          Point A, a block with its metrics, metric values and periods,
 *          discrepancies, goals, GRI, Point B, the uploaded documents
 * propose  a change (a metric value for a period, a discrepancy decision, a
 *          goal): NOTHING is written — a card «было → станет» goes to the
 *          user; only «Применить» (POST /api/v1/ai/actions/[id]/apply, which
 *          re-checks access) executes it. Owners / admins only.
 *
 * The company and the user come from the session (ToolContext), never from
 * tool arguments.
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMetricById, getMetricRegistry } from '@/lib/metrics/registry'
import { isPlausibleFor } from '@/lib/metrics/resolver'
import { periodLabel, parsePeriodKey } from '@/lib/data-layer/period-key'
import { loadGoalsWithEvaluation } from '@/lib/goals/current'
import { BLOCK_KEYS, BLOCK_LIBRARY, isBlockKey } from '@/lib/point-a/v4/config'
import { blockMetricIds, loadMetricViews, type MetricView } from '@/lib/point-a/v4/metric-views'
import type { V4Block } from '@/lib/point-a/v4/engine'

export interface ToolContext {
  companyId: string
  userId: string
  /** Owner of the company's questionnaire / documents (companies.user_id). */
  ownerId: string | null
  sb: SupabaseClient
  canManage: boolean
  now: Date
  /** Records a proposed change; returns its id (route: ai_pending_actions). */
  propose: (kind: PendingKind, payload: Record<string, unknown>, preview: ActionPreview) => Promise<string>
  /** Document search of the owner (lib/ai/retrieval) — injected for tests. */
  searchDocuments?: (query: string) => Promise<Array<{ documentName: string; content: string; similarity: number }>>
}

export type PendingKind = 'set_value' | 'resolve_discrepancy' | 'set_goal'

export interface ActionPreview {
  title: string
  before: string | null
  after: string
  note?: string | null
}

export class ChatToolError extends Error {}

export interface ChatTool {
  name: string
  description: string
  kind: 'read' | 'propose'
  input: z.ZodTypeAny
  run: (args: unknown, t: ToolContext) => Promise<Record<string, unknown>>
}

function fmt(n: number | null | undefined, unit = ''): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const s = Math.abs(n) >= 10_000 ? n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : String(Math.round(n * 100) / 100)
  return unit === '%' ? `${s}%` : unit && unit !== 'count' ? `${s} ${unit === 'days' ? 'дн' : unit}` : s
}

function brief(m: MetricView) {
  return {
    id: m.id, label: m.label, value: m.value, unit: m.unit, period: m.period, source: m.source,
    trend_pct: m.trend?.deltaPct ?? null, norm: m.norm ? `${m.norm.direction === 'lower_is_better' ? '≤' : '≥'} ${m.norm.value}` : null,
    needs: m.needs,
  }
}

async function latestSnapshot(t: ToolContext): Promise<Record<string, unknown> | null> {
  const { data, error } = await t.sb.from('point_a_snapshots').select('*').eq('company_id', t.companyId).order('created_at', { ascending: false }).limit(1)
  if (error) throw new ChatToolError('Точка А сейчас недоступна')
  return ((data ?? [])[0] as Record<string, unknown> | undefined) ?? null
}

function findMetrics(query: string): string[] {
  const q = query.toLowerCase().trim()
  return getMetricRegistry()
    .filter((e) => e.id.toLowerCase() === q || e.label.toLowerCase().includes(q) || (e.department ?? '').toLowerCase().includes(q))
    .slice(0, 12)
    .map((e) => e.id)
}

const blockKey = z.enum(BLOCK_KEYS)

export const CHAT_TOOLS: readonly ChatTool[] = [
  {
    name: 'get_point_a',
    description: 'Текущая Точка А компании: общий балл 0–100, достоверность, полнота данных, стадия, баллы и главные проблемы по блокам, блоки без данных, сильные стороны, что загрузить. Вызывай первым для вопросов о состоянии бизнеса.',
    kind: 'read',
    input: z.object({}).strict(),
    async run(_a, t) {
      const s = await latestSnapshot(t)
      if (!s) return { status: 'not_calculated', note: 'Точка А ещё не рассчитана — нужна заполненная анкета.' }
      const blocks = (s.blocks as V4Block[]) ?? []
      const v4 = (s.v4 ?? {}) as Record<string, unknown>
      return {
        calculated_at: s.created_at, overall: s.overall, confidence: s.confidence, coverage: s.coverage, stage: s.stage,
        blocks: blocks.map((b) => ({
          key: b.key, title: b.title, score: b.score, status: b.status, coverage: b.coverage, confidence: b.confidence, weight: b.weight,
          top_issues: b.top_issues, recommendations: b.recommendations, hypothesis: b.hypothesis ? { score: b.hypothesis.score, note: 'гипотеза AI, не факт' } : null,
          conflicts: b.conflicts,
        })),
        strengths: v4.strengths ?? [], upload_checklist: v4.upload_checklist ?? [],
        recent_changes: ((s.change_reasons as Array<{ text: string }>) ?? []).map((c) => c.text).slice(0, 8),
      }
    },
  },
  {
    name: 'explain_block',
    description: 'Подробно о разделе Точки А: из чего сложился балл (каждая проверка: ответ, баллы, найденная проблема), чего не хватает, что сделать, и реальные показатели раздела (значение, период, источник, динамика, норма).',
    kind: 'read',
    input: z.object({ block: blockKey }).strict(),
    async run(raw, t) {
      const { block } = raw as { block: (typeof BLOCK_KEYS)[number] }
      const s = await latestSnapshot(t)
      const b = ((s?.blocks as V4Block[] | undefined) ?? []).find((x) => x.key === block) ?? null
      const metrics = await loadMetricViews(t.sb, t.companyId, blockMetricIds(block))
      return {
        block: BLOCK_LIBRARY[block].title, description: BLOCK_LIBRARY[block].description,
        score: b?.score ?? null, coverage: b?.coverage ?? null, confidence: b?.confidence ?? null,
        checks: b?.checks.filter((c) => !c.excluded).map((c) => ({ id: c.id, answered: c.answered, earned: c.earned, max: c.max, issue: c.issue ?? null, missing: c.missing ?? null })) ?? [],
        needs: b?.needs ?? [], recommendations: b?.recommendations ?? [],
        metrics: metrics.map(brief),
      }
    },
  },
  {
    name: 'get_metrics',
    description: 'Текущие значения метрик компании с периодом, источником, динамикой и нормой. Передай ids из каталога или query — часть названия («выручка», «конверсия», «NPS»).',
    kind: 'read',
    input: z.object({ ids: z.array(z.string()).max(15).optional(), query: z.string().max(80).optional() }).strict(),
    async run(raw, t) {
      const a = raw as { ids?: string[]; query?: string }
      const ids = [...(a.ids ?? []).filter((id) => getMetricById(id)), ...(a.query ? findMetrics(a.query) : [])].slice(0, 15)
      if (!ids.length) return { items: [], note: 'Такой метрики в каталоге нет — уточните название.' }
      return { items: (await loadMetricViews(t.sb, t.companyId, ids)).map(brief) }
    },
  },
  {
    name: 'get_metric_history',
    description: 'Все наблюдения метрики по периодам и источникам (анкета, документы, вручную, интеграции) — чтобы объяснить динамику или расхождение.',
    kind: 'read',
    input: z.object({ metric_id: z.string() }).strict(),
    async run(raw, t) {
      const { metric_id } = raw as { metric_id: string }
      if (!getMetricById(metric_id)) throw new ChatToolError('Неизвестная метрика')
      const { data, error } = await t.sb.from('metric_facts').select('period_key, value, unit, source_kind, flags, confidence, note').eq('company_id', t.companyId).eq('metric_key', metric_id).order('period_key', { ascending: true }).limit(60)
      if (error) throw new ChatToolError('История недоступна')
      return { metric: getMetricById(metric_id)!.label, observations: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...r, period: periodLabel(String(r.period_key)) })) }
    },
  },
  {
    name: 'list_discrepancies',
    description: 'Открытые расхождения в данных: метрика, период, варианты значений из разных источников и какое сейчас в расчёте.',
    kind: 'read',
    input: z.object({}).strict(),
    async run(_a, t) {
      const { data, error } = await t.sb.from('data_discrepancies').select('id, metric_key, period_key, kind, chosen_value, candidates').eq('company_id', t.companyId).eq('status', 'open').limit(30)
      if (error) return { items: [] }
      return {
        items: ((data ?? []) as Array<Record<string, unknown>>).map((d) => ({
          id: d.id, metric: getMetricById(String(d.metric_key))?.label ?? d.metric_key, period: periodLabel(String(d.period_key)), kind: d.kind,
          in_use: d.chosen_value, candidates: d.candidates,
        })),
      }
    },
  },
  {
    name: 'get_goals',
    description: 'Цели компании: метрика, текущее значение, цель, срок, разрыв, нужный темп, реалистичность и статус.',
    kind: 'read',
    input: z.object({}).strict(),
    async run(_a, t) {
      const items = await loadGoalsWithEvaluation(t.sb, t.companyId, t.now)
      return { items: items.map(({ goal, evaluation: e }) => ({ id: goal.id, metric: goal.metricId, label: goal.label, current: e.current, target: e.target, deadline: e.deadline, gap: e.gap, realism: e.realismText, status: e.status, progress: e.progress })) }
    },
  },
  {
    name: 'get_gri',
    description: 'GRI — индекс готовности к росту (0–100, отдельный от Точки А показатель): итог, баллы по разделам, главные ограничения.',
    kind: 'read',
    input: z.object({}).strict(),
    async run(_a, t) {
      let q = t.sb.from('gri_assessments').select('gri_index, section_avgs, top_5_limits, created_at').eq('is_current', true)
      q = t.ownerId ? q.or(`company_id.eq.${t.companyId},user_id.eq.${t.ownerId}`) : q.eq('company_id', t.companyId)
      const { data } = await q.order('created_at', { ascending: false }).limit(1)
      const g = (data ?? [])[0] as Record<string, unknown> | undefined
      if (!g) return { status: 'not_assessed' }
      return { index_100: Math.round(Number(g.gri_index) * 10), sections_0_10: g.section_avgs, top_limits: g.top_5_limits, assessed_at: g.created_at }
    },
  },
  {
    name: 'get_point_b',
    description: 'Точка Б: целевое состояние, разрыв по выручке, требуемый темп, реалистичность цели и план по горизонтам.',
    kind: 'read',
    input: z.object({}).strict(),
    async run(_a, t) {
      const { data: diag } = await t.sb.from('diagnostics').select('id').eq('company_id', t.companyId).eq('is_current', true).maybeSingle()
      if (!diag) return { status: 'not_calculated' }
      const { data } = await t.sb.from('point_b_analysis').select('roadmap, calculated_at').eq('diagnostic_id', (diag as { id: string }).id).eq('is_current', true).maybeSingle()
      const r = (data as { roadmap?: Record<string, unknown> } | null)?.roadmap
      if (!r) return { status: 'not_calculated' }
      return { gap: r.gap, realism: r.realism, target_overall: r.target_overall_score, horizons: r.horizons, levers: r.levers }
    },
  },
  {
    name: 'search_documents',
    description: 'Поиск по загруженным документам компании (отчётность, выгрузки): возвращает подходящие фрагменты с названием документа.',
    kind: 'read',
    input: z.object({ query: z.string().min(2).max(200) }).strict(),
    async run(raw, t) {
      if (!t.searchDocuments) return { items: [] }
      const items = await t.searchDocuments((raw as { query: string }).query)
      return { items: items.slice(0, 6).map((c) => ({ document: c.documentName, text: c.content.slice(0, 1200), similarity: Math.round(c.similarity * 100) / 100 })) }
    },
  },
  {
    name: 'propose_metric_value',
    description: 'ПРЕДЛОЖИТЬ исправить значение метрики за период (например «выручка за 2024 — 14 млн»). Ничего не меняет: пользователь увидит карточку и сам нажмёт «Применить». Используй, только если пользователь прямо просит исправить или подтвердить значение.',
    kind: 'propose',
    input: z.object({ metric_id: z.string(), period: z.string().describe("'2024' | '2025-Q2' | '2025-03'"), value: z.number().finite(), reason: z.string().max(300) }).strict(),
    async run(raw, t) {
      const a = raw as { metric_id: string; period: string; value: number; reason: string }
      const e = getMetricById(a.metric_id)
      if (!e) throw new ChatToolError('Неизвестная метрика')
      if (!parsePeriodKey(a.period)) throw new ChatToolError('Период: «2024», «2025-Q2» или «2025-03»')
      if (!isPlausibleFor(e, a.value)) throw new ChatToolError(`Значение ${a.value} вне допустимого диапазона метрики`)
      const [cur] = await loadMetricViews(t.sb, t.companyId, [e.id])
      const id = await t.propose('set_value', { metric_id: e.id, period_key: a.period, value: a.value, note: a.reason }, {
        title: `${e.label} · ${periodLabel(a.period)}`, before: cur?.value !== null && cur?.value !== undefined ? `${fmt(cur.value, e.unit)}${cur.period ? ` (${cur.period})` : ''}` : null, after: fmt(a.value, e.unit), note: a.reason,
      })
      return { status: 'proposed', action_id: id, note: 'Ничего не изменено: пользователь подтвердит карточку сам.' }
    },
  },
  {
    name: 'propose_resolve_discrepancy',
    description: 'ПРЕДЛОЖИТЬ решение расхождения: выбрать вариант (index из list_discrepancies) или своё значение. Ничего не меняет до подтверждения пользователем.',
    kind: 'propose',
    input: z.object({ discrepancy_id: z.string().uuid(), index: z.number().int().min(0).optional(), value: z.number().finite().optional(), reason: z.string().max(300) }).strict(),
    async run(raw, t) {
      const a = raw as { discrepancy_id: string; index?: number; value?: number; reason: string }
      if (a.index === undefined && a.value === undefined) throw new ChatToolError('Нужен index варианта или value')
      const { data } = await t.sb.from('data_discrepancies').select('id, metric_key, period_key, candidates, chosen_value').eq('id', a.discrepancy_id).eq('company_id', t.companyId).eq('status', 'open').maybeSingle()
      const d = data as { metric_key: string; period_key: string; candidates: Array<{ value: number; unit: string; sourceRef: string; sourceKind: string }>; chosen_value: number | null } | null
      if (!d) throw new ChatToolError('Открытое расхождение не найдено')
      const c = a.index !== undefined ? d.candidates[a.index] : null
      if (a.index !== undefined && !c) throw new ChatToolError('Нет такого варианта')
      const unit = getMetricById(d.metric_key)?.unit ?? ''
      const after = c ? `${fmt(c.value, unit)} (${c.sourceKind === 'survey' ? 'анкета' : c.sourceKind === 'document' ? 'документ' : c.sourceKind})` : fmt(a.value, unit)
      const body = c ? { choice: 'candidate', index: a.index, expected: { sourceRef: c.sourceRef, value: Number(c.value) } } : { choice: 'custom', value: a.value }
      const id = await t.propose('resolve_discrepancy', { discrepancy_id: a.discrepancy_id, body: { ...body, note: a.reason } }, {
        title: `Расхождение: ${getMetricById(d.metric_key)?.label ?? d.metric_key} · ${periodLabel(d.period_key)}`, before: d.chosen_value === null ? null : fmt(Number(d.chosen_value), unit), after, note: a.reason,
      })
      return { status: 'proposed', action_id: id, note: 'Ничего не изменено: пользователь подтвердит карточку сам.' }
    },
  },
  {
    name: 'propose_goal',
    description: 'ПРЕДЛОЖИТЬ цель по метрике: значение и горизонт («12m», «3y», «2026-Q4», «2027»). Ничего не меняет до подтверждения пользователем.',
    kind: 'propose',
    input: z.object({ metric_id: z.string(), target_value: z.number().finite(), period_label: z.string().regex(/^([1-9]\d{0,2}m|[1-9]\d?y|\d{4}-Q[1-4]|\d{4})$/i), reason: z.string().max(300) }).strict(),
    async run(raw, t) {
      const a = raw as { metric_id: string; target_value: number; period_label: string; reason: string }
      const e = getMetricById(a.metric_id)
      if (!e) throw new ChatToolError('Неизвестная метрика')
      const goals = await loadGoalsWithEvaluation(t.sb, t.companyId, t.now)
      const prev = goals.find((g) => g.goal.metricId === e.id && g.goal.periodLabel === a.period_label)
      const horizon = a.period_label === '12m' ? 'через 12 мес.' : a.period_label === '3y' ? 'через 3 года' : `к ${a.period_label}`
      const id = await t.propose('set_goal', { metricId: e.id, targetValue: a.target_value, periodLabel: a.period_label, label: `${e.label} ${horizon}` }, {
        title: `Цель: ${e.label} ${horizon}`, before: prev ? fmt(prev.goal.targetValue, e.unit) : null, after: fmt(a.target_value, e.unit), note: a.reason,
      })
      return { status: 'proposed', action_id: id, note: 'Ничего не изменено: пользователь подтвердит карточку сам.' }
    },
  },
]

/** Tools a caller may use: proposals only for owners / admins. */
export function toolsFor(canManage: boolean): ChatTool[] {
  return CHAT_TOOLS.filter((t) => t.kind === 'read' || canManage)
}

export { isBlockKey }
