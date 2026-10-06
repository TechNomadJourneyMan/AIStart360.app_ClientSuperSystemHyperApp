/**
 * lib/diagnostics/ai.ts — model prompts of the `diagnostic` (hypotheses) and
 * `recommendation` agents, and the validation of what the model returns.
 *
 * What the model sees: an evidence list built from the company's own computed
 * data — block scores and issues of the rule engine, materialised metric
 * values with their source, findings of the deterministic stages. No contact
 * data (names, phones, emails), no raw documents, no secrets. The list is
 * fenced as untrusted data (it contains client-controlled text such as file
 * names), so instructions inside it are ignored.
 *
 * What is accepted back: JSON validated with Zod; every hypothesis /
 * recommendation must cite ids from the evidence list (unknown ids are
 * dropped; nothing left ⇒ the item is dropped); areas must be known metric
 * categories; confidence is capped (findings-store AI_MAX_CONFIDENCE).
 * Results are stored as AI_HYPOTHESIS / model recommendations, hidden from the
 * client until a staff member reviews them.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { fenceUntrusted, UNTRUSTED_DATA_RULES } from '@/lib/ai/gateway'
import { METRIC_CATEGORIES, isMetricCategoryKey } from '@/lib/metrics/taxonomy'
import { getMetricById } from '@/lib/metrics/registry'
import type { PointA } from '@/types/onboarding'
import type { ActiveFindingRow, Evidence, FindingDraft, RecommendationDraft } from './findings-store'
import type { CompanyProfile } from './scoring'

export const HYPOTHESES_PROMPT_VERSION = 'diagnostic-hypotheses@1'
export const RECOMMENDATIONS_PROMPT_VERSION = 'diagnostic-recommendations@1'

export interface EvidenceItem {
  id: string
  text: string
  ref: Evidence
}

export interface MetricForPrompt {
  metric_key: string
  metric_value: number | null
  metric_unit: string | null
  source: string | null
  period_year: number | null
}

const MAX_METRICS = 60
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

/**
 * Canonical order of the evidence: the same data must produce the same list
 * (ids and text), or the input hash would change without any real change.
 */
function byFinding(a: ActiveFindingRow, b: ActiveFindingRow): number {
  return (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
    || a.produced_by.localeCompare(b.produced_by) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
}

function byMetric(a: MetricForPrompt, b: MetricForPrompt): number {
  return a.metric_key.localeCompare(b.metric_key) || (a.source ?? '').localeCompare(b.source ?? '')
    || (a.period_year ?? 0) - (b.period_year ?? 0) || (a.metric_value ?? 0) - (b.metric_value ?? 0)
}
const MAX_FINDINGS = 40
const SOURCE_RU: Record<string, string> = { survey: 'анкета', document: 'документ', manual: 'ручной ввод', external: 'внешняя система', prisma: 'CRM' }
const BLOCK_RU: Record<string, string> = { finance: 'Финансы', sales: 'Продажи', operations: 'Операции', marketing: 'Маркетинг', strategy: 'Стратегия' }
const CATEGORY_LIST = METRIC_CATEGORIES.map((c) => `${c.key} (${c.label})`).join(', ')

function profileLines(c: CompanyProfile | null): string[] {
  if (!c) return []
  return [
    c.industry ? `Отрасль: ${c.industry}` : null,
    c.stage ? `Стадия: ${c.stage}` : null,
    c.size ? `Размер: ${c.size}` : null,
    c.businessModel ? `Бизнес-модель: ${c.businessModel}` : null,
  ].filter((l): l is string => Boolean(l))
}

/** Evidence list for the hypotheses prompt. Ids are short and stable within one call. */
export function buildDiagnosticEvidence(args: {
  diagnosticId: string
  pointA: PointA
  metrics: MetricForPrompt[]
  findings: ActiveFindingRow[]
}): EvidenceItem[] {
  const items: EvidenceItem[] = []
  for (const [key, block] of Object.entries(args.pointA.blocks)) {
    if (!block || typeof block.score !== 'number') continue
    const issues = (block.top_issues ?? []).slice(0, 3).join('; ')
    items.push({
      id: `b.${key}`,
      text: `Блок «${BLOCK_RU[key] ?? key}»: ${block.score}/100 (${block.status})${issues ? `; проблемы: ${issues}` : ''}`,
      ref: { type: 'diagnostic', ref: args.diagnosticId, field: `${key}_score`, value: block.score },
    })
  }
  args.pointA.risks.slice(0, 10).forEach((r, i) => {
    items.push({
      id: `r.${i + 1}`,
      text: `Риск (правило): ${r.text}${r.impact ? ` — ${r.impact}` : ''} [${r.area}, ${r.level}]`,
      ref: { type: 'diagnostic', ref: args.diagnosticId, field: `risks[${i}]`, quote: r.text.slice(0, 200) },
    })
  })
  const metrics = args.metrics
    .filter((m) => m.metric_value !== null && Number.isFinite(m.metric_value))
    .sort(byMetric)
    .slice(0, MAX_METRICS)
  metrics.forEach((m, i) => {
    const entry = getMetricById(m.metric_key)
    const unit = m.metric_unit ?? entry?.unit ?? ''
    items.push({
      id: `m.${i + 1}`,
      text: `Метрика «${entry?.label ?? m.metric_key}» = ${m.metric_value}${unit ? ` ${unit}` : ''}${m.period_year ? ` (${m.period_year})` : ''}; источник: ${SOURCE_RU[m.source ?? ''] ?? m.source ?? '—'}`,
      ref: { type: 'metric', ref: m.metric_key, field: m.source ?? undefined, value: m.metric_value },
    })
  })
  args.findings
    .filter((f) => f.provenance_type !== 'AI_HYPOTHESIS')
    .sort(byFinding)
    .slice(0, MAX_FINDINGS)
    .forEach((f, i) => {
      items.push({
        id: `f.${i + 1}`,
        text: `Вывод (${f.provenance_type}, ${f.severity}, ${f.area}): ${f.title}${f.body ? ` — ${f.body.slice(0, 300)}` : ''}`,
        ref: { type: 'finding', ref: f.id },
      })
    })
  return items
}

export function evidenceText(company: CompanyProfile | null, items: EvidenceItem[]): string {
  return [...profileLines(company), '', ...items.map((it) => `[${it.id}] ${it.text}`)].join('\n')
}

/** Hash of exactly what the model would see: same hash ⇒ same answer, no new call. */
export function promptInputHash(promptVersion: string, text: string): string {
  return createHash('sha256').update(promptVersion).update('\u0000').update(text).digest('hex').slice(0, 32)
}

// ─── Hypotheses ──────────────────────────────────────────────────────────────

export const HypothesesSchema = z.object({
  hypotheses: z.array(z.object({
    kind: z.enum(['risk', 'bottleneck', 'opportunity', 'gap']),
    area: z.string().max(40),
    title: z.string().min(5).max(200),
    body: z.string().max(1500).optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.string().max(20)).min(1).max(8),
  })).max(8),
})
export type HypothesesOutput = z.infer<typeof HypothesesSchema>

export function hypothesesPrompt(company: CompanyProfile | null, items: EvidenceItem[]): { system: string; user: string; text: string } {
  const text = evidenceText(company, items)
  const system = [
    'Ты — аналитик B2B-диагностики AIStart360. Твоя задача — выдвинуть ГИПОТЕЗЫ о причинах проблем и точках роста компании.',
    'Каждая гипотеза опирается только на пункты списка доказательств и ссылается на их id (например "b.finance", "m.3", "f.2").',
    'Не придумывай цифры и факты, которых нет в списке. Если данных мало — меньше гипотез, а не догадки.',
    'Не повторяй уже найденные выводы (пункты f.*) — ищи связи между ними, причины и следствия.',
    `Область (area) — один ключ из списка: ${CATEGORY_LIST}.`,
    'confidence — твоя уверенность 0..1 (не выше 0.7 при косвенных данных). severity critical — только если данные прямо указывают на угрозу бизнесу.',
    'Ответ — только JSON: {"hypotheses":[{"kind","area","title","body","severity","confidence","evidence":[id,...]}]}. Не более 8 гипотез. Язык — русский.',
    UNTRUSTED_DATA_RULES,
  ].join('\n')
  const user = `Список доказательств по компании:\n${fenceUntrusted('company_data', text)}\n\nСформулируй гипотезы.`
  return { system, user, text }
}

export interface ValidationReport<T> {
  accepted: T[]
  dropped: number
  reasons: string[]
}

function validRefs(ids: string[], byId: Map<string, EvidenceItem>): Evidence[] {
  const out: Evidence[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    const it = byId.get(id.trim())
    if (it && !seen.has(it.id)) {
      seen.add(it.id)
      out.push({ ...it.ref, evidence_id: it.id })
    }
  }
  return out
}

export function acceptHypotheses(out: HypothesesOutput, items: EvidenceItem[]): ValidationReport<FindingDraft> {
  const byId = new Map(items.map((i) => [i.id, i]))
  const report: ValidationReport<FindingDraft> = { accepted: [], dropped: 0, reasons: [] }
  const titles = new Set<string>()
  for (const h of out.hypotheses) {
    const evidence = validRefs(h.evidence, byId)
    if (!evidence.length) { report.dropped += 1; report.reasons.push('нет ссылок на доказательства'); continue }
    if (!isMetricCategoryKey(h.area)) { report.dropped += 1; report.reasons.push(`неизвестная область ${h.area}`); continue }
    const title = h.title.trim()
    if (titles.has(title.toLowerCase())) { report.dropped += 1; report.reasons.push('повтор'); continue }
    titles.add(title.toLowerCase())
    report.accepted.push({
      key: `ai:${title.toLowerCase().replace(/\s+/g, ' ').slice(0, 120)}`,
      kind: h.kind,
      area: h.area,
      title,
      body: h.body?.trim() || null,
      severity: h.severity,
      provenance: 'AI_HYPOTHESIS',
      confidence: h.confidence,
      evidence,
    })
  }
  return report
}

// ─── Recommendations ─────────────────────────────────────────────────────────

const AREA_BY_RU: Record<string, string> = {
  'Финансы': 'finance', 'Продажи': 'sales', 'Операции': 'operations', 'Маркетинг': 'marketing',
  'Стратегия': 'management', 'Клиенты': 'customers', 'Команда': 'team', 'Продукт': 'product',
}
const BLOCK_AREA: Record<string, string> = { finance: 'finance', sales: 'sales', operations: 'operations', marketing: 'marketing', strategy: 'management' }

/** «1 день», «2 недели», «3 месяца» → the nearest horizon bucket. */
export function horizonFromTimeline(timeline: string): 30 | 90 | 180 | 365 | null {
  const m = /(\d+)\s*(день|дн|недел|месяц|мес|год|лет)/i.exec(timeline)
  if (!m) return null
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  const days = unit === 'день' || unit === 'дн' ? n : unit === 'недел' ? n * 7 : unit === 'год' || unit === 'лет' ? n * 365 : n * 30
  return days <= 30 ? 30 : days <= 90 ? 90 : days <= 180 ? 180 : 365
}

/**
 * Recommendations that come straight from the rule engine (quick wins and
 * block recommendations). The client already sees these texts on the Point A
 * screens, so they are visible; provenance RECOMMENDATION.
 */
export function engineRecommendations(pointA: PointA): RecommendationDraft[] {
  const out: RecommendationDraft[] = []
  const seen = new Set<string>()
  for (const w of pointA.quick_wins) {
    const t = w.action.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push({
      key: `quick_win:${t}`,
      area: AREA_BY_RU[w.area] ?? 'management',
      title: t,
      body: w.timeline ? `Срок: ${w.timeline}` : null,
      effort: 'low',
      priority: 2,
      horizonDays: horizonFromTimeline(w.timeline) ?? 30,
      provenance: 'RECOMMENDATION',
      confidence: 0.8,
      visibleToClient: true,
    })
  }
  for (const [key, block] of Object.entries(pointA.blocks)) {
    for (const rec of (block?.recommendations ?? []).slice(0, 3)) {
      const t = rec.trim()
      if (!t || seen.has(t)) continue
      seen.add(t)
      out.push({
        key: `block:${key}:${t}`,
        area: BLOCK_AREA[key] ?? 'management',
        title: t.slice(0, 300),
        body: `Блок «${BLOCK_RU[key] ?? key}»: ${block.score}/100`,
        effort: null,
        priority: block.status === 'critical' ? 1 : block.status === 'weak' ? 2 : 3,
        horizonDays: 90,
        provenance: 'RECOMMENDATION',
        confidence: 0.8,
        visibleToClient: true,
      })
    }
  }
  return out
}

export const RecommendationsSchema = z.object({
  recommendations: z.array(z.object({
    area: z.string().max(40),
    title: z.string().min(5).max(200),
    body: z.string().max(1500).optional(),
    expected_impact: z.string().max(300).optional(),
    effort: z.enum(['low', 'medium', 'high']),
    priority: z.number().int().min(1).max(5),
    horizon_days: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]),
    confidence: z.number().min(0).max(1),
    findings: z.array(z.string().max(20)).min(1).max(8),
  })).max(8),
})
export type RecommendationsOutput = z.infer<typeof RecommendationsSchema>

export function findingEvidence(findings: ActiveFindingRow[]): EvidenceItem[] {
  return [...findings].sort(byFinding).slice(0, MAX_FINDINGS).map((f, i) => ({
    id: `f.${i + 1}`,
    text: `${f.provenance_type === 'AI_HYPOTHESIS' ? 'Гипотеза ИИ' : 'Вывод'} (${f.kind}, ${f.severity}, ${f.area}): ${f.title}${f.body ? ` — ${f.body.slice(0, 300)}` : ''}`,
    ref: { type: 'finding', ref: f.id },
  }))
}

export function recommendationsPrompt(company: CompanyProfile | null, items: EvidenceItem[], existing: string[]): { system: string; user: string; text: string } {
  const text = [evidenceText(company, items), '', 'Уже предложено (не повторять):', ...existing.slice(0, 20).map((t) => `- ${t}`)].join('\n')
  const system = [
    'Ты — консультант AIStart360. Предложи конкретные действия, которые закрывают найденные проблемы компании.',
    'Каждая рекомендация ссылается на id выводов (f.*), которые она закрывает. Не повторяй уже предложенные действия.',
    'Действие должно быть выполнимым: что сделать, кто отвечает, как проверить результат. Никаких общих советов.',
    `Область (area) — ключ из списка: ${CATEGORY_LIST}. Горизонт horizon_days: 30, 90, 180 или 365. priority 1 — самое срочное.`,
    'Ответ — только JSON: {"recommendations":[{"area","title","body","expected_impact","effort","priority","horizon_days","confidence","findings":[id,...]}]}. Не более 8. Язык — русский.',
    UNTRUSTED_DATA_RULES,
  ].join('\n')
  const user = `Выводы диагностики:\n${fenceUntrusted('company_data', text)}\n\nПредложи рекомендации.`
  return { system, user, text }
}

export function acceptRecommendations(out: RecommendationsOutput, items: EvidenceItem[]): ValidationReport<RecommendationDraft> {
  const byId = new Map(items.map((i) => [i.id, i]))
  const report: ValidationReport<RecommendationDraft> = { accepted: [], dropped: 0, reasons: [] }
  const titles = new Set<string>()
  for (const r of out.recommendations) {
    const refs = validRefs(r.findings, byId)
    if (!refs.length) { report.dropped += 1; report.reasons.push('нет ссылок на выводы'); continue }
    if (!isMetricCategoryKey(r.area)) { report.dropped += 1; report.reasons.push(`неизвестная область ${r.area}`); continue }
    const title = r.title.trim()
    if (titles.has(title.toLowerCase())) { report.dropped += 1; report.reasons.push('повтор'); continue }
    titles.add(title.toLowerCase())
    report.accepted.push({
      key: `ai:${title.toLowerCase().slice(0, 120)}`,
      area: r.area,
      title,
      body: r.body?.trim() || null,
      expectedImpact: r.expected_impact?.trim() || null,
      effort: r.effort,
      priority: r.priority as RecommendationDraft['priority'],
      horizonDays: r.horizon_days,
      provenance: 'RECOMMENDATION',
      confidence: r.confidence,
      findingIds: refs.map((e) => e.ref),
      visibleToClient: false,
    })
  }
  return report
}
