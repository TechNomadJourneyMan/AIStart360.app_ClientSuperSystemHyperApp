import type { SupabaseClient } from '@supabase/supabase-js'
import { getMetricById } from '@/lib/metrics/registry'
import type { ParsedDataPayload } from '@/lib/documents/extract'
import {
  POINT_A_MAPPING_VERSION,
  pointAFieldKeyForDocument,
  pointAFieldKeysForSurvey,
  pointAFieldLabel,
  pointAFieldSection,
  requiredPointAFields,
} from './mapping'
import { normalizePointAValue } from './normalization'
import type {
  PointACandidateInput,
  PointAFieldView,
  PointAModelView,
  PointAResolutionStatus,
  PointAScenario,
  PointASourceInput,
  PointAValueRow,
} from './types'

type Client = SupabaseClient

interface ResolutionKey {
  companyId: string
  fieldKey: string
  periodKey: string
  scenario: PointAScenario
}

interface ResolutionRow {
  id: string
  user_id: string
  company_id: string
  field_key: string
  period_key: string
  scenario: PointAScenario
  selected_value_id: string | null
  resolution_status: PointAResolutionStatus
  updated_at: string
}

interface SourceRow {
  id: string
  user_id: string
  company_id: string | null
  source_type: PointASourceInput['sourceType']
  native_source_id: string | null
  source_name: string | null
  metadata: Record<string, unknown> | null
  status: string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

function atomicCandidatePayload(candidate: PointACandidateInput) {
  return {
    candidate_key: candidate.candidateKey,
    field_key: candidate.fieldKey,
    raw_value: candidate.rawValue,
    normalized_value: candidate.normalizedValue,
    value_type: candidate.valueType,
    unit: candidate.unit,
    currency: candidate.currency,
    period_key: candidate.period.key,
    period_start: candidate.period.start,
    period_end: candidate.period.end,
    period_year: candidate.period.year,
    period_quarter: candidate.period.quarter,
    period_month: candidate.period.month,
    scenario: candidate.scenario,
    extraction_kind: candidate.extractionKind,
    source_fragment: candidate.sourceFragment ?? null,
    source_locator: candidate.sourceLocator ?? {},
    confidence: candidate.confidence ?? null,
    status:
      candidate.status ??
      ((candidate.confidence ?? 1) < 0.65 ? 'needs_confirmation' : 'detected'),
  }
}

function rpcRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null
  if (data && typeof data === 'object') return data as T
  return null
}

export async function verifyOwnedCompany(
  sb: Client,
  userId: string,
  companyId: string | null | undefined,
): Promise<string> {
  let query = sb
    .from('companies')
    .select('id')
    .eq('user_id', userId)

  if (companyId) query = query.eq('id', companyId)
  const { data, error } = await query.order('id', { ascending: true }).limit(1).maybeSingle()
  if (error) throw new Error(`Не удалось проверить компанию: ${error.message}`)
  if (!data?.id) throw new Error('Компания пользователя не найдена')
  return String(data.id)
}

function storedAnswerValue(answer: unknown): unknown {
  if (
    answer
    && typeof answer === 'object'
    && !Array.isArray(answer)
    && Object.prototype.hasOwnProperty.call(answer, 'value')
  ) {
    return (answer as { value: unknown }).value
  }
  return answer
}

/**
 * Legacy users may have survey answers before the company row became
 * mandatory. Bootstrap the one-per-user company lazily so survey/document
 * writes and canonical Point A can migrate those users without manual SQL.
 */
export async function ensureOwnedCompany(
  sb: Client,
  userId: string,
  companyId?: string | null,
): Promise<string> {
  if (companyId) return verifyOwnedCompany(sb, userId, companyId)

  try {
    return await verifyOwnedCompany(sb, userId, null)
  } catch (error) {
    if (!pointARepositoryError(error).includes('не найдена')) throw error
  }

  const { data: companyNameRow } = await sb
    .from('survey_answers')
    .select('answer')
    .eq('user_id', userId)
    .eq('question_key', 's1_company_name')
    .maybeSingle()
  const storedName = storedAnswerValue(companyNameRow?.answer)
  const name = typeof storedName === 'string' && storedName.trim()
    ? storedName.trim()
    : 'Моя компания'

  const { data, error } = await sb
    .from('companies')
    .insert({ user_id: userId, name })
    .select('id')
    .single()
  if (!error && data?.id) return String(data.id)

  if (error?.code === '23505') {
    return verifyOwnedCompany(sb, userId, null)
  }
  throw new Error(`Не удалось создать компанию: ${error?.message ?? 'unknown error'}`)
}

export async function ensurePointASource(
  sb: Client,
  input: PointASourceInput,
): Promise<SourceRow> {
  const companyId = await verifyOwnedCompany(sb, input.userId, input.companyId)
  const { data, error } = await sb.rpc('point_a_ensure_source_atomic', {
    p_user_id: input.userId,
    p_company_id: companyId,
    p_source_type: input.sourceType,
    p_native_source_id: input.nativeSourceId,
    p_source_name: input.sourceName ?? null,
    p_content_hash: input.contentHash ?? null,
    p_status: input.status ?? 'ready',
    p_metadata: input.metadata ?? {},
  })
  const source = rpcRow<SourceRow>(data)
  if (error || !source) {
    throw new Error(error?.message ?? 'Не удалось создать или обновить источник')
  }
  return source
}

async function markPointASourceMappingComplete(
  sb: Client,
  source: SourceRow,
): Promise<void> {
  const { error } = await sb
    .from('point_a_sources')
    .update({
      metadata: {
        ...(source.metadata ?? {}),
        mapping_version: POINT_A_MAPPING_VERSION,
        mapping_complete: true,
      },
    })
    .eq('id', source.id)
  if (error) throw new Error(error.message)
}

export async function recomputePointAField(
  sb: Client,
  key: ResolutionKey,
  decision?: { actorId?: string; reason?: string },
): Promise<ResolutionRow> {
  const { data: company, error: companyError } = await sb
    .from('companies')
    .select('user_id')
    .eq('id', key.companyId)
    .single()
  if (companyError || !company?.user_id) throw new Error('Компания не найдена')

  const { data, error } = await sb.rpc('point_a_recompute_field_atomic', {
    p_user_id: String(company.user_id),
    p_company_id: key.companyId,
    p_field_key: key.fieldKey,
    p_period_key: key.periodKey,
    p_scenario: key.scenario,
    p_actor_id: decision?.actorId ?? null,
    p_reason: decision?.reason ?? null,
    p_expected_version: null,
  })
  const resolution = rpcRow<ResolutionRow>(data)
  if (error || !resolution) {
    throw new Error(error?.message ?? 'Не удалось пересчитать поле')
  }
  return resolution
}

export async function ingestPointACandidates(
  sb: Client,
  source: SourceRow,
  candidates: PointACandidateInput[],
  actorId?: string | null,
): Promise<{ created: number; unchanged: number; fields: string[] }> {
  if (!source.company_id) throw new Error('Источник не связан с компанией')
  const { data, error } = await sb.rpc('point_a_ingest_candidates_atomic', {
    p_user_id: source.user_id,
    p_company_id: source.company_id,
    p_source_id: source.id,
    p_candidates: candidates.map(atomicCandidatePayload),
    p_actor_id: actorId ?? null,
    p_replace_missing: true,
    p_expected_versions: null,
  })
  const result = rpcRow<{
    created?: number
    unchanged?: number
    resolutions?: Array<{ field_key?: string }>
  }>(data)
  if (error || !result) {
    throw new Error(error?.message ?? 'Не удалось сохранить значения Точки А')
  }
  const fields = new Set(candidates.map((candidate) => candidate.fieldKey))
  for (const resolution of result.resolutions ?? []) {
    if (resolution.field_key) fields.add(resolution.field_key)
  }
  return {
    created: Number(result.created ?? 0),
    unchanged: Number(result.unchanged ?? 0),
    fields: [...fields],
  }
}

export async function ingestSurveyAnswersToPointA(
  sb: Client,
  input: {
    userId: string
    companyId: string
    answers: Record<string, unknown>
    step: number
  },
) {
  const results = await Promise.all(Object.entries(input.answers).map(async ([questionKey, rawValue]) => {
    const fields = pointAFieldKeysForSurvey(questionKey)
    const source = await ensurePointASource(sb, {
      userId: input.userId,
      companyId: input.companyId,
      sourceType: 'survey',
      nativeSourceId: `survey:${questionKey}`,
      sourceName: `Анкета — ${pointAFieldLabel(`survey.${questionKey}`)}`,
      metadata: {
        question_key: questionKey,
        step: input.step,
        mapping_version: POINT_A_MAPPING_VERSION,
        mapping_complete: false,
      },
    })
    const candidates = fields.map((fieldKey) => {
      const metric = getMetricById(fieldKey)
      const normalized = normalizePointAValue(rawValue, {
        unit: metric?.unit || null,
        context: `${questionKey} ${metric?.label ?? ''}`,
      })
      return {
        ...normalized,
        candidateKey: `${questionKey}:${fieldKey}`,
        fieldKey,
        extractionKind: 'survey' as const,
        confidence: 1,
        status: 'detected' as const,
        sourceLocator: { question_key: questionKey, step: input.step },
      }
    })
    const result = await ingestPointACandidates(sb, source, candidates, input.userId)
    await markPointASourceMappingComplete(sb, source)
    return result
  }))
  return {
    created: results.reduce((sum, item) => sum + item.created, 0),
    unchanged: results.reduce((sum, item) => sum + item.unchanged, 0),
    fields: [...new Set(results.flatMap((item) => item.fields))],
  }
}

export async function backfillStoredSurveyAnswersToPointA(
  sb: Client,
  input: { userId: string; companyId: string },
) {
  const [{ data: rows, error: answersError }, { data: sources, error: sourcesError }] =
    await Promise.all([
      sb
        .from('survey_answers')
        .select('step,question_key,answer')
        .eq('user_id', input.userId)
        .order('answered_at', { ascending: true }),
      sb
        .from('point_a_sources')
        .select('native_source_id,metadata')
        .eq('user_id', input.userId)
        .eq('company_id', input.companyId)
        .eq('source_type', 'survey')
        .neq('status', 'deleted'),
    ])
  if (answersError) throw new Error(answersError.message)
  if (sourcesError) throw new Error(sourcesError.message)

  const currentVersionSources = new Set(
    (sources ?? [])
      .filter((source) => {
        const metadata = source.metadata as Record<string, unknown> | null
        return (
          Number(metadata?.mapping_version) === POINT_A_MAPPING_VERSION
          && metadata?.mapping_complete === true
        )
      })
      .map((source) => source.native_source_id)
      .filter((id): id is string => typeof id === 'string'),
  )
  const grouped = new Map<number, Record<string, unknown>>()
  for (const row of rows ?? []) {
    if (currentVersionSources.has(`survey:${row.question_key}`)) continue
    const step = Number(row.step) || 0
    const answers = grouped.get(step) ?? {}
    answers[String(row.question_key)] = storedAnswerValue(row.answer)
    grouped.set(step, answers)
  }

  let created = 0
  let unchanged = 0
  const fields = new Set<string>()
  // Keep steps sequential because older/newer survey versions can map to the
  // same canonical field and must resolve deterministically.
  for (const [step, answers] of grouped) {
    const result = await ingestSurveyAnswersToPointA(sb, {
      ...input,
      step,
      answers,
    })
    created += result.created
    unchanged += result.unchanged
    result.fields.forEach((field) => fields.add(field))
  }
  return { created, unchanged, fields: [...fields] }
}

function parsedPayload(value: unknown): ParsedDataPayload | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<ParsedDataPayload>
  if (!Array.isArray(record.fields)) return null
  return record as ParsedDataPayload
}

export async function ingestDocumentToPointA(
  sb: Client,
  input: {
    id: string
    userId: string
    companyId: string
    fileName: string
    docType: string
    parsedData: unknown
    contentHash?: string | null
    periodYear?: number | null
    periodQuarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
  },
) {
  const payload = parsedPayload(input.parsedData)
  if (!payload) throw new Error('Документ не содержит извлечённых полей')
  const source = await ensurePointASource(sb, {
    userId: input.userId,
    companyId: input.companyId,
    sourceType: 'document',
    nativeSourceId: input.id,
    sourceName: input.fileName,
    contentHash: input.contentHash ?? null,
    status: 'ready',
    metadata: {
      document_id: input.id,
      doc_type: input.docType,
      classification: payload.classification ?? null,
      extracted_at: payload.extracted_at,
      mapping_version: POINT_A_MAPPING_VERSION,
      mapping_complete: false,
    },
  })

  const tableLike =
    ['xlsx', 'xls', 'csv'].some((ext) => input.fileName.toLowerCase().endsWith(`.${ext}`)) ||
    Boolean(payload.raw_rows?.length || payload.client_rows?.length)
  const imageLike = /\.(png|jpe?g)$/i.test(input.fileName)
  const fields = payload.fields.map((field, index) => {
    const fieldKey = pointAFieldKeyForDocument({
      key: field.key || `field_${index + 1}`,
      label: field.label,
      targetParameter: field.target_parameter,
      metricId: field.metric_id,
    })
    const metric = getMetricById(fieldKey)
    const normalized = normalizePointAValue(field.value, {
      unit: metric?.unit || null,
      periodYear: input.periodYear ?? null,
      periodQuarter: input.periodQuarter ?? null,
      context: `${field.key} ${field.label} ${field.target_parameter}`,
    })
    return {
      ...normalized,
      candidateKey: `${field.key || index}:${fieldKey}`,
      fieldKey,
      extractionKind:
        tableLike
          ? 'table' as const
          : imageLike
            ? 'ocr' as const
            : 'text' as const,
      sourceFragment: field.source ?? null,
      sourceLocator: {
        document_id: input.id,
        field_key: field.key,
        target_tab: field.target_tab,
        target_parameter: field.target_parameter,
      },
      confidence: field.confidence ?? null,
      status:
        (field.confidence ?? 0.5) < 0.65
          ? 'needs_confirmation' as const
          : 'detected' as const,
    }
  })
  const result = await ingestPointACandidates(sb, source, fields, input.userId)
  await markPointASourceMappingComplete(sb, source)
  return result
}

/**
 * Parsed documents are authoritative even when the best-effort Point A sync
 * failed after extraction. Reading the model repairs missing or outdated
 * mappings, making document parsing and canonical ingestion eventually
 * consistent without requiring the user to upload the file again.
 */
export async function backfillStoredDocumentsToPointA(
  sb: Client,
  input: { userId: string; companyId: string },
) {
  const [{ data: documents, error: documentsError }, { data: sources, error: sourcesError }] =
    await Promise.all([
      sb
        .from('documents')
        .select('id,file_name,doc_type,parsed_data,content_hash,period_year,period_quarter')
        .eq('user_id', input.userId)
        .eq('company_id', input.companyId)
        .not('parsed_data', 'is', null)
        .order('uploaded_at', { ascending: true }),
      sb
        .from('point_a_sources')
        .select('native_source_id,metadata')
        .eq('user_id', input.userId)
        .eq('company_id', input.companyId)
        .eq('source_type', 'document')
        .neq('status', 'deleted'),
    ])
  if (documentsError) throw new Error(documentsError.message)
  if (sourcesError) throw new Error(sourcesError.message)

  const currentVersionSources = new Set(
    (sources ?? [])
      .filter((source) => {
        const metadata = source.metadata as Record<string, unknown> | null
        return (
          Number(metadata?.mapping_version) === POINT_A_MAPPING_VERSION
          && metadata?.mapping_complete === true
        )
      })
      .map((source) => source.native_source_id)
      .filter((id): id is string => typeof id === 'string'),
  )

  let created = 0
  let unchanged = 0
  const fields = new Set<string>()
  for (const document of documents ?? []) {
    if (currentVersionSources.has(String(document.id))) continue
    const result = await ingestDocumentToPointA(sb, {
      id: String(document.id),
      userId: input.userId,
      companyId: input.companyId,
      fileName: String(document.file_name),
      docType: String(document.doc_type),
      parsedData: document.parsed_data,
      contentHash: document.content_hash as string | null,
      periodYear: document.period_year as number | null,
      periodQuarter: document.period_quarter as 'Q1' | 'Q2' | 'Q3' | 'Q4' | null,
    })
    created += result.created
    unchanged += result.unchanged
    result.fields.forEach((field) => fields.add(field))
    const { error: repairStatusError } = await sb
      .from('documents')
      .update({ parse_status: 'parsed', parse_error: null, processing_started_at: null })
      .eq('id', document.id)
      .eq('user_id', input.userId)
    if (repairStatusError) throw new Error(repairStatusError.message)
  }
  return { created, unchanged, fields: [...fields] }
}

export async function setManualPointAValue(
  sb: Client,
  input: {
    userId: string
    companyId: string
    fieldKey: string
    value: unknown
    unit?: string | null
    currency?: string | null
    period?: string | null
    periodYear?: number | null
    periodQuarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
    periodMonth?: number | null
    scenario?: PointAScenario
  },
) {
  const metric = getMetricById(input.fieldKey)
  const normalized = normalizePointAValue(input.value, {
    unit: input.unit ?? metric?.unit ?? null,
    currency: input.currency,
    period: input.period,
    periodYear: input.periodYear,
    periodQuarter: input.periodQuarter,
    periodMonth: input.periodMonth,
    scenario: input.scenario,
    context: `${input.fieldKey} ${metric?.label ?? ''}`,
  })
  const source = await ensurePointASource(sb, {
    userId: input.userId,
    companyId: input.companyId,
    sourceType: 'manual',
    nativeSourceId: `manual:${input.fieldKey}:${normalized.period.key}:${normalized.scenario}`,
    sourceName: `Ручное значение — ${pointAFieldLabel(input.fieldKey)}`,
    metadata: { field_key: input.fieldKey },
  })
  return ingestPointACandidates(sb, source, [{
    ...normalized,
    candidateKey: `${input.fieldKey}:${normalized.period.key}:${normalized.scenario}`,
    fieldKey: input.fieldKey,
    extractionKind: 'manual',
    confidence: 1,
    status: 'detected',
    sourceLocator: { entered_by: input.userId },
  }], input.userId)
}

export async function confirmPointAValue(
  sb: Client,
  input: {
    userId: string
    companyId: string
    valueId: string
    eventType?: 'confirmed' | 'conflict_resolved'
  },
) {
  const companyId = await verifyOwnedCompany(sb, input.userId, input.companyId)
  const { data, error } = await sb.rpc('point_a_confirm_value_atomic', {
    p_user_id: input.userId,
    p_company_id: companyId,
    p_value_id: input.valueId,
    p_event_type: input.eventType ?? 'confirmed',
    p_expected_version: null,
    p_reason: input.eventType === 'conflict_resolved'
      ? 'Пользователь выбрал значение в конфликте'
      : 'Пользователь подтвердил значение',
  })
  const resolution = rpcRow<ResolutionRow>(data)
  if (error || !resolution) {
    throw new Error(error?.message ?? 'Не удалось подтвердить значение')
  }
  return resolution
}

export async function retractPointASource(
  sb: Client,
  input: { userId: string; companyId: string; sourceId: string; force?: boolean },
) {
  const companyId = await verifyOwnedCompany(sb, input.userId, input.companyId)
  const { data, error } = await sb.rpc('point_a_retract_source_atomic', {
    p_user_id: input.userId,
    p_company_id: companyId,
    p_source_id: input.sourceId,
    p_force_confirmed: input.force ?? false,
    p_expected_versions: null,
    p_reason: 'source_retracted',
  })
  const result = rpcRow<{ retracted?: number; groups?: number }>(data)
  if (error || !result) {
    throw new Error(error?.message ?? 'Не удалось удалить источник')
  }
  return {
    retracted: Number(result.retracted ?? 0),
    fields: Number(result.groups ?? 0),
  }
}

export async function retractDocumentPointASource(
  sb: Client,
  input: { userId: string; companyId: string; documentId: string; force?: boolean },
) {
  const { data: source, error } = await sb
    .from('point_a_sources')
    .select('id')
    .eq('user_id', input.userId)
    .eq('company_id', input.companyId)
    .eq('source_type', 'document')
    .eq('native_source_id', input.documentId)
    .neq('status', 'deleted')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!source?.id) return { retracted: 0, fields: 0 }
  return retractPointASource(sb, { ...input, sourceId: source.id })
}

export async function deleteDocumentAndRetractPointA(
  sb: Client,
  input: {
    userId: string
    companyId: string
    documentId: string
    force?: boolean
  },
) {
  const companyId = await verifyOwnedCompany(sb, input.userId, input.companyId)
  const { data, error } = await sb.rpc('point_a_delete_document_atomic', {
    p_user_id: input.userId,
    p_company_id: companyId,
    p_document_id: input.documentId,
    p_force_confirmed: input.force ?? false,
    p_expected_versions: null,
    p_reason: 'document_deleted',
  })
  const result = rpcRow<{
    deleted?: boolean
    document_id?: string
    file_url?: string | null
    parse_status?: string | null
    retraction?: { retracted?: number; groups?: number }
  }>(data)
  if (error || !result) {
    throw new Error(error?.message ?? 'Не удалось удалить документ')
  }
  return result
}

export async function readPointAModel(
  sb: Client,
  input: { userId: string; companyId: string },
): Promise<PointAModelView> {
  const companyId = await verifyOwnedCompany(sb, input.userId, input.companyId)
  const [{ data: resolutions, error: resolutionsError }, { data: events, error: eventsError }] =
    await Promise.all([
      sb
        .from('point_a_resolutions')
        .select('id,user_id,company_id,field_key,period_key,scenario,selected_value_id,resolution_status,updated_at')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false }),
      sb
        .from('point_a_value_events')
        .select('id,field_key,event_type,created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(20),
    ])
  if (resolutionsError) throw new Error(resolutionsError.message)
  if (eventsError) throw new Error(eventsError.message)

  const resolutionRows = (resolutions ?? []) as ResolutionRow[]
  const { data: values, error: valuesError } = await sb
    .from('point_a_values')
    .select('*')
    .eq('company_id', companyId)
    .not('status', 'in', '("superseded","retracted","rejected")')
    .order('updated_at', { ascending: false })
  if (valuesError) throw new Error(valuesError.message)

  const sourceIds = [...new Set((values ?? []).map((value) => String(value.source_id)))]
  let sources = new Map<string, SourceRow>()
  if (sourceIds.length) {
    const { data, error } = await sb
      .from('point_a_sources')
      .select('id,user_id,company_id,source_type,native_source_id,source_name,metadata,status')
      .in('id', sourceIds)
    if (error) throw new Error(error.message)
    sources = new Map((data ?? []).map((source) => [String(source.id), source as SourceRow]))
  }

  const enriched = (values ?? []).map((value) => ({
    ...value,
    point_a_sources: sources.get(String(value.source_id)) ?? null,
  })) as PointAValueRow[]
  const byGroup = new Map<string, PointAValueRow[]>()
  for (const value of enriched) {
    const group = `${value.field_key}|${value.period_key}|${value.scenario}`
    byGroup.set(group, [...(byGroup.get(group) ?? []), value])
  }

  const fields: PointAFieldView[] = resolutionRows.map((resolution) => {
    const group = `${resolution.field_key}|${resolution.period_key}|${resolution.scenario}`
    const candidates = byGroup.get(group) ?? []
    return {
      resolutionId: resolution.id,
      fieldKey: resolution.field_key,
      periodKey: resolution.period_key,
      scenario: resolution.scenario,
      label: pointAFieldLabel(resolution.field_key),
      section: pointAFieldSection(resolution.field_key),
      selected:
        candidates.find((candidate) => candidate.id === resolution.selected_value_id) ?? null,
      candidates,
      resolutionStatus: resolution.resolution_status,
      updatedAt: resolution.updated_at,
    }
  }).filter((field) => field.selected !== null && field.resolutionStatus !== 'empty')
  const required = requiredPointAFields()
  const present = new Set(
    fields
      .filter((field) => field.selected && field.resolutionStatus !== 'empty')
      .map((field) => field.fieldKey),
  )
  const missing = required.filter((field) => !present.has(field.fieldKey))
  const completion = required.length
    ? Math.round(((required.length - missing.length) / required.length) * 100)
    : 100

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    completion,
    fields,
    conflicts: fields.filter((field) => field.resolutionStatus === 'conflict'),
    missing,
    recentChanges: (events ?? []).map((event) => ({
      id: String(event.id),
      fieldKey: String(event.field_key),
      eventType: String(event.event_type),
      createdAt: String(event.created_at),
    })),
  }
}

export async function readPointAFieldHistory(
  sb: Client,
  input: { userId: string; companyId: string; fieldKey: string },
) {
  const companyId = await verifyOwnedCompany(sb, input.userId, input.companyId)
  const { data, error } = await sb
    .from('point_a_value_events')
    .select('*')
    .eq('company_id', companyId)
    .eq('field_key', input.fieldKey)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export function pointARepositoryError(error: unknown): string {
  return errorMessage(error)
}
