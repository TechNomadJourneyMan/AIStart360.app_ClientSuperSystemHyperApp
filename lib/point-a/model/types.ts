export type PointASourceType =
  | 'survey'
  | 'manual'
  | 'document'
  | 'computed'
  | 'prisma'
  | 'external'

export type PointAExtractionKind =
  | 'confirmed'
  | 'manual'
  | 'survey'
  | 'table'
  | 'text'
  | 'ocr'
  | 'computed'
  | 'prisma'
  | 'external'
  | 'inferred'

export type PointAValueType =
  | 'number'
  | 'text'
  | 'boolean'
  | 'date'
  | 'list'
  | 'object'

export type PointAScenario = 'fact' | 'plan' | 'forecast'

export type PointAValueStatus =
  | 'detected'
  | 'needs_confirmation'
  | 'confirmed'
  | 'rejected'
  | 'superseded'
  | 'retracted'

export type PointAResolutionStatus =
  | 'resolved'
  | 'conflict'
  | 'needs_confirmation'
  | 'empty'

export interface PointAPeriod {
  key: string
  start: string | null
  end: string | null
  year: number | null
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
  month: number | null
}

export interface NormalizedPointAValue {
  rawValue: unknown
  normalizedValue: unknown
  valueType: PointAValueType
  unit: string | null
  currency: string | null
  period: PointAPeriod
  scenario: PointAScenario
  validForAggregation: boolean
}

export interface PointACandidateInput extends NormalizedPointAValue {
  candidateKey: string
  fieldKey: string
  extractionKind: PointAExtractionKind
  sourceFragment?: string | null
  sourceLocator?: Record<string, unknown>
  confidence?: number | null
  status?: PointAValueStatus
}

export interface PointASourceInput {
  userId: string
  companyId: string
  sourceType: PointASourceType
  nativeSourceId: string
  sourceName?: string | null
  contentHash?: string | null
  status?: 'active' | 'processing' | 'ready' | 'error' | 'deleted'
  metadata?: Record<string, unknown>
}

export interface PointAValueRow {
  id: string
  user_id: string
  company_id: string | null
  source_id: string
  candidate_key: string
  field_key: string
  raw_value: unknown
  normalized_value: unknown
  value_type: PointAValueType
  unit: string | null
  currency: string | null
  period_key: string
  period_start: string | null
  period_end: string | null
  period_year: number | null
  period_quarter: PointAPeriod['quarter']
  period_month: number | null
  scenario: PointAScenario
  extraction_kind: PointAExtractionKind
  source_fragment: string | null
  source_locator: Record<string, unknown> | null
  confidence: number | string | null
  status: PointAValueStatus
  supersedes_value_id?: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  created_at: string
  updated_at: string
  point_a_sources?: {
    id: string
    source_type: PointASourceType
    source_name: string | null
    native_source_id: string | null
    metadata: Record<string, unknown> | null
  } | null
}

export interface PointAResolutionDecision {
  selected: PointAValueRow | null
  status: PointAResolutionStatus
  candidates: PointAValueRow[]
  conflictValueIds: string[]
}

export interface PointAFieldView {
  resolutionId: string | null
  fieldKey: string
  periodKey: string
  scenario: PointAScenario
  label: string
  section: string
  selected: PointAValueRow | null
  candidates: PointAValueRow[]
  resolutionStatus: PointAResolutionStatus
  updatedAt: string | null
}

export interface PointAModelView {
  companyId: string
  generatedAt: string
  completion: number
  fields: PointAFieldView[]
  conflicts: PointAFieldView[]
  missing: Array<{ fieldKey: string; label: string; section: string }>
  recentChanges: Array<{
    id: string
    fieldKey: string
    eventType: string
    createdAt: string
  }>
}
