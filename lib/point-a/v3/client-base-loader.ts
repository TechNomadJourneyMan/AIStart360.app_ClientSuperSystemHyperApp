// ============================================================
// lib/point-a/v3/client-base-loader.ts
//
// Shared input loader for the three Point-A v3 analytical
// engines (RFM, retention curve, loss map).  Reads parsed
// `documents.parsed_data` rows and returns a normalised array
// of `ClientBaseRow` records — one per client.
//
// "Client base" detection rules, in order of precedence:
//   1. `parsed_data.classification === 'client_base'`
//      (forward-compatible — current schema does NOT yet have
//      that field but bind-fields.ts is the natural place to
//      add it; honouring it here means no follow-up patch).
//   2. `doc_type === 'crm_export'`
//   3. `parsed_data.client_rows` is a non-empty array.
//
// Rows can live in any of these shapes inside parsed_data:
//   - parsed_data.client_rows: ClientBaseRow[]
//   - parsed_data.rows:        ClientBaseRow[]
//   - parsed_data.clients:     ClientBaseRow[]
//
// The loader is tolerant: it accepts snake_case AND camelCase
// keys and coerces common date / number variants. Any row
// that cannot be parsed into { first_purchase_date,
// total_spent_kzt, purchase_count } is silently dropped.
//
// Pure function w/ no DB calls — accepts already-fetched
// documents (typically from `gatherResolverContext` or a
// direct Supabase query in the route handler).
// ============================================================

import type { ResolverDocument } from '@/lib/metrics/types'

export interface ClientBaseRow {
  client_id: string
  first_purchase_date: string // ISO 8601 — guaranteed
  last_purchase_date: string  // ISO 8601 — guaranteed
  total_spent_kzt: number
  purchase_count: number
  segment_hint?: string | null
  manager?: string | null
  product?: string | null
}

// ─── Helpers ────────────────────────────────────────────────

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim().length > 0) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return null
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') {
      // Strip non-numeric chars but keep "." and "-".
      const cleaned = v.replace(/[^\d.,-]/g, '').replace(/,/g, '.')
      const n = Number(cleaned)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function pickDate(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const raw = obj[k]
    if (raw == null) continue
    if (typeof raw === 'string' || typeof raw === 'number') {
      const d = new Date(raw)
      if (!Number.isNaN(d.getTime())) return d.toISOString()
    }
  }
  return null
}

function isClientBaseDocument(doc: ResolverDocument): boolean {
  const parsed = doc.parsedData as Record<string, unknown> | null
  if (!parsed) return false

  const classification = typeof parsed.classification === 'string'
    ? (parsed.classification as string).toLowerCase()
    : null
  if (classification === 'client_base') return true

  if (doc.docType === 'crm_export') return true
  if (doc.docType === 'client_base') return true // future-proof

  if (Array.isArray(parsed.client_rows) && parsed.client_rows.length > 0) return true
  if (Array.isArray(parsed.clients) && parsed.clients.length > 0) return true

  return false
}

function extractRawRows(doc: ResolverDocument): unknown[] {
  const parsed = doc.parsedData as Record<string, unknown> | null
  if (!parsed) return []
  const candidates = [parsed.client_rows, parsed.rows, parsed.clients]
  for (const c of candidates) {
    if (Array.isArray(c)) return c
  }
  return []
}

function normalizeRow(raw: unknown, idx: number, docId: string): ClientBaseRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const first = pickDate(r, [
    'first_purchase_date',
    'firstPurchaseDate',
    'first_purchase',
    'first_date',
    'created_at',
    'firstVisit',
  ])
  const last = pickDate(r, [
    'last_purchase_date',
    'lastPurchaseDate',
    'last_purchase',
    'last_date',
    'last_visit',
    'lastVisit',
  ]) ?? first // a single-purchase client has last = first

  const total = pickNumber(r, [
    'total_spent_kzt',
    'total_spent',
    'totalSpent',
    'revenue',
    'sum',
    'amount',
    'total',
  ])
  const count = pickNumber(r, [
    'purchase_count',
    'purchaseCount',
    'visits',
    'orders',
    'frequency',
    'count',
  ])

  if (!first || !last || total == null || count == null) return null
  if (count < 1) return null

  return {
    client_id: pickString(r, ['client_id', 'clientId', 'id', 'phone', 'email'])
      ?? `${docId}:${idx}`,
    first_purchase_date: first,
    last_purchase_date: last,
    total_spent_kzt: Math.max(0, total),
    purchase_count: Math.max(1, Math.round(count)),
    segment_hint: pickString(r, ['segment_hint', 'segment', 'tier']) ?? null,
    manager: pickString(r, ['manager', 'owner', 'responsible']) ?? null,
    product: pickString(r, ['product', 'service', 'category']) ?? null,
  }
}

// ─── Public API ─────────────────────────────────────────────

export interface ClientBaseExtractResult {
  rows: ClientBaseRow[]
  has_client_base: boolean
  source_document_ids: string[]
}

/**
 * Pull the most-recent client-base document(s) from a list of
 * parsed documents and normalize their rows.  Multiple uploads
 * of the same base de-dup by client_id (last write wins, since
 * the input is sorted newest-first by the caller).
 */
export function extractClientBaseRows(
  documents: ResolverDocument[],
): ClientBaseExtractResult {
  const sourceIds: string[] = []
  const byClient = new Map<string, ClientBaseRow>()

  for (const doc of documents) {
    if (!isClientBaseDocument(doc)) continue
    const raws = extractRawRows(doc)
    if (raws.length === 0) continue
    sourceIds.push(doc.id)
    raws.forEach((raw, idx) => {
      const norm = normalizeRow(raw, idx, doc.id)
      if (!norm) return
      if (!byClient.has(norm.client_id)) {
        byClient.set(norm.client_id, norm)
      }
    })
  }

  const rows = Array.from(byClient.values())
  return {
    rows,
    has_client_base: rows.length > 0,
    source_document_ids: sourceIds,
  }
}

// ─── Time helpers (shared across engines) ───────────────────

export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime()
  return Math.floor(ms / 86_400_000)
}

export function daysSince(iso: string, now: Date): number {
  return daysBetween(new Date(iso), now)
}
