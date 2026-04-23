/**
 * Medical patient-base extractor.
 *
 * Wraps the existing `segmentPatients()` in lib/rfm-segmentation.ts. Does
 * NOT reimplement RFM logic — only translates its SegmentationResult into:
 *   1. INSERTs into public.patient_segments (one row per patient, upsert
 *      on UNIQUE (client_id, patient_hash)).
 *   2. ExtractedEntity[] aggregate summaries for ai_extractions.
 *
 * Zero LLM calls — deterministic. Confidence 0.95 (data is the source of
 * truth for patient counts).
 */

import { randomUUID } from 'node:crypto'

import type { ParsedDocument } from '@/lib/documents/parse'
import {
  SEGMENT_LABELS,
  segmentPatients,
  type PatientSegmentId,
  type SegmentationResult,
} from '@/lib/rfm-segmentation'

import { excerpt, makeEntity } from '../base'
import type { Extractor, ExtractorContext, ExtractedEntity } from '../types'
import { registerExtractor } from '../registry'
import { clinicBundlesExtractor } from './clinic-bundles'
import { revenueLossesExtractor } from './revenue-losses'

const NAME = 'medical.patient-base'
const VERSION = '1.0.0'

export const patientBaseExtractor: Extractor<ParsedDocument & { buffer?: Buffer }> = {
  name: NAME,
  version: VERSION,
  label: 'Patient base (xlsx/csv → RFM segmentation)',

  supports(ctx: ExtractorContext): boolean {
    return ctx.vertical === 'medical'
  },

  async extract(
    input: ParsedDocument & { buffer?: Buffer },
    ctx: ExtractorContext
  ): Promise<ExtractedEntity[]> {
    // The orchestrator passes the ParsedDocument text. For RFM we need raw
    // bytes since xlsx cells lose types on text-ification. The document
    // pipeline adds a `buffer` handle on the ParsedDocument object before
    // dispatching to this extractor (see lib/ai/pipeline-steps.ts
    // enhancement in Phase 4).
    if (!input.buffer) {
      // Fallback: try text-mode via xlsx.read(text). Works for small CSVs.
      return [
        makeEntity({
          entity_type: 'insight.patient_base',
          value: 'Extractor requires raw bytes (buffer). Text-only input is unsupported for RFM.',
          confidence: 0.3,
          source_type: 'document',
          extractor_name: NAME,
          extractor_version: VERSION,
          source_doc_id: ctx.documentId,
          source_field: `doc.${input.metadata.fileName}#no-buffer`,
          raw_excerpt: excerpt(input.text, 200),
        }),
      ]
    }

    // Call existing RFM pipeline
    const result = segmentPatients(input.buffer, input.metadata.fileName)
    if (!result) {
      return [
        makeEntity({
          entity_type: 'insight.patient_base',
          value: 'RFM-сегментация не удалась: нет колонки с телефонами или файл повреждён.',
          confidence: 0.2,
          source_type: 'document',
          extractor_name: NAME,
          extractor_version: VERSION,
          source_doc_id: ctx.documentId,
          source_field: `doc.${input.metadata.fileName}#rfm-failed`,
        }),
      ]
    }

    // Side-effect: replace patient_segments rows for this client
    await replacePatientSegments(ctx.userId, result, ctx.documentId)

    // Emit aggregate entities
    const out: ExtractedEntity[] = []

    const baseMeta = {
      confidence: 0.95,
      source_type: 'document' as const,
      extractor_name: NAME,
      extractor_version: VERSION,
      source_doc_id: ctx.documentId,
      raw_excerpt: excerpt(input.text, 200),
    }

    // Totals as metric entities
    out.push(makeEntity({ ...baseMeta, entity_type: 'metric.patient_count',     value: result.totals.total_patients,    unit: 'count', source_field: 'patient_base.total' }))
    out.push(makeEntity({ ...baseMeta, entity_type: 'metric.patient_ltv_total', value: result.totals.total_ltv_kzt,     unit: 'KZT',   source_field: 'patient_base.total_ltv' }))
    out.push(makeEntity({ ...baseMeta, entity_type: 'metric.avg_check',         value: result.totals.avg_check_kzt,     unit: 'KZT',   source_field: 'patient_base.avg_check' }))
    out.push(makeEntity({ ...baseMeta, entity_type: 'metric.patients_active_90d',    value: result.totals.active_last_90d,   unit: 'count', source_field: 'patient_base.active_90d' }))
    out.push(makeEntity({ ...baseMeta, entity_type: 'metric.patients_sleeping_180d', value: result.totals.sleeping_180d_plus, unit: 'count', source_field: 'patient_base.sleeping_180d' }))
    out.push(makeEntity({ ...baseMeta, entity_type: 'metric.patients_dead_leads',    value: result.totals.dead_leads,        unit: 'count', source_field: 'patient_base.dead_leads' }))

    // Segment counts — each as its own entity for slot-mapper aggregators
    for (const s of result.summary) {
      out.push(
        makeEntity({
          ...baseMeta,
          entity_type: `segment.${s.segment}` as const,
          value: {
            label: s.label,
            count: s.count,
            total_ltv_kzt: s.total_ltv_kzt,
            avg_ltv_kzt: s.avg_ltv_kzt,
            avg_recency_days: Math.round(s.avg_recency_days),
            priority: s.priority,
          },
          source_field: `patient_base.${s.segment}`,
        })
      )
    }

    // Store full summary as asset for easy rendering
    out.push(
      makeEntity({
        ...baseMeta,
        entity_type: 'asset.rfm_segmentation',
        value: {
          summary: result.summary,
          totals: result.totals,
          thresholds: result.thresholds,
        },
        source_field: 'patient_base.full_summary',
      })
    )

    // Chain: compute bundles (derived) → revenue loss map (derived).
    // These write to growth_bundles / revenue_losses tables and emit
    // their own entities. Any failure is logged but doesn't fail the
    // whole patient-base extraction.
    try {
      const { computeBundles } = await import('@/lib/clinic-bundles')
      const bundles = computeBundles(result)
      const bundleEntities = await clinicBundlesExtractor.extract(
        { segmentation: result, fileName: input.metadata.fileName },
        ctx
      )
      out.push(...bundleEntities)

      const lossEntities = await revenueLossesExtractor.extract(
        { segmentation: result, bundles, fileName: input.metadata.fileName },
        ctx
      )
      out.push(...lossEntities)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[medical.patient-base] derived chain failed:', err)
      out.push(
        makeEntity({
          ...baseMeta,
          entity_type: 'insight.patient_base',
          value: `Derived chain (bundles + losses) failed: ${err instanceof Error ? err.message : String(err)}`,
          confidence: 0.5,
          source_field: 'patient_base.derived_chain_error',
        })
      )
    }

    return out
  },
}

// -----------------------------------------------------------------------------
// DB side-effect: replace patient_segments rows
// -----------------------------------------------------------------------------

function getServiceRole(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[medical.patient-base] Supabase URL/service role missing')
  return { url, key }
}

async function replacePatientSegments(
  clientId: string,
  result: SegmentationResult,
  sourceDocumentId: string | undefined
): Promise<void> {
  const { url, key } = getServiceRole()

  // Delete existing rows for this client (simplest: full replace per upload)
  const delRes = await fetch(
    `${url}/rest/v1/patient_segments?client_id=eq.${clientId}`,
    {
      method: 'DELETE',
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' },
    }
  )
  if (!delRes.ok && delRes.status !== 404) {
    // eslint-disable-next-line no-console
    console.warn('[medical.patient-base] delete old segments failed:', await delRes.text())
  }

  // Batch insert in chunks of 500 (PostgREST payload cap safety)
  const rows = result.patients.map((p) => ({
    id: randomUUID(),
    client_id: clientId,
    patient_hash: p.patient_hash,
    display_name: p.display_name,
    recency_days: p.recency_days,
    frequency: p.frequency,
    monetary_kzt: p.monetary_kzt,
    segment: p.segment,
    priority: p.priority,
    source_document_id: sourceDocumentId ?? null,
  }))

  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const res = await fetch(`${url}/rest/v1/patient_segments`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal,resolution=merge-duplicates',
      },
      body: JSON.stringify(slice),
    })
    if (!res.ok) {
      const body = await res.text()
      // eslint-disable-next-line no-console
      console.warn(`[medical.patient-base] insert chunk ${i} failed:`, body.slice(0, 300))
    }
  }
}

// Side-effect: register
registerExtractor('medical', 'patient_base', patientBaseExtractor)

// Export for tests
export { SEGMENT_LABELS }
export type { PatientSegmentId }
