// Single source of truth for the /clients zone: row shape, status vocabulary,
// the Point A scale and the filter/sort logic.
//
// Why it exists: ClientFilters used to invent its own vocabulary (English
// industries, statuses that do not exist in the DB, a 0–1000 GRI scale) while
// ClientsTable rendered the real one (0–10, `pending_approval`/`approved`/…).
// Two vocabularies in two files can never agree — so both now import this one.

import type { StatusType } from '@/components/common/StatusBadge'
import type { AdminClientRow } from '@/app/api/v1/admin/clients/route'

// ─── Row ────────────────────────────────────────────────────────────────────

export interface ClientBlockScore {
  key: string
  label: string
  /** 0–100 from the Point A engine; null when the block has no answers. */
  value: number | null
}

export interface ClientRow {
  id: string
  name: string
  email: string
  industry: string | null
  stage: string | null
  status: string
  createdAt: string
  /** 0–10 for display; null when the client has no current diagnostic. */
  pointA: number | null
  /** Raw 0–100 score the display value is derived from. */
  pointARaw: number | null
  healthIndex: number | null
  calculatedAt: string | null
  blocks: ClientBlockScore[]
}

/** The Point A engine stores 0–100; the whole zone displays 0–10. */
export function toPointA(score: number | null): number | null {
  if (score === null || Number.isNaN(score)) return null
  return Math.round(score) / 10
}

export function mapAdminClient(c: AdminClientRow): ClientRow {
  return {
    id: c.id,
    name: c.company_name ?? c.full_name ?? c.email,
    email: c.email,
    industry: c.industry,
    stage: c.stage,
    status: c.status,
    createdAt: c.created_at,
    pointA: toPointA(c.overall_score),
    pointARaw: c.overall_score,
    healthIndex: c.health_index,
    calculatedAt: c.calculated_at,
    blocks: [
      { key: 'finance',    label: 'Финансы',    value: c.finance_score },
      { key: 'sales',      label: 'Продажи',    value: c.sales_score },
      { key: 'operations', label: 'Операции',   value: c.operations_score },
      { key: 'marketing',  label: 'Маркетинг',  value: c.marketing_score },
      { key: 'strategy',   label: 'Стратегия',  value: c.strategy_score },
    ],
  }
}

// ─── Statuses ───────────────────────────────────────────────────────────────

export const CLIENT_STATUS_LABELS: Record<string, string> = {
  pending_approval: 'Ожидает',
  approved: 'Активный',
  requires_clarification: 'Уточнение',
  rejected: 'Отклонён',
}

export function clientStatusLabel(status: string): string {
  return CLIENT_STATUS_LABELS[status] ?? status
}

// StatusBadge only knows its own palette keys — passing `approved` through
// painted every badge neutral grey, so the colour signal never worked.
const STATUS_BADGE: Record<string, StatusType> = {
  approved: 'active',
  pending_approval: 'warning',
  requires_clarification: 'info',
  rejected: 'critical',
}

export function clientStatusBadge(status: string): StatusType {
  return STATUS_BADGE[status] ?? 'neutral'
}

// ─── Filters ────────────────────────────────────────────────────────────────

export type ClientScoreBand = 'all' | 'high' | 'mid' | 'low' | 'scored' | 'none'
export type ClientSortKey = 'name' | 'industry' | 'score' | 'status' | 'created'
export type ClientSortDir = 'asc' | 'desc'

export interface ClientSort {
  key: ClientSortKey
  dir: ClientSortDir
}

export interface ClientFiltersValue {
  search: string
  /** '' = any */
  industry: string
  /** '' = any */
  status: string
  band: ClientScoreBand
  sort: ClientSort
}

export const DEFAULT_CLIENT_FILTERS: ClientFiltersValue = {
  search: '',
  industry: '',
  status: '',
  band: 'all',
  sort: { key: 'created', dir: 'desc' },
}

export function isClientFilterActive(v: ClientFiltersValue): boolean {
  return v.search.trim() !== '' || v.industry !== '' || v.status !== '' || v.band !== 'all'
}

// Bands mirror the ScoreBar colour thresholds in ClientsTable — the filter and
// the bar can never drift apart again.
export const SCORE_BAND_OPTIONS: ReadonlyArray<{ value: ClientScoreBand; label: string }> = [
  { value: 'all',    label: 'Point A: любой' },
  { value: 'high',   label: 'Point A: 7.0 и выше' },
  { value: 'mid',    label: 'Point A: 5.0 – 6.9' },
  { value: 'low',    label: 'Point A: ниже 5.0' },
  { value: 'scored', label: 'Есть диагностика' },
  { value: 'none',   label: 'Нет диагностики' },
]

export function matchesBand(pointA: number | null, band: ClientScoreBand): boolean {
  switch (band) {
    case 'none':   return pointA === null
    case 'scored': return pointA !== null
    case 'high':   return pointA !== null && pointA >= 7
    case 'mid':    return pointA !== null && pointA >= 5 && pointA < 7
    case 'low':    return pointA !== null && pointA < 5
    default:       return true
  }
}

export function filterClients(rows: ClientRow[], v: ClientFiltersValue): ClientRow[] {
  const q = v.search.trim().toLowerCase()
  return rows.filter((r) => {
    if (q && !`${r.name} ${r.email} ${r.industry ?? ''}`.toLowerCase().includes(q)) return false
    if (v.industry && (r.industry ?? '') !== v.industry) return false
    if (v.status && r.status !== v.status) return false
    return matchesBand(r.pointA, v.band)
  })
}

const collator = new Intl.Collator('ru')

export function sortClients(rows: ClientRow[], sort: ClientSort): ClientRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case 'score': {
        // Clients without a diagnostic always sink to the bottom — they are
        // "unknown", not "worst".
        if (a.pointA === null && b.pointA === null) return collator.compare(a.name, b.name)
        if (a.pointA === null) return 1
        if (b.pointA === null) return -1
        return sign * (a.pointA - b.pointA)
      }
      case 'industry':
        return sign * collator.compare(a.industry ?? 'я'.repeat(3), b.industry ?? 'я'.repeat(3))
      case 'status':
        return sign * collator.compare(clientStatusLabel(a.status), clientStatusLabel(b.status))
      case 'created':
        return sign * (Date.parse(a.createdAt) - Date.parse(b.createdAt))
      default:
        return sign * collator.compare(a.name, b.name)
    }
  })
}

/** Industry values actually present in the loaded rows — never a hardcoded list. */
export function industriesOf(rows: ClientRow[]): string[] {
  return Array.from(new Set(rows.map((r) => r.industry).filter((i): i is string => !!i))).sort(
    (a, b) => collator.compare(a, b),
  )
}

/** Statuses actually present in the loaded rows. */
export function statusesOf(rows: ClientRow[]): string[] {
  return Array.from(new Set(rows.map((r) => r.status))).sort((a, b) =>
    collator.compare(clientStatusLabel(a), clientStatusLabel(b)),
  )
}

export function fmtDateRu(iso: string | null): string {
  if (!iso) return '—'
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return '—'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(ts))
}
