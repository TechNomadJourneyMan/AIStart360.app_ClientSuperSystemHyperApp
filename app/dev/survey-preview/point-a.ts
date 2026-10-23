// Server-only for the dev preview: the Point A v4 engine imports node:crypto, so it cannot run in a client component.
import { calculatePointAV4 } from '@/lib/point-a/v4/engine'
import { DEFAULT_TEMPLATE, effectiveBlocks } from '@/lib/point-a/v4/config'
import { isApproxAnswer, isUnknownAnswer } from '@/lib/survey/answer-value'
import { EXPRESS_SCREENS } from '@/lib/survey/questions'
import type { SnapshotPointA } from '@/lib/survey/snapshot'
import { previewAnswers, type SurveyPreviewVariant } from './fixture'

const EXPRESS_KEYS = new Set(EXPRESS_SCREENS.flatMap((s) => s.keys))

/** Point A v4 on the preview answers as the snapshot would compute it (marks → stored values). */
export function previewPointA(variant: SurveyPreviewVariant, expressOnly: boolean): SnapshotPointA {
  const all = previewAnswers(variant)
  const answers = expressOnly ? Object.fromEntries(Object.entries(all).filter(([k]) => EXPRESS_KEYS.has(k))) : all
  const flat = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, isUnknownAnswer(v) ? null : isApproxAnswer(v) ? v.value : v]))
  if (Object.keys(flat).length === 0) return { state: 'none' }
  const v4 = calculatePointAV4({ answers: flat, blocks: effectiveBlocks(DEFAULT_TEMPLATE) })
  return { state: 'ready', snapshot: { overall: v4.overall, confidence: v4.confidence, blocks: v4.blocks, uploadChecklist: v4.upload_checklist } }
}
