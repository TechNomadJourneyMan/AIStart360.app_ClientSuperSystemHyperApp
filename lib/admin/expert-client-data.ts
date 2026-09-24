import type { PointA, BlockScore } from '@/types/onboarding'
import type { PointBOptions } from '@/lib/point-b/engine'

/**
 * Преобразования данных клиента для экспертных вкладок User 360.
 *
 * Только честные данные: берём канонические таблицы (`diagnostics`,
 * `gri_assessments`, `gri_pulse_responses`) и ничего не досчитываем «для
 * красоты». Нет данных — пустое значение, интерфейс показывает пустое состояние.
 */

export const POINT_A_BLOCKS = [
  { id: 'finance', label: 'Финансы', column: 'finance_score' },
  { id: 'sales', label: 'Продажи', column: 'sales_score' },
  { id: 'operations', label: 'Операции', column: 'operations_score' },
  { id: 'marketing', label: 'Маркетинг', column: 'marketing_score' },
  { id: 'strategy', label: 'Стратегия', column: 'strategy_score' },
] as const

export type PointABlockId = (typeof POINT_A_BLOCKS)[number]['id']

export interface PointABlockView {
  id: PointABlockId
  label: string
  score: number | null
  status: string | null
  topIssues: string[]
  recommendations: string[]
}

function strings(v: unknown, max = 5): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => {
      if (typeof x === 'string') return x
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>
        return String(o.title ?? o.text ?? '')
      }
      return ''
    })
    .filter(Boolean)
    .slice(0, max)
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Блок Точки А из JSONB-колонки diagnostics.<block>_score (+ разбор ИИ, если есть). */
export function pointABlock(diag: Record<string, unknown>, id: PointABlockId, label: string, column: string): PointABlockView {
  const raw = diag[column]
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  const ai = (diag.ai_analysis as { blocks?: Record<string, Record<string, unknown>> } | null)?.blocks?.[id] ?? null
  const issues = strings(obj?.top_issues)
  const recs = strings(obj?.recommendations)
  return {
    id,
    label,
    score: obj ? num(obj.score) : num(raw),
    status: typeof obj?.status === 'string' ? obj.status : typeof ai?.status === 'string' ? (ai.status as string) : null,
    topIssues: issues.length ? issues : strings(ai?.top_issues),
    recommendations: recs.length ? recs : strings(ai?.recommendations),
  }
}

export interface ListItem { title: string; text: string | null; tag: string | null }

/** Риски / инсайты / быстрые победы: у разных версий движка разные поля. */
export function listItems(v: unknown, max = 8): ListItem[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x): ListItem | null => {
      if (typeof x === 'string') return { title: x, text: null, tag: null }
      if (!x || typeof x !== 'object') return null
      const o = x as Record<string, unknown>
      const title = String(o.title ?? o.text ?? o.action ?? o.label ?? '').trim()
      if (!title) return null
      const text = typeof o.description === 'string' ? o.description : null
      const tag = typeof o.level === 'string' ? o.level : typeof o.area === 'string' ? o.area : typeof o.timeline === 'string' ? o.timeline : null
      return { title, text: text && text !== title ? text : null, tag }
    })
    .filter((x): x is ListItem => x !== null)
    .slice(0, max)
}

const EMPTY_BLOCK: BlockScore = { score: 0, status: 'critical', top_issues: [], recommendations: [] }

/** Строка diagnostics → PointA для движка Точки Б. */
export function diagToPointA(diag: Record<string, unknown>): PointA {
  const block = (k: string): BlockScore => {
    const v = diag[k] as BlockScore | null
    return v && typeof v === 'object' ? v : EMPTY_BLOCK
  }
  return {
    overall_score: (diag.overall_score as number) ?? 0,
    health_index: (diag.health_index as number) ?? 0,
    stage: (diag.stage as PointA['stage']) ?? 'seed',
    blocks: {
      finance: block('finance_score'),
      marketing: block('marketing_score'),
      operations: block('operations_score'),
      strategy: block('strategy_score'),
      sales: block('sales_score'),
    },
    risks: (diag.risks as PointA['risks']) ?? [],
    insights: (diag.insights as PointA['insights']) ?? [],
    quick_wins: (diag.quick_wins as PointA['quick_wins']) ?? [],
    data_gaps: (diag.data_gaps as PointA['data_gaps']) ?? [],
  }
}

/** gri_assessments.top_5_limits → формат движка Точки Б. */
export function mapGriTop5(raw: unknown): PointBOptions['griTop5'] {
  if (!Array.isArray(raw)) return undefined
  return raw
    .map((item, i) => {
      if (!item || typeof item !== 'object') return null
      const o = item as Record<string, unknown>
      const title = String(o.title ?? o.label ?? o.name ?? o.criterion ?? '').trim()
      if (!title) return null
      return {
        rank: typeof o.rank === 'number' ? o.rank : i + 1,
        title,
        block: String(o.block ?? o.section ?? o.sectionId ?? ''),
        severity: String(o.severity ?? o.level ?? 'high'),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

/** Явные метрики Pulse из разбора ИИ — только то, что реально записано. */
export const PULSE_METRIC_KEYS = ['avgCheck', 'volumeChange', 'riskScore', 'churnProb', 'daysSince', 'lastOrderAt', 'orderCycle', 'action'] as const
export type PulseMetricKey = (typeof PULSE_METRIC_KEYS)[number]

export function explicitPulseMetrics(aiAnalysis: unknown): Partial<Record<PulseMetricKey, number | string>> | null {
  const pulse = (aiAnalysis as { pulse?: Record<string, unknown> } | null)?.pulse
  if (!pulse || typeof pulse !== 'object') return null
  const out: Partial<Record<PulseMetricKey, number | string>> = {}
  for (const k of PULSE_METRIC_KEYS) {
    const v = pulse[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return Object.keys(out).length ? out : null
}
