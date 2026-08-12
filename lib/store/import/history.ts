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
  publishedAt: string
}

function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export async function loadStoreImportHistory(
  client: SupabaseClient,
  userId: string,
): Promise<StoreImportHistoryEntry[]> {
  const { data, error } = await client
    .from('store_import_runs')
    .select('id,import_kind,scope_key,source_sha256,status,period_start,period_end,row_count,warning_count,error_count,published_at')
    .eq('user_id', userId)
    .in('status', ['published', 'superseded'])
    .order('published_at', { ascending: false })
    .limit(20)
  if (error || !Array.isArray(data)) return []

  return data.flatMap((value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    const id = string(row.id)
    const kind = row.import_kind
    const scopeKey = string(row.scope_key)
    const sourceSha256 = string(row.source_sha256)
    const status = row.status
    const rowCount = number(row.row_count)
    const warningCount = number(row.warning_count)
    const errorCount = number(row.error_count)
    const publishedAt = string(row.published_at)
    if (
      !id
      || (kind !== 'prices' && kind !== 'inventory' && kind !== 'sales')
      || !scopeKey
      || !sourceSha256
      || (status !== 'published' && status !== 'superseded')
      || rowCount === null
      || warningCount === null
      || errorCount === null
      || !publishedAt
    ) return []
    return [{
      id,
      kind,
      scopeKey,
      sourceSha256,
      status,
      periodStart: string(row.period_start),
      periodEnd: string(row.period_end),
      rowCount,
      warningCount,
      errorCount,
      publishedAt,
    }]
  })
}
