/**
 * lib/point-b/compute.ts — Point B from loaded inputs.
 *
 * Every consumer (client page, AI bridge, expert and GIGA tabs, share link,
 * PDF) calls loadPointBInputs → computePointB, so the same client never gets
 * two different plans from two different readers.
 */
import { calculatePointBV2, type PointBV2 } from './engine'
import type { PointBInputs } from './inputs'

/** null when the client has no diagnostic (Point A not calculated): the caller reports «нет данных». */
export function computePointB(inputs: PointBInputs): PointBV2 | null {
  if (!inputs.diagnostic || !inputs.pointA) return null
  const pointB = calculatePointBV2(inputs.pointA, inputs.answers, {
    diagnosticId: String(inputs.diagnostic.id),
    griTop5: inputs.griTop5,
    ...inputs.metricOptions,
    goal12mYear: inputs.goal12mYear,
    goal3yYear: inputs.goal3yYear,
    blocksWithoutData: inputs.blocksWithoutData,
    baseRevenue: inputs.base,
  })
  pointB.data_quality.snapshot = inputs.snapshot
    ? { id: inputs.snapshot.id, confidence: inputs.snapshot.confidence, coverage: inputs.snapshot.coverage }
    : null
  return pointB
}
