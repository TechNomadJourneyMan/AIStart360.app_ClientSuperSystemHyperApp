import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoreImportKind } from './types'

export interface StoreImportHistoryEntry {
  id: string
  kind: StoreImportKind
  scopeKey: string
  sourceSha256: string
  status: 'published' | 'superseded'
  periodStart: string | null
  periodEnd: string | null
  rowCount: number
  warningCount: number
  errorCount: number
  quarantinedCount: number
  publishedAt: string
}

interface HistorySourceResult {
  entries: StoreImportHistoryEntry[]
  available: boolean
}

const HISTORY_LIMIT = 20

function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function date(value: unknown): string | null {
  const parsed = string(value)
  if (!parsed || !/^\d{4}-\d{2}-\d{2}$/.test(parsed)) return null
  const instant = new Date(`${parsed}T00:00:00Z`)
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === parsed
    ? parsed
    : null
}

function timestamp(value: unknown): string | null {
  const parsed = string(value)
  return parsed && Number.isFinite(Date.parse(parsed)) ? parsed : null
}

function row(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function operationalEntry(value: unknown): StoreImportHistoryEntry | null {
  const source = row(value)
  if (!source) return null

  const id = string(source.id)
  const kind = source.import_kind
  const scopeKey = string(source.scope_key)
  const sourceSha256 = string(source.source_sha256)
  const status = source.status
  const rowCount = number(source.row_count)
  const warningCount = number(source.warning_count)
  const errorCount = number(source.error_count)
  // Rows published before migration 085 acquire a database default of zero;
  // keep the same fail-soft behavior for reconciled/read-only environments.
  const quarantinedCount = source.quarantined_count === null || source.quarantined_count === undefined
    ? 0
    : number(source.quarantined_count)
  const publishedAt = timestamp(source.published_at)
  if (
    !id
    || (kind !== 'prices' && kind !== 'inventory' && kind !== 'sales')
    || !scopeKey
    || !sourceSha256
    || (status !== 'published' && status !== 'superseded')
    || rowCount === null
    || warningCount === null
    || errorCount === null
    || quarantinedCount === null
    || !publishedAt
  ) return null

  return {
    id,
    kind,
    scopeKey,
    sourceSha256,
    status,
    periodStart: date(source.period_start),
    periodEnd: date(source.period_end),
    rowCount,
    warningCount,
    errorCount,
    quarantinedCount,
    publishedAt,
  }
}

function financialEntry(value: unknown): StoreImportHistoryEntry | null {
  const source = row(value)
  if (!source) return null

  const id = string(source.id)
  const scopeKey = string(source.scope_key)
  const sourceSha256 = string(source.source_sha256)
  const periodStart = date(source.period_start)
  const periodEnd = date(source.period_end)
  const rowCount = number(source.row_count)
  const warningCount = number(source.warning_count)
  const quarantinedCount = number(source.quarantined_count)
  const publishedAt = timestamp(source.published_at)
  if (
    !id
    || !scopeKey
    || !sourceSha256
    || source.status !== 'published'
    || !periodStart
    || !periodEnd
    || rowCount === null
    || warningCount === null
    || quarantinedCount === null
    || !publishedAt
  ) return null

  return {
    id,
    kind: 'management_period',
    scopeKey,
    sourceSha256,
    status: 'published',
    periodStart,
    periodEnd,
    rowCount,
    warningCount,
    errorCount: 0,
    quarantinedCount,
    publishedAt,
  }
}

async function loadOperationalHistory(
  client: SupabaseClient,
  userId: string,
): Promise<HistorySourceResult> {
  try {
    const { data, error } = await client
      .from('store_import_runs')
      .select('id,import_kind,scope_key,source_sha256,status,period_start,period_end,row_count,warning_count,error_count,quarantined_count,published_at')
      .eq('user_id', userId)
      .in('status', ['published', 'superseded'])
      .order('published_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    if (error || !Array.isArray(data)) return { entries: [], available: false }
    return {
      entries: data.flatMap((value) => {
        const entry = operationalEntry(value)
        return entry ? [entry] : []
      }),
      available: true,
    }
  } catch {
    return { entries: [], available: false }
  }
}

async function loadFinancialHistory(
  client: SupabaseClient,
  userId: string,
): Promise<HistorySourceResult> {
  try {
    const { data, error } = await client
      .from('store_financial_imports')
      .select('id,scope_key,source_sha256,status,period_start,period_end,row_count,warning_count,quarantined_count,published_at')
      .eq('user_id', userId)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    if (error || !Array.isArray(data)) return { entries: [], available: false }
    return {
      entries: data.flatMap((value) => {
        const entry = financialEntry(value)
        return entry ? [entry] : []
      }),
      available: true,
    }
  } catch {
    return { entries: [], available: false }
  }
}

async function loadCurrentFinancialImportIds(
  client: SupabaseClient,
  userId: string,
  importIds: string[],
): Promise<Set<string> | null> {
  if (importIds.length === 0) return new Set()
  try {
    const { data, error } = await client
      .from('store_financial_periods')
      .select('import_id')
      .eq('user_id', userId)
      .in('import_id', importIds)
      .is('superseded_at', null)
    if (error || !Array.isArray(data)) return null

    const currentIds = new Set<string>()
    for (const value of data) {
      const source = row(value)
      const importId = source ? string(source.import_id) : null
      // Malformed optional data must not make a published import look replaced.
      if (!importId) return null
      currentIds.add(importId)
    }
    return currentIds
  } catch {
    return null
  }
}

/**
 * Loads both operational Store publications and the separate management P&L
 * audit table. Each source is optional so a rollout with only one migration is
 * still useful, while every query remains bound to the authenticated owner.
 */
export async function loadStoreImportHistory(
  client: SupabaseClient,
  userId: string,
): Promise<StoreImportHistoryEntry[]> {
  const [operational, financial] = await Promise.all([
    loadOperationalHistory(client, userId),
    loadFinancialHistory(client, userId),
  ])

  let financialEntries = financial.entries
  if (financial.available && financialEntries.length > 0) {
    const currentImportIds = await loadCurrentFinancialImportIds(
      client,
      userId,
      financialEntries.map((entry) => entry.id),
    )
    if (currentImportIds) {
      financialEntries = financialEntries.map((entry) => ({
        ...entry,
        status: currentImportIds.has(entry.id) ? 'published' : 'superseded',
      }))
    }
  }

  return [...operational.entries, ...financialEntries]
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, HISTORY_LIMIT)
}
