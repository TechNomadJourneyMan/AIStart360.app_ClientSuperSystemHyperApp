import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildStorePublishManifestSha256,
  STORE_IMPORT_SCHEMA_VERSION,
  type StorePublishPayload,
} from './publication'

export interface PublishStoreImportInput {
  userId: string
  companyId: string
  sourceFileName: string
  sourceSizeBytes: number
  sourceSha256: string
  idempotencyKey: string
  payload: StorePublishPayload
}

export interface PublishStoreImportResult {
  outcome: 'published' | 'duplicate'
  importRunId: string
  importKind: StorePublishPayload['importKind']
  scopeKey: string
  rowCount: number
  publishedAt: string
  supersededRunId: string | null
}

export class StorePublishRepositoryError extends Error {
  constructor(
    public readonly code: 'conflict' | 'invalid_payload' | 'unavailable',
  ) {
    super(code)
    this.name = 'StorePublishRepositoryError'
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function integer(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function parseResult(value: unknown): PublishStoreImportResult | null {
  const row = Array.isArray(value) ? asRecord(value[0]) : asRecord(value)
  if (!row) return null
  const outcome = row.outcome
  const importRunId = text(row.import_run_id)
  const importKind = row.import_kind
  const scopeKey = text(row.scope_key)
  const rowCount = integer(row.row_count)
  const publishedAt = text(row.published_at)
  if (
    (outcome !== 'published' && outcome !== 'duplicate')
    || !importRunId
    || (
      importKind !== 'prices'
      && importKind !== 'inventory'
      && importKind !== 'sales'
      && importKind !== 'management_period'
    )
    || !scopeKey
    || rowCount === null
    || !publishedAt
  ) return null
  return {
    outcome,
    importRunId,
    importKind,
    scopeKey,
    rowCount,
    publishedAt,
    supersededRunId: text(row.superseded_run_id),
  }
}

export async function publishStoreImport(
  client: SupabaseClient,
  input: PublishStoreImportInput,
): Promise<PublishStoreImportResult> {
  const manifestSha256 = buildStorePublishManifestSha256({
    sourceSha256: input.sourceSha256,
    sourceSizeBytes: input.sourceSizeBytes,
    payload: input.payload,
  })
  const commonArguments = {
    p_user_id: input.userId,
    p_company_id: input.companyId,
    p_source_sha256: input.sourceSha256,
    p_source_file_name: input.sourceFileName,
    p_source_size_bytes: input.sourceSizeBytes,
    p_schema_version: STORE_IMPORT_SCHEMA_VERSION,
    p_idempotency_key: input.idempotencyKey,
    p_manifest_sha256: manifestSha256,
    p_scope_key: input.payload.scopeKey,
    p_period_start: input.payload.periodStart,
    p_period_end: input.payload.periodEnd,
    p_warning_count: input.payload.warningCount,
    p_quarantined_count: input.payload.quarantinedCount,
    p_rows: input.payload.rows,
  }
  const { data, error } = input.payload.importKind === 'management_period'
    ? await client.rpc('publish_store_financial_import', commonArguments)
    : await client.rpc('publish_store_import', {
        ...commonArguments,
        p_import_kind: input.payload.importKind,
        p_effective_date: input.payload.effectiveDate,
      })

  if (error) {
    const code = typeof error.code === 'string' ? error.code : ''
    if (code === '23505' || code === '40001' || code === 'P0002') {
      throw new StorePublishRepositoryError('conflict')
    }
    if (code === '22023' || code === '23514' || code === '42501' || code === 'P0001') {
      throw new StorePublishRepositoryError('invalid_payload')
    }
    throw new StorePublishRepositoryError('unavailable')
  }

  const result = parseResult(data)
  if (!result) throw new StorePublishRepositoryError('unavailable')
  return result
}
