/**
 * Shared helpers for extractors.
 *
 * Nothing in here talks to the DB or the async backbone. Everything is pure.
 */

import type { ExtractedEntity, ExtractionSource, FiscalQuarter } from './types'

/**
 * Build an ExtractedEntity with sane defaults. Every extractor uses this
 * instead of assembling the object inline — keeps `extractor_name`,
 * `extractor_version`, and `source_type` propagation consistent.
 */
export function makeEntity(params: {
  entity_type: string
  value: unknown
  confidence: number
  source_type: ExtractionSource
  extractor_name: string
  extractor_version: string
  unit?: string
  period_year?: number
  period_quarter?: FiscalQuarter
  source_doc_id?: string
  source_field?: string
  raw_excerpt?: string
}): ExtractedEntity {
  const clamped = Math.max(0, Math.min(1, params.confidence))
  return {
    entity_type: params.entity_type,
    value: params.value,
    confidence: Number(clamped.toFixed(3)),
    source_type: params.source_type,
    extractor_name: params.extractor_name,
    extractor_version: params.extractor_version,
    unit: params.unit,
    period_year: params.period_year,
    period_quarter: params.period_quarter,
    source_doc_id: params.source_doc_id,
    source_field: params.source_field,
    raw_excerpt: params.raw_excerpt,
  }
}

/** Truncate a text fragment to 200 chars for `raw_excerpt`. */
export function excerpt(text: string, maxLen = 200): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) + '…' : trimmed
}

/** Parse a period string like "2024 Q3", "Q2 2025", "Q1" → {year, quarter}. */
export function parsePeriod(s: string): { year?: number; quarter?: FiscalQuarter } {
  const str = s.trim()
  const yearMatch = str.match(/\b(20\d{2})\b/)
  const quarterMatch = str.match(/\bQ([1-4])\b/i)
  return {
    year: yearMatch ? Number(yearMatch[1]) : undefined,
    quarter: quarterMatch ? (`Q${quarterMatch[1]}` as FiscalQuarter) : undefined,
  }
}

/**
 * Coerce a string like "10 500 000", "10,500,000", "10.5 млн", "2.4M" to number.
 * Returns NaN on unparseable input — caller should check.
 */
export function coerceNumber(input: unknown): number {
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN
  if (typeof input !== 'string') return NaN

  let s = input.trim().toLowerCase()
  if (!s) return NaN

  // Russian/Kazakh suffixes
  let multiplier = 1
  if (/\b(млрд|миллиард|b|bln)\b/.test(s)) multiplier = 1_000_000_000
  else if (/\b(млн|миллион|m|mln)\b/.test(s)) multiplier = 1_000_000
  else if (/\b(тыс|к|k|thousand)\b/.test(s)) multiplier = 1_000

  // Strip everything but digits, comma, dot, minus
  s = s.replace(/[^\d.,-]/g, '')
  // Heuristic: if string has both dot and comma — comma is thousand-sep
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/,/g, '')
  } else if (s.includes(',')) {
    // Comma could be decimal (EU) or thousand (US) — assume decimal if 1-2 digits after
    const parts = s.split(',')
    if (parts.length === 2 && parts[1].length <= 2) {
      s = parts[0] + '.' + parts[1]
    } else {
      s = s.replace(/,/g, '')
    }
  }

  const n = parseFloat(s)
  if (!Number.isFinite(n)) return NaN
  return n * multiplier
}

/** Fuzzy-match a column name against a set of known synonyms. Returns score 0..1. */
export function matchColumn(actual: string, candidates: string[]): number {
  const a = actual.toLowerCase().replace(/[_\s-]+/g, '')
  let best = 0
  for (const cand of candidates) {
    const c = cand.toLowerCase().replace(/[_\s-]+/g, '')
    if (a === c) return 1
    if (a.includes(c) || c.includes(a)) {
      best = Math.max(best, Math.min(a.length, c.length) / Math.max(a.length, c.length))
    }
  }
  return best
}

/**
 * Source-priority weight used by consensus.
 * See lib/ai/consensus.ts for the resolution algorithm.
 */
export const SOURCE_PRIORITY: Record<ExtractionSource, number> = {
  document: 0.9,
  survey: 0.7,
  calculated: 0.5,
  // 'manual' isn't exported through extractors — user edits write directly to metrics
} as const

/** Default confidence bands for each source type — extractors can override. */
export const DEFAULT_CONFIDENCE: Record<ExtractionSource, number> = {
  document: 0.85,
  survey: 0.7,
  calculated: 0.6,
} as const
