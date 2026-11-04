import { normalizedValuesEqual } from './normalization'
import type {
  PointAResolutionDecision,
  PointAValueRow,
} from './types'

const EXTRACTION_PRIORITY: Record<PointAValueRow['extraction_kind'], number> = {
  confirmed: 1_000,
  manual: 600,
  survey: 500,
  table: 400,
  prisma: 400,
  text: 300,
  ocr: 250,
  computed: 200,
  external: 150,
  inferred: 100,
}

function priority(candidate: PointAValueRow): number {
  if (candidate.status === 'confirmed') return 1_000
  return EXTRACTION_PRIORITY[candidate.extraction_kind] ?? 0
}

function confidence(candidate: PointAValueRow): number {
  const value = Number(candidate.confidence ?? 0)
  return Number.isFinite(value) ? value : 0
}

function active(candidate: PointAValueRow): boolean {
  return !['rejected', 'superseded', 'retracted'].includes(candidate.status)
}

export function resolvePointACandidates(
  input: PointAValueRow[],
): PointAResolutionDecision {
  const resolutionKeys = new Set(
    input.map((candidate) =>
      [
        candidate.user_id,
        candidate.company_id ?? '',
        candidate.field_key,
        candidate.period_key,
        candidate.scenario,
      ].join('\u0000')
    ),
  )
  if (resolutionKeys.size > 1) {
    throw new Error('Point A candidates must share user, company, field, period and scenario')
  }

  const candidates = input.filter(active).sort((a, b) => {
    const priorityDelta = priority(b) - priority(a)
    if (priorityDelta) return priorityDelta
    const confidenceDelta = confidence(b) - confidence(a)
    if (confidenceDelta) return confidenceDelta
    return b.updated_at.localeCompare(a.updated_at)
  })
  if (!candidates.length) {
    return {
      selected: null,
      status: 'empty',
      candidates: [],
      conflictValueIds: [],
    }
  }

  const selected = candidates[0]
  const conflicting = candidates.filter(
    (candidate) =>
      candidate.id !== selected.id &&
      !normalizedValuesEqual(
        candidate.normalized_value,
        selected.normalized_value,
      ),
  )
  const explicitlyDecided =
    selected.extraction_kind === 'confirmed' ||
    selected.status === 'confirmed'
  const needsConfirmation =
    selected.status === 'needs_confirmation' ||
    confidence(selected) < 0.65

  return {
    selected,
    status: explicitlyDecided
      ? 'resolved'
      : conflicting.length
        ? 'conflict'
        : needsConfirmation
          ? 'needs_confirmation'
          : 'resolved',
    candidates,
    conflictValueIds: conflicting.map((candidate) => candidate.id),
  }
}

export function pointASourcePriority(
  kind: PointAValueRow['extraction_kind'],
): number {
  return EXTRACTION_PRIORITY[kind]
}
