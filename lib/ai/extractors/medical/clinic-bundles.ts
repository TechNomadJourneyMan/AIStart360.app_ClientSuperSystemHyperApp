/**
 * Medical clinic-bundles extractor.
 *
 * Runs immediately AFTER patient-base extraction succeeds. Uses the
 * current SegmentationResult (from patient_segments aggregates) to
 * compute 9 growth-bundle calculations, then:
 *   1. Replaces growth_bundles rows for this client.
 *   2. Emits ExtractedEntity[] aggregates for the UI.
 *
 * This is not a file-driven extractor — it operates on already-persisted
 * patient_segments + avg_check. Registered under `virtual.clinic_bundles`
 * so the orchestrator dispatches it via a post-step after patient-base.
 */

import { randomUUID } from 'node:crypto'

import type { ParsedDocument } from '@/lib/documents/parse'
import { computeBundles, type BundleCalculation } from '@/lib/clinic-bundles'
import type { SegmentationResult } from '@/lib/rfm-segmentation'

import { excerpt, makeEntity } from '../base'
import type { Extractor, ExtractorContext, ExtractedEntity } from '../types'
import { registerExtractor } from '../registry'

const NAME = 'medical.clinic-bundles'
const VERSION = '1.0.0'

/** Input is not a document — it's the current SegmentationResult. */
export interface ClinicBundlesInput {
  segmentation: SegmentationResult
  /** Original filename for provenance (passed through from upload). */
  fileName: string
}

export const clinicBundlesExtractor: Extractor<ClinicBundlesInput> = {
  name: NAME,
  version: VERSION,
  label: 'Clinic bundles (9 growth bundles, derived)',

  supports(ctx: ExtractorContext): boolean {
    return ctx.vertical === 'medical'
  },

  async extract(input: ClinicBundlesInput, ctx: ExtractorContext): Promise<ExtractedEntity[]> {
    const bundles = computeBundles(input.segmentation)

    await replaceGrowthBundles(ctx.userId, bundles)

    const baseMeta = {
      confidence: 0.92,
      source_type: 'calculated' as const,
      extractor_name: NAME,
      extractor_version: VERSION,
      source_doc_id: ctx.documentId,
      raw_excerpt: excerpt(`9 bundles from ${input.fileName}`, 200),
    }

    const out: ExtractedEntity[] = []

    // Per-bundle entity (for slot aggregator)
    for (const b of bundles) {
      out.push(
        makeEntity({
          ...baseMeta,
          entity_type: `bundle.${b.key}` as const,
          value: {
            label: b.label,
            target_patient_count: b.target_patient_count,
            estimated_conversion: b.estimated_conversion,
            estimated_revenue_kzt: b.estimated_revenue_kzt,
            priority: b.priority,
            complexity: b.complexity,
            effect_timeline: b.effect_timeline,
            trigger_description: b.trigger_description,
            script_preview: b.script_preview,
            target_segments: b.target_segments,
          },
          source_field: `bundles.${b.key}`,
        })
      )
    }

    // Aggregate: total potential revenue uplift from all 9 bundles
    const totalUplift = bundles.reduce((sum, b) => sum + b.estimated_revenue_kzt, 0)
    out.push(
      makeEntity({
        ...baseMeta,
        entity_type: 'metric.bundles_total_uplift',
        value: totalUplift,
        unit: 'KZT',
        source_field: 'bundles.total_uplift',
      })
    )

    // Full asset for single-fetch rendering
    out.push(
      makeEntity({
        ...baseMeta,
        entity_type: 'asset.clinic_bundles',
        value: bundles,
        source_field: 'bundles.all',
      })
    )

    return out
  },
}

// -----------------------------------------------------------------------------

function getServiceRole(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[medical.clinic-bundles] Supabase creds missing')
  return { url, key }
}

async function replaceGrowthBundles(clientId: string, bundles: BundleCalculation[]): Promise<void> {
  const { url, key } = getServiceRole()

  await fetch(`${url}/rest/v1/growth_bundles?client_id=eq.${clientId}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' },
  })

  const rows = bundles.map((b) => ({
    id: randomUUID(),
    client_id: clientId,
    bundle_key: b.key,
    target_segments: b.target_segments,
    target_patient_count: b.target_patient_count,
    estimated_conversion: b.estimated_conversion,
    estimated_revenue_kzt: b.estimated_revenue_kzt,
    priority: b.priority,
    complexity: b.complexity,
    effect_timeline: b.effect_timeline,
    trigger_description: b.trigger_description,
    script_preview: b.script_preview,
  }))

  const res = await fetch(`${url}/rest/v1/growth_bundles`, {
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
    // eslint-disable-next-line no-console
    console.warn('[medical.clinic-bundles] insert failed:', await res.text())
  }
}

// NOTE: this extractor is NOT registered in the dispatch registry —
// orchestrator chains it after `medical.patient-base` succeeds, because
// its input is a SegmentationResult (not a raw document).
void registerExtractor
void clinicBundlesExtractor
