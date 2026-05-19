// ============================================================
// lib/metrics/registry.ts
// Flat catalog of all 122 metrics built from the declaration
// objects in `descriptions.ts`. Provides stable namespaced IDs
// (e.g. "biz.finance.vyruchka_god", "kpi.roe", "gri.product",
// "goal.01.win_rate") plus lookup helpers used by the resolver,
// the materialize layer, and the UI drill-down components.
// ============================================================

import {
  BIZ_METRIC_DESCRIPTIONS,
  GRI_BLOCK_DESCRIPTIONS,
  KPI_DESCRIPTIONS,
  METRIC_GOAL_DESCRIPTIONS,
} from './descriptions'
import type { MetricEntry, MetricNamespace } from './types'

// ─── Slug helper ─────────────────────────────────────────────

const CYR_MAP: Record<string, string> = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',
  к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',
  ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
}

export function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .split('')
    .map((ch) => CYR_MAP[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'unnamed'
}

// ─── Unit inference ──────────────────────────────────────────

function inferUnit(label: string, formula?: string): string {
  const probe = `${label} ${formula ?? ''}`.toLowerCase()
  if (/%|маржа|loss\s*rate|win\s*rate|conversion|churn|nps|csat|share|доля|процент|retention|rate\b/.test(probe)) return '%'
  if (/дн(ей|я)|days|cycle|срок|период оборот/.test(probe)) return 'days'
  if (/₸|kzt|выручк|прибыль|cac|ltv|чек|стоимость|cost|budget|доход|расход|cash|кредит/.test(probe)) return '₸'
  if (/команд|сотруд|штат|employ|staff|клиент|deal|lead|количество|шт\b|count/.test(probe)) return 'count'
  return ''
}

// ─── Build registry (memoised) ───────────────────────────────

let cache: MetricEntry[] | null = null

export function getMetricRegistry(): MetricEntry[] {
  if (cache) return cache
  const entries: MetricEntry[] = []

  // BIZ — 48 metrics across 7 departments
  for (const [dept, metrics] of Object.entries(BIZ_METRIC_DESCRIPTIONS)) {
    for (const [label, desc] of Object.entries(metrics)) {
      entries.push({
        id: `biz.${slugifyLabel(dept)}.${slugifyLabel(label)}`,
        namespace: 'biz',
        department: dept,
        label,
        unit: inferUnit(label),
        sources: desc.sources,
      })
    }
  }

  // KPI — 12 metrics
  for (const [label, desc] of Object.entries(KPI_DESCRIPTIONS)) {
    entries.push({
      id: `kpi.${slugifyLabel(label)}`,
      namespace: 'kpi',
      label,
      unit: inferUnit(label),
      sources: desc.sources,
    })
  }

  // GRI — 7 block descriptions
  for (const [label, desc] of Object.entries(GRI_BLOCK_DESCRIPTIONS)) {
    entries.push({
      id: `gri.${slugifyLabel(label)}`,
      namespace: 'gri',
      label,
      unit: '',
      sources: desc.sources,
    })
  }

  // Growth goals — 55 metrics across 11 goals
  for (const goal of METRIC_GOAL_DESCRIPTIONS) {
    for (const item of goal.items) {
      entries.push({
        id: `goal.${goal.number}.${slugifyLabel(item.label)}`,
        namespace: 'goal',
        goalNumber: goal.number,
        label: item.label,
        unit: inferUnit(item.label, item.formula),
        formula: item.formula,
        sources: item.sources,
      })
    }
  }

  cache = entries
  return entries
}

// ─── Lookups ─────────────────────────────────────────────────

let byId: Map<string, MetricEntry> | null = null

export function getMetricById(id: string): MetricEntry | undefined {
  if (!byId) {
    byId = new Map()
    for (const e of getMetricRegistry()) byId.set(e.id, e)
  }
  return byId.get(id)
}

export function getMetricsByNamespace(ns: MetricNamespace): MetricEntry[] {
  return getMetricRegistry().filter((e) => e.namespace === ns)
}

export function getMetricsByDepartment(dept: string): MetricEntry[] {
  return getMetricRegistry().filter((e) => e.department === dept)
}

export function getAllDepartments(): string[] {
  const set = new Set<string>()
  for (const e of getMetricRegistry()) if (e.department) set.add(e.department)
  return Array.from(set)
}

/**
 * Test-only escape hatch — lets unit tests rebuild the registry
 * if descriptions.ts is mutated during a run.
 */
export function __resetRegistryCache(): void {
  cache = null
  byId = null
}
