/**
 * Extractor framework public entry.
 *
 * Registry store + dispatcher live in `./registry` (separate file to
 * avoid circular imports with side-effect-registering extractors).
 *
 * Side-effect imports below load individual extractor modules; each
 * calls `registerExtractor()` at module evaluation time.
 */

// Re-export the pure registry API
export { registerExtractor, dispatch, listExtractors } from './registry'

// Re-export shared types
export type {
  Extractor,
  ExtractorContext,
  ExtractedEntity,
  ExtractorRegistry,
  AiRunStep,
} from './types'

// -----------------------------------------------------------------------------
// Extractor self-registration imports.
// Phase 1: survey extractor
// Phase 2: generic extractors (sales-report, crm-export, financial-pdf, pricelist)
// Phase 4: medical extractors (patient-base chains bundles + losses internally)
// Phase 5: brand-guide
// -----------------------------------------------------------------------------
import './survey/survey-extractor'
import './generic/sales-report'
import './generic/crm-export'
import './generic/financial-pdf'
import './generic/pricelist'
import './generic/brand-guide'
import './medical/patient-base'
