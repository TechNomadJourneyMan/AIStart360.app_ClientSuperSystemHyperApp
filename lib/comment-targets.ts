// ─────────────────────────────────────────────────────────────────────────────
// Central registry of every element an expert can attach a comment to.
// ─────────────────────────────────────────────────────────────────────────────
// Comments are stored in `expert_comments.block_key TEXT` with no CHECK
// constraint — we treat that column as a generic "target id" free-text.
// Existing 5 Point A block ids (finance/sales/operations/marketing/strategy)
// are preserved here so old rows keep rendering without migration.

import { CATEGORIES, SUB_FACTORS } from '@/lib/gri-calculator/gri-data'

export type TargetGroup =
  | 'general'    // null block_key — общая лента без привязки
  | 'point-a'
  | 'dashboard'
  | 'gri'
  | 'pulse'
  | 'survey'

export interface CommentTarget {
  id: string
  label: string
  group: TargetGroup
  /** Optional sub-group inside a group (e.g. GRI category grouping sub-factors) */
  section?: string
}

// ── Point A blocks (backwards-compatible ids) ────────────────────────────────
const POINT_A_TARGETS: CommentTarget[] = [
  { id: 'finance',    label: 'Финансы',   group: 'point-a' },
  { id: 'sales',      label: 'Продажи',   group: 'point-a' },
  { id: 'operations', label: 'Операции',  group: 'point-a' },
  { id: 'marketing',  label: 'Маркетинг', group: 'point-a' },
  { id: 'strategy',   label: 'Стратегия', group: 'point-a' },
]

// ── Client Dashboard items ───────────────────────────────────────────────────
const DASHBOARD_TARGETS: CommentTarget[] = [
  { id: 'dashboard:kpi:overallScore', label: 'KPI: Overall Score',   group: 'dashboard', section: 'KPI' },
  { id: 'dashboard:kpi:healthIndex',  label: 'KPI: Health Index',    group: 'dashboard', section: 'KPI' },
  { id: 'dashboard:kpi:stage',        label: 'KPI: Стадия',          group: 'dashboard', section: 'KPI' },
  { id: 'dashboard:kpi:directions',   label: 'KPI: Направления',     group: 'dashboard', section: 'KPI' },
  { id: 'dashboard:ai-summary',       label: 'AI Executive Summary', group: 'dashboard', section: 'AI' },
  { id: 'dashboard:priorities',       label: 'Стратегические приоритеты', group: 'dashboard', section: 'AI' },
  { id: 'dashboard:risks',            label: 'Риски',                group: 'dashboard', section: 'Analysis' },
  { id: 'dashboard:insights',         label: 'Insights',             group: 'dashboard', section: 'Analysis' },
  { id: 'dashboard:quickwins',        label: 'Quick Wins',           group: 'dashboard', section: 'Analysis' },
  { id: 'dashboard:roadmap:30_days',  label: 'Roadmap: 30 дней',     group: 'dashboard', section: 'Roadmap' },
  { id: 'dashboard:roadmap:90_days',  label: 'Roadmap: 90 дней',     group: 'dashboard', section: 'Roadmap' },
  { id: 'dashboard:roadmap:180_days', label: 'Roadmap: 180 дней',    group: 'dashboard', section: 'Roadmap' },
  { id: 'dashboard:industry',         label: 'Industry Context',     group: 'dashboard', section: 'Industry' },
]

// ── GRI categories + sub-factors (generated from gri-data.ts) ────────────────
function slugifyCategory(cat: string): string {
  return cat
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

const GRI_TARGETS: CommentTarget[] = [
  ...CATEGORIES.map<CommentTarget>((cat) => ({
    id: `gri:category:${slugifyCategory(cat)}`,
    label: cat,
    group: 'gri',
    section: 'Категории',
  })),
  ...CATEGORIES.flatMap<CommentTarget>((cat) =>
    (SUB_FACTORS[cat] ?? []).map((sf) => ({
      id: `gri:sub:${sf.id}`,
      label: sf.ru,
      group: 'gri',
      section: cat,
    })),
  ),
]

// ── Pulse metrics (per-client) ───────────────────────────────────────────────
const PULSE_TARGETS: CommentTarget[] = [
  { id: 'pulse:avgCheck',     label: 'Средний чек',        group: 'pulse' },
  { id: 'pulse:volumeChange', label: 'Изменение объёма',   group: 'pulse' },
  { id: 'pulse:riskScore',    label: 'Risk Score',         group: 'pulse' },
  { id: 'pulse:churnProb',    label: 'Churn Probability',  group: 'pulse' },
  { id: 'pulse:daysSince',    label: 'Дней с последнего заказа', group: 'pulse' },
  { id: 'pulse:action',       label: 'Рекомендованное действие', group: 'pulse' },
]

// ── Canonical flat registry ──────────────────────────────────────────────────
export const TARGETS: CommentTarget[] = [
  ...POINT_A_TARGETS,
  ...DASHBOARD_TARGETS,
  ...GRI_TARGETS,
  ...PULSE_TARGETS,
]

const TARGETS_BY_ID = new Map(TARGETS.map((t) => [t.id, t]))

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Look up a target's metadata; returns null for unknown ids (e.g. stale comments) */
export function getTarget(id: string | null | undefined): CommentTarget | null {
  if (!id) return null
  return TARGETS_BY_ID.get(id) ?? null
}

/** Human label for any target id (falls back to raw id) */
export function targetLabel(id: string | null | undefined): string {
  if (!id) return 'Общее'
  return getTarget(id)?.label ?? id
}

/** All targets belonging to a given group, preserving registry order */
export function targetsByGroup(group: TargetGroup): CommentTarget[] {
  return TARGETS.filter((t) => t.group === group)
}

/** All targets within a group, bucketed by `section` */
export function targetsBySection(group: TargetGroup): Record<string, CommentTarget[]> {
  const buckets: Record<string, CommentTarget[]> = {}
  for (const t of targetsByGroup(group)) {
    const key = t.section ?? ''
    if (!buckets[key]) buckets[key] = []
    buckets[key].push(t)
  }
  return buckets
}

/** Validation: is this id a known target OR a short free-form string (≤200)? */
export function isValidTargetId(id: unknown): id is string {
  if (typeof id !== 'string') return false
  if (id.length < 1 || id.length > 200) return false
  return true
}

/** Max length for a raw target id string (for POST validation) */
export const MAX_TARGET_ID_LENGTH = 200

// ── Display metadata per group (colors, order, labels) ───────────────────────

export const GROUP_LABEL: Record<TargetGroup, string> = {
  general:   'Общее',
  'point-a': 'Точка А',
  dashboard: 'Дэшборд',
  gri:       'GRI',
  pulse:     'Pulse',
  survey:    'Анкета',
}

export const GROUP_ICON: Record<TargetGroup, string> = {
  general:   'chat',
  'point-a': 'radar',
  dashboard: 'dashboard',
  gri:       'target',
  pulse:     'monitor_heart',
  survey:    'assignment',
}

export const GROUP_CHIP: Record<TargetGroup, string> = {
  general:   'bg-white/[0.05] text-on-surface-variant border-white/[0.08]',
  'point-a': 'bg-primary/10 text-primary border-primary/20',
  dashboard: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  gri:       'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  pulse:     'bg-amber-500/10 text-amber-300 border-amber-500/20',
  survey:    'bg-violet-500/10 text-violet-300 border-violet-500/20',
}

/** Order groups appear in the client-side ExpertCommentsSection */
export const GROUP_ORDER: TargetGroup[] = [
  'general',
  'point-a',
  'dashboard',
  'gri',
  'pulse',
  'survey',
]

/** Resolve the group for any target id (unknown id → 'general') */
export function groupOf(id: string | null | undefined): TargetGroup {
  const t = getTarget(id)
  return t ? t.group : 'general'
}
