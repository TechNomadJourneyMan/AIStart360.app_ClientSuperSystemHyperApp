/**
 * Extractor registry + dispatcher.
 *
 * Extractors are added by calling `registerExtractor()`. Orchestrator calls
 * `dispatch(ctx)` to pick the right one for a given document type + vertical.
 *
 * Registry is populated at module load by imports below. New extractors
 * added in Phases 1-5 get their own `registerExtractor()` call and import.
 */

import type { Extractor, ExtractorContext, ExtractorRegistry } from './types'

const registry: ExtractorRegistry = {
  generic: {},
  medical: {},
}

/** Register an extractor under (vertical, doc_type) slot. */
export function registerExtractor(
  vertical: 'generic' | 'medical',
  docType: string,
  extractor: Extractor
): void {
  if (registry[vertical][docType]) {
    // Allow override but warn — useful during hot-reload in dev
    // eslint-disable-next-line no-console
    console.warn(
      `[extractors] overriding ${vertical}/${docType}: ${registry[vertical][docType].name}@${registry[vertical][docType].version} → ${extractor.name}@${extractor.version}`
    )
  }
  registry[vertical][docType] = extractor
}

/**
 * Pick an extractor for the given context.
 *
 * Rules (in order):
 *   1. Exact (vertical, doc_type) match.
 *   2. Exact (vertical, classifiedType) match when original doc_type='other'.
 *   3. Generic-vertical fallback with same doc_type.
 *   4. 'unknown' slot in same vertical.
 *   5. null — caller decides (usually skip + log).
 */
export function dispatch(ctx: ExtractorContext, docType: string): Extractor | null {
  const v = ctx.vertical
  const effectiveType = ctx.classifiedType && docType === 'other' ? ctx.classifiedType : docType

  // 1. Exact
  const exact = registry[v][effectiveType]
  if (exact?.supports(ctx)) return exact

  // 2. Generic fallback for medical clients with non-medical doc
  if (v === 'medical') {
    const generic = registry.generic[effectiveType]
    if (generic?.supports(ctx)) return generic
  }

  // 3. Unknown slot
  const unknown = registry[v].unknown ?? registry.generic.unknown
  if (unknown?.supports(ctx)) return unknown

  return null
}

/** For admin/debug UI: list all registered extractors. */
export function listExtractors(): Array<{ vertical: string; docType: string; name: string; version: string }> {
  const out: Array<{ vertical: string; docType: string; name: string; version: string }> = []
  for (const vertical of Object.keys(registry) as Array<keyof ExtractorRegistry>) {
    for (const docType of Object.keys(registry[vertical])) {
      const e = registry[vertical][docType]
      out.push({ vertical, docType, name: e.name, version: e.version })
    }
  }
  return out
}

// -----------------------------------------------------------------------------
// Extractor imports — added as each phase lands.
// Phase 1: survey extractor
// Phase 2: generic extractors (sales-report, crm-export, financial-pdf, pricelist)
// Phase 4: medical extractors (patient-base, clinic-bundles, revenue-losses)
// Phase 5: brand-guide + vision
// -----------------------------------------------------------------------------
// (Intentionally empty in Phase 0 — just the skeleton.)

export type { Extractor, ExtractorContext, ExtractedEntity, ExtractorRegistry, AiRunStep } from './types'
