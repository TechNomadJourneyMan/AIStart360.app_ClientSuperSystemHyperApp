/**
 * Concrete pipeline-step implementations shared by all backbones.
 *
 * Each step is an async function returning both the AiRunStep record
 * (for ai_runs.steps[] audit) and any data needed by downstream steps.
 *
 * Keep each step focused: ONE DB interaction, one transform, one
 * timed operation. Orchestrator wraps these in step.run() under Inngest
 * or /api/ai/n8n-callback calls under n8n.
 */

import { randomUUID } from 'node:crypto'

import { parseDocument, type ParsedDocument } from '@/lib/documents/parse'

import { classifyDocument, type ClassificationResult } from './classifier'
import {
  resolveConsensus,
  winnersToMetrics,
  type PersistedExtraction,
  type ConflictEntry,
} from './consensus'
import { dispatch } from './extractors/index'
import type { AiRunStep, ExtractedEntity, ExtractorContext } from './extractors/types'
import {
  surveyExtractor,
  type SurveyAnswerRow,
} from './extractors/survey/survey-extractor'

// -----------------------------------------------------------------------------
// Service role helper
// -----------------------------------------------------------------------------

function getServiceRole(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('[pipeline-steps] Supabase URL/service role key missing')
  }
  return { url, key }
}

async function supaGet<T>(path: string): Promise<T[]> {
  const { url, key } = getServiceRole()
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`[pipeline-steps] GET ${path} → ${res.status}`)
  return (await res.json()) as T[]
}

async function supaInsert(path: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return
  const { url, key } = getServiceRole()
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`[pipeline-steps] INSERT ${path} → ${res.status}: ${body}`)
  }
}

async function supaUpdate(path: string, body: Record<string, unknown>): Promise<void> {
  const { url, key } = getServiceRole()
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[pipeline-steps] PATCH ${path} → ${res.status}: ${text}`)
  }
}

// -----------------------------------------------------------------------------
// Step 1: load survey answers
// -----------------------------------------------------------------------------

export async function loadSurveyAnswers(userId: string): Promise<SurveyAnswerRow[]> {
  return supaGet<SurveyAnswerRow>(
    `survey_answers?user_id=eq.${userId}&select=question_key,answer,step,answered_at`
  )
}

// -----------------------------------------------------------------------------
// Step 2: run survey extractor
// -----------------------------------------------------------------------------

export async function runSurveyExtractor(
  rows: SurveyAnswerRow[],
  ctx: ExtractorContext
): Promise<ExtractedEntity[]> {
  return surveyExtractor.extract(rows, ctx)
}

// -----------------------------------------------------------------------------
// Step 3: persist ExtractedEntity[] to ai_extractions
// -----------------------------------------------------------------------------

export async function persistExtractions(
  entities: ExtractedEntity[],
  ctx: ExtractorContext
): Promise<PersistedExtraction[]> {
  if (!entities.length) return []

  const now = new Date().toISOString()
  const rows = entities.map((e) => {
    const id = randomUUID()
    return {
      id,
      run_id: ctx.runId,
      user_id: ctx.userId,
      company_id: ctx.companyId,
      source_type: e.source_type,
      source_doc_id: e.source_doc_id ?? null,
      source_field: e.source_field ?? null,
      entity_type: e.entity_type,
      value: e.value,
      unit: e.unit ?? null,
      period_year: e.period_year ?? null,
      period_quarter: e.period_quarter ?? null,
      confidence: e.confidence,
      extractor_name: e.extractor_name,
      extractor_version: e.extractor_version,
      raw_excerpt: e.raw_excerpt ?? null,
      extracted_at: now,
    }
  })

  await supaInsert('ai_extractions', rows)

  // Return in PersistedExtraction shape for consensus
  return rows.map((r) => ({
    id: r.id,
    entity_type: r.entity_type,
    value: r.value,
    unit: r.unit,
    period_year: r.period_year,
    period_quarter: r.period_quarter as PersistedExtraction['period_quarter'],
    confidence: r.confidence,
    source_type: r.source_type,
    source_doc_id: r.source_doc_id,
    source_field: r.source_field,
    extractor_name: r.extractor_name,
    extractor_version: r.extractor_version,
    extracted_at: r.extracted_at,
    superseded_by: null,
  }))
}

// -----------------------------------------------------------------------------
// Step 4: load currently-active extractions for company
// -----------------------------------------------------------------------------

export async function loadActiveExtractions(
  companyId: string,
  excludeIds: string[] = []
): Promise<PersistedExtraction[]> {
  const rows = await supaGet<PersistedExtraction>(
    `ai_extractions?company_id=eq.${companyId}&superseded_by=is.null&select=*&limit=2000`
  )
  if (!excludeIds.length) return rows
  const skip = new Set(excludeIds)
  return rows.filter((r) => !skip.has(r.id))
}

// -----------------------------------------------------------------------------
// Step 5: apply consensus (writes superseded_by + ai_conflicts + metrics)
// -----------------------------------------------------------------------------

export interface ConsensusApplyResult {
  winnerCount: number
  conflictCount: number
  supersededCount: number
  metricUpsertCount: number
}

export async function applyConsensus(
  fresh: PersistedExtraction[],
  ctx: ExtractorContext
): Promise<ConsensusApplyResult> {
  // Merge fresh + existing active (excluding fresh's own ids to avoid duplication)
  const existing = await loadActiveExtractions(ctx.companyId, fresh.map((f) => f.id))
  const all = [...fresh, ...existing]

  const { winners, supersededBy, conflicts } = resolveConsensus(all)

  // Mark losers
  const loserIds = Object.keys(supersededBy)
  for (const id of loserIds) {
    await supaUpdate(`ai_extractions?id=eq.${id}`, {
      superseded_by: supersededBy[id],
    })
  }

  // Write conflicts (only those with > 1 contender; 1-contender groups are not conflicts)
  const realConflicts = conflicts.filter((c) => c.contenders.length > 1)
  if (realConflicts.length) {
    await supaInsert(
      'ai_conflicts',
      realConflicts.map((c) => ({
        id: randomUUID(),
        company_id: ctx.companyId,
        entity_type: c.entity_type,
        period_year: c.period_year,
        period_quarter: c.period_quarter,
        resolution: c.resolution,
        winner_id: c.winnerId,
        contenders: c.contenders,
      }))
    )
  }

  // Project winners into metrics table (numeric only, source='calculated')
  const metricRows = winnersToMetrics(winners, ctx.companyId)
  if (metricRows.length) {
    // Use ON CONFLICT via Prefer: resolution=merge-duplicates
    // metrics has UNIQUE (company_id, metric_key, period_year, period_quarter, source)
    // So we need to first delete old 'calculated' rows for the same keys, then insert.
    await replaceCalculatedMetrics(ctx.companyId, metricRows)
  }

  return {
    winnerCount: winners.length,
    conflictCount: realConflicts.length,
    supersededCount: loserIds.length,
    metricUpsertCount: metricRows.length,
  }
}

async function replaceCalculatedMetrics(
  companyId: string,
  rows: ReturnType<typeof winnersToMetrics>
): Promise<void> {
  const { url, key } = getServiceRole()

  // Delete existing 'calculated' rows for this company (simplest; could be per-key)
  const delRes = await fetch(
    `${url}/rest/v1/metrics?company_id=eq.${companyId}&source=eq.calculated`,
    {
      method: 'DELETE',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=minimal',
      },
    }
  )
  if (!delRes.ok && delRes.status !== 404) {
    const text = await delRes.text()
    // eslint-disable-next-line no-console
    console.warn('[pipeline-steps] calculated-metrics delete failed:', text)
  }

  await supaInsert('metrics', rows.map((r) => ({ ...r, recorded_at: new Date().toISOString() })))
}

// -----------------------------------------------------------------------------
// Helpers for building AiRunStep records
// -----------------------------------------------------------------------------

export async function timed<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ step: AiRunStep; result: T }> {
  const start = Date.now()
  try {
    const result = await fn()
    return {
      step: {
        name,
        status: 'completed',
        duration_ms: Date.now() - start,
      },
      result,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Promise.reject(
      Object.assign(new Error(`[${name}] ${msg}`), {
        aiRunStep: {
          name,
          status: 'failed',
          duration_ms: Date.now() - start,
          error: msg,
        } as AiRunStep,
      })
    )
  }
}

// -----------------------------------------------------------------------------
// Document pipeline steps (Phase 2)
// -----------------------------------------------------------------------------

export interface DocumentRow {
  id: string
  user_id: string
  company_id: string | null
  file_name: string
  file_url: string | null
  mime_type: string | null
  doc_type: string | null
  classified_type: string | null
  content_hash: string | null
  extractor_version: string | null
}

/** Load a documents row by id (service-role bypass). */
export async function loadDocument(documentId: string): Promise<DocumentRow | null> {
  const rows = await supaGet<DocumentRow>(
    `documents?id=eq.${documentId}&select=id,user_id,company_id,file_name,file_url,mime_type,doc_type,classified_type,content_hash,extractor_version`
  )
  return rows[0] ?? null
}

/**
 * Fetch the raw bytes of a document from Supabase Storage.
 * file_url stored in documents is a storage path like `{user_id}/{kind}/{timestamp}_{name}`
 * in bucket `client-documents` (by convention). If file_url is already a full
 * https:// URL we just fetch it directly.
 */
export async function downloadDocumentBytes(doc: DocumentRow): Promise<Buffer> {
  if (!doc.file_url) throw new Error(`[pipeline-steps] documents.${doc.id}.file_url is null`)

  // Case 1: full URL (signed URL or public)
  if (/^https?:\/\//.test(doc.file_url)) {
    const res = await fetch(doc.file_url)
    if (!res.ok) throw new Error(`[pipeline-steps] download ${doc.file_url} → ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  // Case 2: storage path — generate signed URL via Supabase REST
  const { url, key } = getServiceRole()
  const bucket = 'client-documents'
  const signRes = await fetch(
    `${url}/storage/v1/object/sign/${bucket}/${encodeURI(doc.file_url)}`,
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 60 }),
    }
  )
  if (!signRes.ok) {
    const text = await signRes.text()
    throw new Error(`[pipeline-steps] storage sign failed: ${signRes.status} ${text}`)
  }
  const { signedURL } = (await signRes.json()) as { signedURL: string }
  const full = signedURL.startsWith('http') ? signedURL : `${url}/storage/v1${signedURL}`
  const fileRes = await fetch(full)
  if (!fileRes.ok) throw new Error(`[pipeline-steps] signed-url fetch → ${fileRes.status}`)
  return Buffer.from(await fileRes.arrayBuffer())
}

/** Parse + classify — returns both + raw buffer so medical extractors that
 *  need bytes (e.g. patient_base RFM) can avoid a second download. */
export async function parseAndClassify(
  doc: DocumentRow
): Promise<{ parsed: ParsedDocument & { buffer?: Buffer }; classification: ClassificationResult }> {
  const bytes = await downloadDocumentBytes(doc)
  const parsedBase = await parseDocument(bytes, doc.file_name, doc.mime_type ?? undefined)
  const parsed: ParsedDocument & { buffer?: Buffer } = Object.assign(parsedBase, { buffer: bytes })

  // Classifier only runs when upload hint is 'other' / null / classified_type missing
  const needsClassification =
    !doc.doc_type || doc.doc_type === 'other' || !doc.classified_type
  const classification = needsClassification
    ? await classifyDocument({
        fileName: doc.file_name,
        textSnippet: parsed.text,
        hintType: doc.doc_type ?? undefined,
      })
    : {
        doc_type: (doc.classified_type ?? doc.doc_type) as ClassificationResult['doc_type'],
        vertical: 'generic' as const,
        confidence: 0.9,
        reasoning: 'Upload-declared type used (high confidence).',
      }

  return { parsed, classification }
}

/**
 * Pick and run the right extractor for (vertical, doc_type). Returns
 * ExtractedEntity[] (empty if no extractor matches or Claude key missing).
 */
export async function runDocumentExtractor(
  parsed: ParsedDocument,
  ctx: ExtractorContext,
  docType: string
): Promise<{ entities: ExtractedEntity[]; extractorName: string | null }> {
  const extractor = dispatch(ctx, docType)
  if (!extractor) {
    // eslint-disable-next-line no-console
    console.warn(`[pipeline-steps] no extractor for vertical=${ctx.vertical} docType=${docType}`)
    return { entities: [], extractorName: null }
  }

  const entities = await extractor.extract(parsed, ctx)
  return { entities, extractorName: `${extractor.name}@${extractor.version}` }
}

/** Patch documents.classified_type + extractor_version after extraction. */
export async function stampDocumentProcessed(
  documentId: string,
  classification: ClassificationResult,
  extractorName: string | null
): Promise<void> {
  await supaUpdate(`documents?id=eq.${documentId}`, {
    classified_type: classification.doc_type,
    classification_conf: classification.confidence,
    extractor_version: extractorName,
    last_extracted_at: new Date().toISOString(),
    parse_status: 'completed',
  })
}

// Avoid unused-warning for dispatch — referenced here so the import isn't stripped
// when future phases add multi-extractor paths.
export { dispatch }
export type { ConflictEntry }
