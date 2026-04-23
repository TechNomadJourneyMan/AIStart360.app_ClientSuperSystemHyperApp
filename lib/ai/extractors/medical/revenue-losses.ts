/**
 * Medical revenue-losses extractor.
 *
 * Runs after patient-base + clinic-bundles. Uses auditRevenueLosses()
 * to compute the "where money leaks" map and persists it to
 * public.revenue_losses.
 */

import { randomUUID } from 'node:crypto'

import type { BundleCalculation } from '@/lib/clinic-bundles'
import { auditRevenueLosses, type RevenueLoss } from '@/lib/revenue-audit'
import type { SegmentationResult } from '@/lib/rfm-segmentation'

import { excerpt, makeEntity } from '../base'
import type { Extractor, ExtractorContext, ExtractedEntity } from '../types'
import { registerExtractor } from '../registry'

const NAME = 'medical.revenue-losses'
const VERSION = '1.0.0'

export interface RevenueLossesInput {
  segmentation: SegmentationResult
  bundles: BundleCalculation[]
  fileName: string
}

export const revenueLossesExtractor: Extractor<RevenueLossesInput> = {
  name: NAME,
  version: VERSION,
  label: 'Revenue loss map (9 leak points, derived)',

  supports(ctx: ExtractorContext): boolean {
    return ctx.vertical === 'medical'
  },

  async extract(input: RevenueLossesInput, ctx: ExtractorContext): Promise<ExtractedEntity[]> {
    const audit = auditRevenueLosses(input.segmentation, input.bundles)

    await replaceRevenueLosses(ctx.userId, audit.losses)

    const baseMeta = {
      confidence: 0.9,
      source_type: 'calculated' as const,
      extractor_name: NAME,
      extractor_version: VERSION,
      source_doc_id: ctx.documentId,
      raw_excerpt: excerpt(audit.narrative, 200),
    }

    const out: ExtractedEntity[] = []

    for (const l of audit.losses) {
      out.push(
        makeEntity({
          ...baseMeta,
          entity_type: `loss.${l.key}` as const,
          value: {
            label: l.label,
            estimated_loss_kzt: l.estimated_loss_kzt,
            severity: l.severity,
            source_data: l.source_data,
            linked_bundle_key: l.linked_bundle_key,
          },
          unit: 'KZT',
          source_field: `losses.${l.key}`,
        })
      )
    }

    out.push(
      makeEntity({
        ...baseMeta,
        entity_type: 'metric.total_revenue_loss_monthly',
        value: audit.total_loss_kzt,
        unit: 'KZT',
        source_field: 'losses.total_monthly',
      })
    )

    out.push(
      makeEntity({
        ...baseMeta,
        entity_type: 'asset.revenue_loss_map',
        value: {
          losses: audit.losses,
          total_loss_kzt: audit.total_loss_kzt,
          top_3: audit.top_3_losses,
          narrative: audit.narrative,
        },
        source_field: 'losses.map',
      })
    )

    return out
  },
}

// -----------------------------------------------------------------------------

function getServiceRole(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[medical.revenue-losses] Supabase creds missing')
  return { url, key }
}

async function replaceRevenueLosses(clientId: string, losses: RevenueLoss[]): Promise<void> {
  const { url, key } = getServiceRole()

  await fetch(`${url}/rest/v1/revenue_losses?client_id=eq.${clientId}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' },
  })

  const rows = losses.map((l) => ({
    id: randomUUID(),
    client_id: clientId,
    loss_key: l.key,
    estimated_loss_kzt: l.estimated_loss_kzt,
    severity: l.severity,
    source_data: l.source_data,
    linked_bundle_key: l.linked_bundle_key,
  }))

  const res = await fetch(`${url}/rest/v1/revenue_losses`, {
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
    console.warn('[medical.revenue-losses] insert failed:', await res.text())
  }
}

// NOTE: not registered — orchestrator chains it after patient-base.
void registerExtractor
void revenueLossesExtractor
